#!/usr/bin/env node
/**
 * Story machine — local web UI.
 *
 *   npm run story-machine:ui        # http://localhost:4171
 *
 * Same loop as run.sh (WRITER → VALIDATOR → CRITIC → FIXER), same modules, but
 * it streams structured events instead of text so the page can show the
 * validator report and the critic's findings as data rather than scrollback.
 *
 * Deliberately no framework and no build step: one file plus ui.html, run by
 * the same tsx the CLI uses. The writer/critic stay stdin→stdout shell
 * commands, so anything that works in run.sh works here unchanged.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import dns from "node:dns/promises";
import net from "node:net";
import { extractFirstJSON } from "@/lib/ai/import-scenario";
import { validateScenarioJson, type MachineReport } from "./validate";
import { writerPrompt, criticPrompt, fixPrompt, funPrompt, condensePrompt, injectStory, finalizeScenario } from "./prompts";

const HERE = path.dirname(fs.realpathSync(process.argv[1]));
const REPO = path.resolve(HERE, "../..");
const PORT = Number(process.env.PORT || 4171);

const DEFAULT_WRITER = process.env.WRITER_CMD || "claude -p --output-format json";
const DEFAULT_CRITIC = process.env.CRITIC_CMD || "codex exec --skip-git-repo-check -";
const DEFAULT_FUN = process.env.FUN_CMD || DEFAULT_CRITIC;
// Summarising does not need the strongest model; it needs a fast one.
const DEFAULT_CONDENSE = process.env.CONDENSE_CMD || "claude -p --output-format json --model sonnet";
// Stories longer than this are condensed before the writer reads them. The
// platform itself keeps at most FULL_STORY_MAX characters of full_story.
const CONDENSE_ABOVE = Number(process.env.CONDENSE_ABOVE) || 25000;
const CONDENSE_TARGET = Number(process.env.CONDENSE_TARGET) || 12000;
const FULL_STORY_MAX = 100000;
const STORY_HARD_MAX = 400000;
const MAX_ROUNDS_CAP = 10;

type Ev = Record<string, unknown> & { type: string };

interface Run {
  id: string;
  dir: string;
  events: Ev[];
  clients: Set<http.ServerResponse>;
  child: ChildProcess | null;
  funCmd: string;
  wantFun: boolean;
  condenseCmd: string;
  condenseAbove: number;
  condenseTarget: number;
  stopped: boolean;
  done: boolean;
  usage: Usage[];
}

interface Usage {
  step: string; round: number; model: string;
  input: number; output: number; cacheRead: number; cacheWrite: number;
  total: number; costUsd: number | null;
}

/** `claude -p --output-format json` wraps the answer in an envelope that also
 *  carries token counts. Text mode gives nothing. Accept both. */
function unwrapClaude(out: string): { text: string; usage: Partial<Usage>; error?: string } | null {
  const t = out.trim();
  if (!t.startsWith("{")) return null;
  try {
    const j = JSON.parse(t);
    if (!j || j.type !== "result" || typeof j.result !== "string") return null;
    const u = j.usage || {};
    const model = Object.keys(j.modelUsage || {})[0] || "claude";
    return {
      text: j.result,
      error: j.is_error ? String(j.result || "claude 回報錯誤") : undefined,
      usage: {
        model,
        input: Number(u.input_tokens) || 0, output: Number(u.output_tokens) || 0,
        cacheRead: Number(u.cache_read_input_tokens) || 0, cacheWrite: Number(u.cache_creation_input_tokens) || 0,
        costUsd: typeof j.total_cost_usd === "number" ? j.total_cost_usd : null,
      },
    };
  } catch { return null; }
}

/** codex prints "tokens used" then the number (and "model: …") on stderr. Total only. */
function parseCodexUsage(stderr: string): Partial<Usage> | null {
  const m = /tokens used\s*\n?\s*([\d,]+)/i.exec(stderr);
  if (!m) return null;
  const model = /^model:\s*(\S+)/m.exec(stderr)?.[1] || "codex";
  return { model, total: Number(m[1].replace(/,/g, "")) || 0 };
}

function recordUsage(run: Run, step: string, round: number, u: Partial<Usage>) {
  const rec: Usage = {
    step, round, model: u.model || "?",
    input: u.input || 0, output: u.output || 0, cacheRead: u.cacheRead || 0, cacheWrite: u.cacheWrite || 0,
    total: u.total || ((u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0)),
    costUsd: u.costUsd ?? null,
  };
  run.usage.push(rec);
  try {
    const f = path.join(run.dir, "usage.json");
    const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf-8")) : [];
    fs.writeFileSync(f, JSON.stringify([...(Array.isArray(prev) ? prev : []), rec], null, 2));
  } catch {}
  emit(run, { type: "usage", ...rec });
}

const runs = new Map<string, Run>();

function emit(run: Run, ev: Ev) {
  run.events.push(ev);
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  run.clients.forEach((c) => c.write(line));
}

/** Send to connected pages only; not kept for replay. */
function emitLive(run: Run, ev: Ev) {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  run.clients.forEach((c) => c.write(line));
}

/** Run a stdin→stdout shell command. stderr is streamed to the page as a live
 *  log: codex and claude both narrate on stderr, which is the only view the
 *  user gets of a step that takes minutes. */
function runCmd(run: Run, cmd: string, input: string, tag: string, round = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", cmd], { cwd: REPO, stdio: ["pipe", "pipe", "pipe"] });
    run.child = child;
    // `claude -p` in text mode says nothing until it is done, so a long step
    // looks frozen. A tick every 10s is the only sign of life the page gets.
    const t0 = Date.now();
    const hb = setInterval(() => emitLive(run, { type: "tick", tag, elapsed: Math.round((Date.now() - t0) / 1000) }), 10000);
    let out = "";
    let errTail = "";
    let errAll = "";
    child.stdout.on("data", (b) => { out += b.toString(); });
    child.stderr.on("data", (b) => {
      const s = b.toString();
      errTail = (errTail + s).slice(-4000);
      if (errAll.length < 200000) errAll += s;
      for (const raw of s.split("\n")) {
        const t = raw.trim();
        if (t) emit(run, { type: "log", tag, text: t.slice(0, 500) });
      }
    });
    child.on("error", reject);
    // A command that exits without draining stdin (or dies early) makes the
    // pending write fail with EPIPE. Unhandled, that error event takes the
    // whole server down with it; the close handler below reports the real
    // outcome, so here it is enough to swallow it.
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      clearInterval(hb);
      run.child = null;
      if (run.stopped) return reject(new Error("已停止"));
      if (code !== 0 && !out.trim()) {
        return reject(new Error(`指令結束於代碼 ${code}，而且沒有輸出。\n${errTail.slice(-600)}`));
      }
      const c = unwrapClaude(out);
      if (c) {
        recordUsage(run, tag, round, c.usage);
        if (c.error) return reject(new Error(c.error));
        return resolve(c.text);
      }
      const x = parseCodexUsage(errAll) || parseCodexUsage(out);
      if (x) recordUsage(run, tag, round, x);
      resolve(out);
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

/** The critic is an LLM: a stray sentence or a fenced block must not stall the
 *  loop. Mirrors loadCritic() in sm.ts. */
function parseCritic(raw: string): { blocking: any[]; suggestions: any[]; unparsed: boolean } {
  const t = raw.trim();
  if (!t) return { blocking: [], suggestions: [], unparsed: false };
  try {
    const j = JSON.parse(extractFirstJSON(t));
    return {
      blocking: Array.isArray(j?.blocking) ? j.blocking : [],
      suggestions: Array.isArray(j?.suggestions) ? j.suggestions : [],
      unparsed: false,
    };
  } catch {
    return { blocking: [], suggestions: [], unparsed: true };
  }
}

/** Structure the page shows above the raw JSON — the things a human checks
 *  before pasting into the platform. */
function summarize(d: any) {
  const g = d?.location_graph ?? {};
  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  return {
    title: d?.title ?? "",
    genre: d?.genre ?? "",
    difficulty: d?.difficulty ?? "",
    description: d?.description ?? "",
    opening_scene: d?.opening_scene ?? "",
    travel_mode: g?.travel_mode ?? "",
    fullStoryChars: typeof d?.full_story === "string" ? d.full_story.length : 0,
    locations: nodes.map((n: any) => ({
      id: n?.id, name: n?.name, initial: n?.initial,
      evidence: Array.isArray(n?.evidence) ? n.evidence.map((e: any) => ({ id: e?.id, name: e?.name, how: e?.how })) : [],
    })),
    npcs: (Array.isArray(d?.npcs) ? d.npcs : []).map((n: any) => ({
      name: n?.name, disposition: n?.disposition, goal: n?.goal,
      knowledge: Array.isArray(n?.knowledge) ? n.knowledge.length : 0,
    })),
    objectives: (Array.isArray(d?.objectives) ? d.objectives : []).map((o: any) => ({
      id: o?.id, text: o?.text, required: !!o?.required,
    })),
    endings: (Array.isArray(d?.endings) ? d.endings : []).map((e: any) => ({
      id: e?.id, name: e?.name, type: e?.type, condition: e?.condition, description: e?.description,
    })),
  };
}

/** Parse the fun critic leniently and clamp it to the rubric's shape, so one
 *  malformed field cannot blank the panel. */
function parseFun(raw: string) {
  const t = raw.trim();
  if (!t) return null;
  try {
    const j = JSON.parse(extractFirstJSON(t));
    return {
      verdict: typeof j?.verdict === "string" ? j.verdict : "",
      one_line: typeof j?.one_line === "string" ? j.one_line : "",
      ratings: (Array.isArray(j?.ratings) ? j.ratings : [])
        .map((r: any) => ({ aspect: String(r?.aspect ?? ""), score: Number(r?.score) || 0, why: String(r?.why ?? "") }))
        .filter((r: any) => r.aspect),
      risks: Array.isArray(j?.risks) ? j.risks : [],
      highlights: (Array.isArray(j?.highlights) ? j.highlights : []).map((h: any) => String(h)),
    };
  } catch {
    return null;
  }
}

/** The playtest pass. Never gates: it runs once on the scenario the loop
 *  settled on, pass or fail, because "is it fun" is advice, not a check. */
/** The GM-facing file: audit trail lifted out into decisions.md. The
 *  per-round files keep it, because the critic needs it. */
function writeFinal(run: Run, parsed: unknown): string {
  const copy = JSON.parse(JSON.stringify(parsed));
  const decisions = finalizeScenario(copy);
  const json = JSON.stringify(copy, null, 2);
  fs.writeFileSync(path.join(run.dir, "scenario.json"), json + "\n");
  fs.writeFileSync(path.join(run.dir, "decisions.md"), decisions + "\n");
  emit(run, { type: "decisions", text: decisions, gmNotesChars: typeof copy.gm_notes === "string" ? copy.gm_notes.length : 0 });
  return json;
}

async function funPass(run: Run, story: string, scenarioJson: string) {
  if (!run.wantFun || run.stopped) return;
  emit(run, { type: "step", round: 0, step: "fun", status: "start" });
  let raw = "";
  try {
    raw = await runCmd(run, run.funCmd, funPrompt(story, scenarioJson), "fun");
  } catch (e: any) {
    if (run.stopped) return;
    emit(run, { type: "step", round: 0, step: "fun", status: "error", message: String(e?.message ?? e) });
    return;
  }
  fs.writeFileSync(path.join(run.dir, "fun.txt"), raw);
  const fun = parseFun(raw);
  if (!fun) {
    emit(run, { type: "step", round: 0, step: "fun", status: "error", message: "試玩評審的輸出不是合法 JSON。" });
    return;
  }
  fs.writeFileSync(path.join(run.dir, "fun.json"), JSON.stringify(fun, null, 2));
  emit(run, { type: "fun", ...fun });
  emit(run, { type: "step", round: 0, step: "fun", status: "done" });
}

interface Resume {
  round: number;           // last completed round; the loop starts at round + 1
  json: string;
  report: MachineReport;
  critic: string;
  storyForModels: string;
}

/**
 * maxRounds is absolute (round numbers keep counting on a resume), so
 * "再跑 2 輪" after round 3 means rounds 4 and 5. A resumed run skips
 * condensing and picks up the fixer loop from the files on disk.
 */
async function loop(run: Run, story: string, maxRounds: number, writerCmd: string, criticCmd: string, resume?: Resume) {
  fs.mkdirSync(run.dir, { recursive: true });
  if (!resume) fs.writeFileSync(path.join(run.dir, "story.md"), story);
  emit(run, { type: "start", dir: run.dir, maxRounds, writerCmd, criticCmd, resumeFrom: resume?.round ?? 0 });

  // ── condense, only when the story is too long to design from in one go ──
  let storyForModels = resume ? resume.storyForModels : story;
  if (!resume && story.length > run.condenseAbove) {
    emit(run, { type: "step", round: 0, step: "condense", status: "start", from: story.length, target: run.condenseTarget });
    try {
      const out = (await runCmd(run, run.condenseCmd, condensePrompt(story, run.condenseTarget), "condense")).trim();
      if (out.length < 200) throw new Error("濃縮結果太短，不像一篇故事。");
      storyForModels = out;
      fs.writeFileSync(path.join(run.dir, "story.condensed.md"), out);
      emit(run, { type: "condensed", from: story.length, to: out.length });
      emit(run, { type: "step", round: 0, step: "condense", status: "done" });
    } catch (e: any) {
      if (run.stopped) { emit(run, { type: "done", pass: false, reason: "stopped" }); run.done = true; return; }
      emit(run, { type: "step", round: 0, step: "condense", status: "error", message: String(e?.message ?? e) });
      emit(run, { type: "done", pass: false, reason: "condense-failed" });
      run.done = true;
      return;
    }
  }
  // What the GM reads at play time. Within the platform cap the original goes
  // in untouched; past it, the condensed text beats a story cut off mid-line.
  const fullStory = story.length <= FULL_STORY_MAX ? story : storyForModels.slice(0, FULL_STORY_MAX);

  let prevJson = resume?.json ?? "";
  let prevReport: MachineReport | null = resume?.report ?? null;
  let prevCritic = resume?.critic ?? "";

  for (let round = (resume?.round ?? 0) + 1; round <= maxRounds; round++) {
    if (run.stopped) break;
    emit(run, { type: "round", round, maxRounds });
    const P = path.join(run.dir, `round${round}`);

    const prompt = round === 1
      ? writerPrompt(storyForModels)
      : fixPrompt(storyForModels, prevJson, prevReport!, prevCritic);
    fs.writeFileSync(`${P}.prompt.txt`, prompt);

    // ── writer ────────────────────────────────────────────────────────────
    emit(run, { type: "step", round, step: "writer", status: "start" });
    let raw: string;
    try {
      raw = await runCmd(run, writerCmd, prompt, "writer", round);
    } catch (e: any) {
      emit(run, { type: "step", round, step: "writer", status: "error", message: String(e?.message ?? e) });
      emit(run, { type: "done", pass: false, reason: "writer-failed" });
      run.done = true;
      return;
    }
    fs.writeFileSync(`${P}.raw.txt`, raw);

    let pretty: string;
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractFirstJSON(raw));
      injectStory(parsed, fullStory);   // the writer only left a placeholder
      pretty = JSON.stringify(parsed, null, 2);
    } catch (e: any) {
      emit(run, {
        type: "step", round, step: "writer", status: "error",
        message: `模型輸出裡找不到合法的 JSON：${e?.message ?? e}`, head: raw.slice(0, 400),
      });
      emit(run, { type: "done", pass: false, reason: "no-json" });
      run.done = true;
      return;
    }
    fs.writeFileSync(`${P}.json`, pretty + "\n");
    emit(run, { type: "step", round, step: "writer", status: "done", chars: pretty.length });
    emit(run, { type: "scenario", round, json: pretty, summary: summarize(parsed) });

    // ── validator (pure code) ─────────────────────────────────────────────
    emit(run, { type: "step", round, step: "validator", status: "start" });
    const report = validateScenarioJson(parsed);
    fs.writeFileSync(`${P}.report.json`, JSON.stringify(report, null, 2));
    emit(run, { type: "report", round, report });
    emit(run, { type: "step", round, step: "validator", status: "done", ok: report.ok });

    // ── critic ────────────────────────────────────────────────────────────
    emit(run, { type: "step", round, step: "critic", status: "start" });
    let criticRaw = "";
    try {
      criticRaw = await runCmd(run, criticCmd, criticPrompt(storyForModels, pretty, report), "critic", round);
    } catch (e: any) {
      if (run.stopped) break;
      emit(run, { type: "step", round, step: "critic", status: "error", message: String(e?.message ?? e) });
    }
    fs.writeFileSync(`${P}.critic.txt`, criticRaw);
    const critic = parseCritic(criticRaw);
    emit(run, { type: "critic", round, ...critic });
    emit(run, { type: "step", round, step: "critic", status: "done", blocking: critic.blocking.length });

    // ── gate ──────────────────────────────────────────────────────────────
    const pass = report.ok && critic.blocking.length === 0;
    emit(run, {
      type: "gate", round, pass,
      blocking: report.blocking.length, warnings: report.warnings.length,
      criticBlocking: critic.blocking.length, criticSuggestions: critic.suggestions.length,
    });

    if (pass) {
      const finalJson = writeFinal(run, parsed);
      await funPass(run, storyForModels, pretty);
      emit(run, { type: "done", pass: true, round, json: finalJson, summary: summarize(parsed) });
      run.done = true;
      return;
    }

    prevJson = pretty;
    prevReport = report;
    prevCritic = criticRaw;
  }

  if (run.stopped) {
    emit(run, { type: "done", pass: false, reason: "stopped" });
  } else {
    let finalJson = prevJson;
    if (prevJson) {
      finalJson = writeFinal(run, JSON.parse(prevJson));
      await funPass(run, storyForModels, prevJson);
    }
    emit(run, { type: "done", pass: false, reason: "max-rounds", json: finalJson });
  }
  run.done = true;
}

function bodyBytes(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((res) => {
    const parts: Buffer[] = [];
    req.on("data", (c) => parts.push(Buffer.from(c)));
    req.on("end", () => res(Buffer.concat(parts)));
  });
}

/** Turn an uploaded document into plain text. .docx reuses mammoth, already a
 *  platform dependency; .pdf uses unpdf. A PDF with no text layer (a scan)
 *  extracts to nothing, which we report rather than silently passing on. */
async function extractDoc(name: string, bytes: Buffer): Promise<string> {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    let text: string | string[];
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      ({ text } = await extractText(pdf, { mergePages: true }));
    } catch (e: any) {
      // The library's own message is English and says nothing actionable.
      throw new Error(`這個檔案不是可讀的 PDF（${e?.message ?? e}）。如果它來自雲端同步資料夾，請先確認已下載到本機。`);
    }
    const t = (Array.isArray(text) ? text.join("\n") : String(text ?? "")).trim();
    if (t.length < 20) {
      throw new Error("這份 PDF 抽不出文字，可能是掃描檔（圖片）。請先做 OCR，或改上傳 .docx / .md / .txt。");
    }
    return t;
  }
  if (ext === ".docx") {
    try {
      const mammoth: any = await import("mammoth");
      const extractRawText = mammoth.extractRawText ?? mammoth.default?.extractRawText;
      const r = await extractRawText({ buffer: bytes });
      return String(r?.value ?? "").trim();
    } catch {
      throw new Error("讀不到這份 Word 檔。請確認它是真正的 .docx，不是改過副檔名的舊版 .doc。");
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
}

const MAX_FETCH_BYTES = 8 * 1024 * 1024;

/** Reject anything that is not a public web address. This server runs on the
 *  user's machine with their network reach, so an unchecked fetch would let a
 *  pasted link read the LAN, the loopback interface, or a cloud metadata
 *  endpoint. Checked per redirect hop, not just on the first URL. */
function isPrivateAddr(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80");
  }
  return true;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("這不是一個有效的網址。"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("只支援 http 與 https 網址。");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let addrs: string[];
  if (net.isIP(host)) addrs = [host];
  else {
    try { addrs = (await dns.lookup(host, { all: true })).map((a) => a.address); }
    catch { throw new Error(`找不到這個網域：${host}`); }
  }
  if (addrs.some(isPrivateAddr)) {
    throw new Error("這個網址指向本機或內部網路，基於安全考量不予抓取。");
  }
  return u;
}

/** Fetch a page, following redirects by hand so every hop is re-validated. */
async function fetchPublic(raw: string): Promise<{ res: Response; url: URL }> {
  let current = raw;
  for (let hop = 0; hop < 5; hop++) {
    const u = await assertPublicUrl(current);
    const res = await fetch(u.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(25000),
      headers: {
        // Some sites serve a stub to unknown agents; ask for a document plainly.
        "User-Agent": "Mozilla/5.0 (compatible; story-machine/1.0; +local tool)",
        Accept: "text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`伺服器回應 ${res.status} 但沒有指出轉址目的地。`);
      current = new URL(loc, u).toString();
      continue;
    }
    if (!res.ok) throw new Error(`抓取失敗：HTTP ${res.status}。這個頁面可能需要登入，或擋住了自動抓取。`);
    return { res, url: u };
  }
  throw new Error("轉址次數過多。");
}

/** Turn a fetched page into the plain story text the writer will read. */
async function textFromUrl(raw: string): Promise<{ text: string; title: string; source: string; kind: string }> {
  const { res, url } = await fetchPublic(raw);
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FETCH_BYTES) throw new Error("這個頁面太大了（超過 8MB）。");

  if (ctype.includes("application/pdf") || url.pathname.toLowerCase().endsWith(".pdf")) {
    return { text: await extractDoc("x.pdf", buf), title: path.basename(url.pathname) || url.hostname, source: url.toString(), kind: "PDF" };
  }
  if (ctype.includes("wordprocessingml") || url.pathname.toLowerCase().endsWith(".docx")) {
    return { text: await extractDoc("x.docx", buf), title: path.basename(url.pathname) || url.hostname, source: url.toString(), kind: "Word" };
  }

  const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const looksHtml = ctype.includes("html") || /^\s*<(!doctype|html)/i.test(html);
  if (!looksHtml) {
    const t = html.replace(/\r\n/g, "\n").trim();
    if (t.length < 20) throw new Error("這個網址沒有回傳可讀的文字。");
    return { text: t, title: path.basename(url.pathname) || url.hostname, source: url.toString(), kind: "純文字" };
  }

  const { Readability } = await import("@mozilla/readability");
  const { parseHTML } = await import("linkedom");
  const { document } = parseHTML(html);
  const art = new Readability(document as any).parse();
  const text = (art?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 100) {
    throw new Error("抽不出這一頁的正文。它可能靠 JavaScript 載入內容、需要登入，或是一個目錄頁。請改用複製貼上。");
  }
  return { text, title: (art?.title || document.title || url.hostname).trim(), source: url.toString(), kind: "網頁" };
}

/** Is each CLI installed, and is it logged in? Both questions matter: a
 *  present binary that cannot authenticate fails only minutes into a run. */
function probe(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout, stderr) => {
      res({ code: err ? ((err as any).code ?? 1) : 0, out: `${stdout}${stderr}`.trim() });
    });
  });
}

async function cliStatus() {
  const [cv, ca, xv, xl] = await Promise.all([
    probe("claude", ["--version"]),
    probe("claude", ["auth", "status"]),
    probe("codex", ["--version"]),
    probe("codex", ["login", "status"]),
  ]);
  // `claude auth status` prints JSON. If that ever changes, treat it as
  // unknown rather than guessing: a regex here would match the field name
  // "loggedIn" in the JSON itself and report a logged-out CLI as connected.
  let claudeIn = false;
  try { claudeIn = JSON.parse(ca.out)?.loggedIn === true; } catch { claudeIn = false; }
  return {
    claude: {
      installed: cv.code === 0, version: cv.out.split("\n")[0] || "",
      loggedIn: claudeIn, hint: claudeIn ? "" : "在終端機執行 `claude auth login`",
    },
    codex: {
      installed: xv.code === 0, version: xv.out.split("\n")[0] || "",
      loggedIn: xl.code === 0 && /logged in/i.test(xl.out),
      detail: xl.out.split("\n")[0] || "",
      hint: xl.code === 0 && /logged in/i.test(xl.out) ? "" : "在終端機執行 `codex login`",
    },
  };
}

// ── past runs, read back from disk ────────────────────────────────────────
// A Run lives in memory, so restarting the server used to make a finished run
// unviewable even though every file was still on disk. These rebuild the same
// event stream from those files, so the page renders history with the exact
// code path it uses for a live run — and it works for run.sh output too,
// which writes the same layout.

const STORIES = () => path.join(REPO, "stories");

function runDirs(): string[] {
  try {
    return fs.readdirSync(STORIES())
      .map((n) => path.join(STORIES(), n))
      .filter((d) => { try { return fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, "round1.json")); } catch { return false; } });
  } catch { return []; }
}

function readJson(f: string): any {
  try { return JSON.parse(fs.readFileSync(f, "utf-8")); } catch { return null; }
}

function eventsFromDisk(dir: string): Ev[] {
  const evs: Ev[] = [];
  evs.push({ type: "start", dir, replay: true });
  const uf = readJson(path.join(dir, "usage.json"));
  if (Array.isArray(uf)) uf.forEach((u: any) => evs.push({ type: "usage", ...u }));
  const cf0 = path.join(dir, "story.condensed.md"), sf0 = path.join(dir, "story.md");
  if (fs.existsSync(cf0) && fs.existsSync(sf0)) {
    evs.push({ type: "condensed", from: fs.readFileSync(sf0, "utf-8").length, to: fs.readFileSync(cf0, "utf-8").length });
  }
  let last: { round: number; json: string; parsed: any; pass: boolean } | null = null;

  for (let round = 1; ; round++) {
    const jf = path.join(dir, `round${round}.json`);
    if (!fs.existsSync(jf)) break;
    const parsed = readJson(jf);
    if (!parsed) break;
    const pretty = JSON.stringify(parsed, null, 2);

    evs.push({ type: "round", round, maxRounds: 0 });
    evs.push({ type: "step", round, step: "writer", status: "done", chars: pretty.length });
    evs.push({ type: "scenario", round, json: pretty, summary: summarize(parsed) });

    const report = readJson(path.join(dir, `round${round}.report.json`)) ?? validateScenarioJson(parsed);
    evs.push({ type: "report", round, report });
    evs.push({ type: "step", round, step: "validator", status: "done", ok: !!report.ok });

    let critic = { blocking: [] as any[], suggestions: [] as any[], unparsed: false };
    const cf = path.join(dir, `round${round}.critic.txt`);
    if (fs.existsSync(cf)) critic = parseCritic(fs.readFileSync(cf, "utf-8"));
    evs.push({ type: "critic", round, ...critic });
    evs.push({ type: "step", round, step: "critic", status: "done", blocking: critic.blocking.length });

    const pass = !!report.ok && critic.blocking.length === 0;
    evs.push({
      type: "gate", round, pass,
      blocking: report.blocking?.length ?? 0, warnings: report.warnings?.length ?? 0,
      criticBlocking: critic.blocking.length, criticSuggestions: critic.suggestions.length,
    });
    last = { round, json: pretty, parsed, pass };
    if (pass) break;
  }

  const df = path.join(dir, "decisions.md");
  if (fs.existsSync(df)) {
    const sc = readJson(path.join(dir, "scenario.json"));
    evs.push({ type: "decisions", text: fs.readFileSync(df, "utf-8").trim(), gmNotesChars: typeof sc?.gm_notes === "string" ? sc.gm_notes.length : 0 });
  }
  const fun = readJson(path.join(dir, "fun.json"));
  if (fun) {
    evs.push({ type: "step", round: 0, step: "fun", status: "done" });
    evs.push({ type: "fun", ratings: [], risks: [], highlights: [], ...fun });
  }

  if (last) {
    const fin = readJson(path.join(dir, "scenario.json"));
    if (fin) last.json = JSON.stringify(fin, null, 2);
    evs.push(last.pass
      ? { type: "done", pass: true, round: last.round, json: last.json, summary: summarize(last.parsed) }
      : { type: "done", pass: false, reason: "max-rounds", json: last.json });
  }
  return evs;
}

function runSummary(dir: string) {
  const id = path.basename(dir);
  const scenario = readJson(path.join(dir, "scenario.json")) ?? readJson(path.join(dir, "round1.json"));
  let rounds = 0;
  while (fs.existsSync(path.join(dir, `round${rounds + 1}.json`))) rounds++;
  const lastReport = readJson(path.join(dir, `round${rounds}.report.json`));
  let criticBlocking = -1;
  const cf = path.join(dir, `round${rounds}.critic.txt`);
  if (fs.existsSync(cf)) criticBlocking = parseCritic(fs.readFileSync(cf, "utf-8")).blocking.length;
  const fun = readJson(path.join(dir, "fun.json"));
  const ratings = Array.isArray(fun?.ratings) ? fun.ratings : [];
  return {
    id, dir, rounds,
    title: scenario?.title ?? id,
    when: (() => { try { return fs.statSync(dir).mtime.toISOString(); } catch { return ""; } })(),
    passed: !!lastReport?.ok && criticBlocking === 0,
    locations: Array.isArray(scenario?.location_graph?.nodes) ? scenario.location_graph.nodes.length : 0,
    funVerdict: fun?.verdict ?? "",
    tokens: (() => { const u = readJson(path.join(dir, "usage.json")); return Array.isArray(u) ? u.reduce((a: number, r: any) => a + (Number(r.total) || 0), 0) : 0; })(),
    costUsd: (() => { const u = readJson(path.join(dir, "usage.json")); return Array.isArray(u) ? u.reduce((a: number, r: any) => a + (Number(r.costUsd) || 0), 0) : 0; })(),
    funAvg: ratings.length ? Number((ratings.reduce((a: number, r: any) => a + (Number(r.score) || 0), 0) / ratings.length).toFixed(1)) : null,
  };
}

/** Accept either the live run id (`mu3paju4`) or the folder name (`ui-mu3paju4`). */
function resolveDir(id: string): string | null {
  if (!id || id.includes("/") || id.includes("..")) return null;
  for (const cand of [id, `ui-${id}`]) {
    const d = path.join(STORIES(), cand);
    if (fs.existsSync(path.join(d, "round1.json"))) return d;
  }
  return null;
}

function body(req: http.IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let b = "";
    req.on("data", (c) => { b += c; });
    req.on("end", () => res(b));
  });
}

function json(res: http.ServerResponse, code: number, data: unknown) {
  const s = JSON.stringify(data);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(s) });
  res.end(s);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = fs.readFileSync(path.join(HERE, "ui.html"));
    // Read from disk every time and never cache: editing ui.html and hitting
    // reload must show the edit, not a stale copy.
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(html);
  }

  if (url.pathname === "/api/defaults") {
    return json(res, 200, {
      writerCmd: DEFAULT_WRITER, criticCmd: DEFAULT_CRITIC, funCmd: DEFAULT_FUN, condenseCmd: DEFAULT_CONDENSE, repo: REPO,
      condenseAbove: CONDENSE_ABOVE, condenseTarget: CONDENSE_TARGET, fullStoryMax: FULL_STORY_MAX,
      // Commands are composed from these so a model change never means editing
      // a shell string by hand; "自訂" still exposes the raw command.
      providers: {
        claude: { label: "Claude Code", base: "claude -p --output-format json", modelFlag: "--model", models: ["fable", "opus", "sonnet", "haiku"] },
        codex: { label: "Codex", base: "codex exec --skip-git-repo-check", modelFlag: "--model", models: ["gpt-6-astra", "gpt-5", "o3"], suffix: "-" },
      },
    });
  }

  if (url.pathname === "/api/runs") {
    const list = runDirs().map(runSummary).sort((a, b) => (a.when < b.when ? 1 : -1));
    return json(res, 200, { runs: list });
  }

  if (url.pathname === "/api/cli-status") {
    return json(res, 200, await cliStatus());
  }

  if (url.pathname === "/api/fetch-url" && req.method === "POST") {
    let target = "";
    try {
      target = String(JSON.parse(await body(req) || "{}").url || "").trim();
      if (!target) return json(res, 400, { error: "請輸入網址。" });
      // Only a bare host gets a scheme added. Prefixing something that already
      // has one (file:, ftp:) would mangle it into a nonsense hostname and
      // report a misleading "domain not found".
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
        if (!/^https?:/i.test(target)) return json(res, 400, { error: "只支援 http 與 https 網址。" });
      } else {
        target = "https://" + target;
      }
      const r = await textFromUrl(target);
      return json(res, 200, { ...r, chars: r.text.length });
    } catch (e: any) {
      return json(res, 400, { error: String(e?.message ?? e) });
    }
  }

  if (url.pathname === "/api/extract" && req.method === "POST") {
    const name = url.searchParams.get("name") || "story.txt";
    try {
      const text = await extractDoc(name, await bodyBytes(req));
      if (text.length < 20) return json(res, 400, { error: "檔案裡讀不到足夠的文字。" });
      return json(res, 200, { text, chars: text.length, name });
    } catch (e: any) {
      return json(res, 400, { error: String(e?.message ?? e) });
    }
  }

  if (url.pathname === "/api/sample") {
    const f = path.join(REPO, "stories", "sample.md");
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end("no sample"); }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(fs.readFileSync(f));
  }

  if (url.pathname === "/api/validate" && req.method === "POST") {
    const b = await body(req);
    try {
      const parsed = JSON.parse(extractFirstJSON(b));
      return json(res, 200, { ok: true, report: validateScenarioJson(parsed), summary: summarize(parsed), json: JSON.stringify(parsed, null, 2) });
    } catch (e: any) {
      return json(res, 200, { ok: false, error: `JSON 無法解析：${e?.message ?? e}` });
    }
  }

  if (url.pathname === "/api/run" && req.method === "POST") {
    const b = JSON.parse(await body(req) || "{}");
    const story = String(b.story || "").trim();
    if (story.length < 50) return json(res, 400, { error: "故事太短了，至少要 50 個字。" });
    if (story.length > STORY_HARD_MAX) return json(res, 400, { error: `故事超過 ${STORY_HARD_MAX.toLocaleString()} 字，請先拆成單一場次再丟進來。` });
    const id = Date.now().toString(36);
    const dir = path.join(REPO, "stories", `ui-${id}`);
    const run: Run = {
      id, dir, events: [], clients: new Set(), child: null, stopped: false, done: false,
      funCmd: String(b.funCmd || DEFAULT_FUN), wantFun: b.wantFun !== false,
      condenseCmd: String(b.condenseCmd || DEFAULT_CONDENSE),
      condenseAbove: Math.max(2000, Number(b.condenseAbove) || CONDENSE_ABOVE),
      condenseTarget: Math.max(1000, Number(b.condenseTarget) || CONDENSE_TARGET),
      usage: [],
    };
    runs.set(id, run);
    loop(
      run, story,
      Math.min(Math.max(Number(b.maxRounds) || 3, 1), MAX_ROUNDS_CAP),
      String(b.writerCmd || DEFAULT_WRITER),
      String(b.criticCmd || DEFAULT_CRITIC),
    ).catch((e) => {
      emit(run, { type: "step", step: "loop", status: "error", message: String(e?.message ?? e) });
      emit(run, { type: "done", pass: false, reason: "crash" });
      run.done = true;
    });
    return json(res, 200, { runId: id, dir });
  }

  if (url.pathname === "/api/continue" && req.method === "POST") {
    const b = JSON.parse(await body(req) || "{}");
    const src = runs.get(String(b.run || ""))?.dir ?? resolveDir(String(b.run || ""));
    if (!src) return json(res, 404, { error: "找不到這次執行" });
    if (Array.from(runs.values()).some((r) => r.dir === src && !r.done)) return json(res, 409, { error: "這次執行還在跑。" });
    let last = 0;
    while (fs.existsSync(path.join(src, `round${last + 1}.json`))) last++;
    if (!last) return json(res, 400, { error: "這次執行沒有任何完成的輪次可以接續。" });
    const extra = Math.min(Math.max(Number(b.rounds) || 2, 1), MAX_ROUNDS_CAP);
    const storyPath = path.join(src, "story.md");
    if (!fs.existsSync(storyPath)) return json(res, 400, { error: "找不到 story.md，無法接續。" });
    const story = fs.readFileSync(storyPath, "utf-8");
    const condPath = path.join(src, "story.condensed.md");
    const storyForModels = fs.existsSync(condPath) ? fs.readFileSync(condPath, "utf-8") : story;
    const critPath = path.join(src, `round${last}.critic.txt`);
    const resume: Resume = {
      round: last,
      json: fs.readFileSync(path.join(src, `round${last}.json`), "utf-8"),
      report: readJson(path.join(src, `round${last}.report.json`)) ?? validateScenarioJson(JSON.parse(fs.readFileSync(path.join(src, `round${last}.json`), "utf-8"))),
      critic: fs.existsSync(critPath) ? fs.readFileSync(critPath, "utf-8") : "",
      storyForModels,
    };
    const id = Date.now().toString(36);
    const run: Run = {
      id, dir: src, events: [], clients: new Set(), child: null, stopped: false, done: false,
      funCmd: String(b.funCmd || DEFAULT_FUN), wantFun: b.wantFun !== false,
      condenseCmd: DEFAULT_CONDENSE, condenseAbove: CONDENSE_ABOVE, condenseTarget: CONDENSE_TARGET,
      usage: [],
    };
    // Seed with the history so the page shows rounds 1..last before the live
    // ones — minus the old verdicts, which the new rounds supersede.
    for (const ev of eventsFromDisk(src)) {
      if (ev.type === "done" || ev.type === "fun" || (ev.type === "step" && ev.step === "fun")) continue;
      run.events.push(ev);
    }
    runs.set(id, run);
    loop(run, story, last + extra, String(b.writerCmd || DEFAULT_WRITER), String(b.criticCmd || DEFAULT_CRITIC), resume)
      .catch((e) => {
        emit(run, { type: "step", step: "loop", status: "error", message: String(e?.message ?? e) });
        emit(run, { type: "done", pass: false, reason: "crash" });
        run.done = true;
      });
    return json(res, 200, { runId: id, dir: src, from: last, to: last + extra });
  }

  if (url.pathname === "/api/stop" && req.method === "POST") {
    const run = runs.get(url.searchParams.get("run") || "");
    if (!run) return json(res, 404, { error: "找不到這次執行" });
    run.stopped = true;
    run.child?.kill("SIGTERM");
    return json(res, 200, { ok: true });
  }

  if (url.pathname === "/api/stream") {
    const id = url.searchParams.get("run") || "";
    const run = runs.get(id);
    if (!run) {
      // Not live — serve it from disk if those files are still there.
      const dir = resolveDir(id);
      if (!dir) return json(res, 404, { error: "找不到這次執行" });
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
      for (const ev of eventsFromDisk(dir)) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      return res.end();
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    run.events.forEach((ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`));
    if (run.done) return res.end();
    run.clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => { clearInterval(ping); run.clients.delete(res); });
    return;
  }

  if (url.pathname === "/api/download") {
    const id = url.searchParams.get("run") || "";
    const dir = runs.get(id)?.dir ?? resolveDir(id);
    const f = dir && path.join(dir, "scenario.json");
    if (!f || !fs.existsSync(f)) return json(res, 404, { error: "還沒有 scenario.json" });
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="scenario.json"`,
    });
    return res.end(fs.readFileSync(f));
  }

  res.writeHead(404); res.end("not found");
});

server.listen(PORT, () => {
  console.log(`\n  故事機 UI → http://localhost:${PORT}\n`);
  console.log(`  作者：${DEFAULT_WRITER}`);
  console.log(`  評審：${DEFAULT_CRITIC}\n`);
});
