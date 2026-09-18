// Deterministic judge for the story machine. Pure: no AI, no I/O.
//
// This is the anchor of the writer ↔ critic loop. Two LLMs reviewing each
// other drift toward agreement or toward endless nitpicking; this module does
// neither. It re-uses the SAME coercers and publish bar the platform applies
// on import and on 送出審核, then adds cross-reference checks the platform
// only discovers at play time (an ending that points at an objective that
// does not exist, an NPC gate that names a missing clue).
//
// Severity policy — kept deliberately simple:
//   blocking  = the engine cannot run it, or authored content was silently
//               lost, or the publish bar rejects it. The loop MUST fix these.
//   warnings  = it runs, but a known failure pattern is present (an objective
//               phrased as a decision, an NPC with no knowledge base, …).
//               The critic is asked to turn these into concrete fixes.
//   info      = counts, for the human reading the report.

import { normalizeImported, type ImportedScenario } from "@/lib/ai/import-scenario";
import { buildImportReport, type ImportCounts } from "@/lib/ai/import-report";
import { checkScenarioQuality } from "@/lib/game/scenario-quality";
import { DECISIONS_KEY } from "./prompts";

export interface MachineReport {
  ok: boolean;
  blocking: string[];
  warnings: string[];
  info: string[];
  counts: ImportCounts | null;
}

/** Minimal shape check, mirroring looksLikeScenarioJSON in import-scenario.ts
 *  (not exported there; duplicated here because that is a 4-line heuristic,
 *  not a contract). */
function looksLikeScenario(parsed: unknown): parsed is Record<string, unknown> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const p = parsed as Record<string, unknown>;
  if (typeof p.title !== "string" || !p.title.trim()) return false;
  const signals = ["genre", "difficulty", "objective", "opening_scene", "locations", "npcs", "full_story", "winning_targets"];
  return signals.filter((k) => k in p).length >= 3;
}

/** Warnings from the platform's own graph validator that mean "the engine
 *  will not run this part" rather than "you are near a cap". */
function isMechanicalBreak(w: string): boolean {
  return /不存在|無法識別|永遠|不在此劇本|無法解析/.test(w);
}

/**
 * Validate the condition grammar OUTSIDE the location graph — endings and NPC
 * knowledge gates. validateLocationGraph() only covers node unlocks, NPC
 * placements and encounters; a dangling `objective:` in an ending is exactly
 * the kind of thing that makes a scenario look finished and never end.
 */
function validateTerms(
  terms: unknown,
  context: string,
  refs: { nodes: Set<string>; evidence: Set<string>; tags: Set<string>; objectives: Set<string>; npcs: Set<string> },
  allowNpcTerms: boolean,
  blocking: string[]
) {
  if (!Array.isArray(terms)) return;
  for (const group of terms) {
    if (!Array.isArray(group)) continue;
    for (const term of group) {
      if (typeof term !== "string") continue;
      const parts = term.split(":");
      const kind = parts[0];
      const arg = parts[1] ?? "";
      switch (kind) {
        case "visit":
        case "after":
          if (!refs.nodes.has(arg)) blocking.push(`${context} 引用了不存在的地點 id：${term}`);
          if (kind === "after" && !Number.isFinite(Number(parts[2]))) blocking.push(`${context} 的 after 條件缺少回合數：${term}`);
          break;
        case "item":
          if (!refs.evidence.has(arg)) blocking.push(`${context} 引用了不存在的證物 id：${term}`);
          break;
        case "count":
          if (!refs.tags.has(arg)) blocking.push(`${context} 引用了沒有任何證物使用的標籤：${term}`);
          if (!Number.isFinite(Number(parts[2]))) blocking.push(`${context} 的 count 條件缺少數量：${term}`);
          break;
        case "round":
          if (!Number.isFinite(Number(arg))) blocking.push(`${context} 的 round 條件缺少回合數：${term}`);
          break;
        case "objective":
          if (!refs.objectives.has(arg)) blocking.push(`${context} 引用了不存在的任務目標 id：${term}`);
          break;
        case "npc_dead":
        case "npc_alive":
          if (!allowNpcTerms) blocking.push(`${context} 不能使用 ${kind}:（只有結局條件可以）：${term}`);
          else if (!refs.npcs.has(arg)) blocking.push(`${context} 引用了不在 NPC 名單中的角色：${term}`);
          break;
        default:
          blocking.push(`${context} 含無法識別的條件：${term}`);
      }
    }
  }
}

/**
 * Objective phrasing heuristics. These encode what the per-turn judge can and
 * cannot see (lib/ai/objectives.ts): it reads the GM's narration of ONE turn,
 * so an objective must name an event the GM would write out. A decision, an
 * understanding, or a compound of several events is where creators get
 * "sometimes works" behaviour.
 */
function objectiveWarnings(objectives: ImportedScenario["objectives"]): string[] {
  const out: string[] = [];
  objectives.forEach((o, i) => {
    const where = `目標 ${i + 1}「${o.text}」`;
    if (o.text.length > 60) out.push(`${where} 太長（${o.text.length} 字）——通常代表塞了不只一件事，請拆開。`);
    if (/(決定|理解|明白|知道|意識到|相信|了解|想通|認清|發現真相)/.test(o.text)) {
      out.push(`${where} 描述的是心理狀態或決定，不是 GM 會寫出來的事件。改成可觀察的動作（下令、交出、說出、帶到…）。`);
    }
    // The rule is "one event, branches go in parentheses" — so a 或 inside
    // （…） is the recommended form, not a violation. Only look outside them.
    const outsideParens = o.text.replace(/[（(][^（）()]*[）)]/g, "");
    if (/(或者|或是|，或|或(?!許))/.test(outsideParens)) {
      out.push(`${where} 含有「或」——請改寫成一件事，把分支放進括號，例如「取得農場控制權（合作或武力）」。`);
    }
    if (/(並且|然後|接著|之後再|再[^次])/.test(o.text)) {
      out.push(`${where} 可能是兩件先後發生的事，考慮拆成兩個目標。`);
    }
    if (/(各|每個|每一|全部|所有|\d+ ?次|[一二三四五六七八九十]次)/.test(o.text)) {
      out.push(`${where} 是多步驟目標：可以運作（判定器會記錄進度），但每一步都必須是具體、GM 會明寫的事件；能拆就拆。`);
    }
  });
  return out;
}

/** Validate raw parsed JSON (already JSON.parse'd). */
export function validateScenarioJson(raw: unknown): MachineReport {
  const blocking: string[] = [];
  const warnings: string[] = [];
  // conversion_notes is the machine's own audit field; the platform would
  // only report it as an unknown key. Validate the scenario without it.
  if (raw && typeof raw === "object" && !Array.isArray(raw) && DECISIONS_KEY in (raw as object)) {
    const { [DECISIONS_KEY]: _omit, ...rest } = raw as Record<string, unknown>;
    raw = rest;
  }
  const info: string[] = [];

  if (!looksLikeScenario(raw)) {
    return {
      ok: false,
      blocking: ["這不是本平台的劇本 JSON：需要 title，以及 genre / difficulty / objective / opening_scene / locations / npcs / full_story 其中至少三項。"],
      warnings: [],
      info: [],
      counts: null,
    };
  }

  const normalized = normalizeImported(raw);
  const report = buildImportReport(raw, normalized);

  // 1. Platform import report: losses are blocking (the writer produced
  //    something the platform threw away), mechanical breaks are blocking,
  //    cap proximity / unknown keys are warnings.
  for (const d of report.dropped) blocking.push(`匯入會丟失內容：${d}`);
  for (const w of report.warnings) (isMechanicalBreak(w) ? blocking : warnings).push(w);

  // 2. Publish bar — exactly what 送出審核 will enforce.
  const fullStory = typeof (raw as any).full_story === "string" ? (raw as any).full_story : "";
  const quality = checkScenarioQuality({
    title: normalized.title,
    description: normalized.description,
    opening_scene: normalized.opening_scene,
    source_document: fullStory,
    location_graph: normalized.location_graph,
    endings: normalized.endings,
    objectives: normalized.objectives,
    winning_targets: normalized.winning_targets,
    each_player_targets: normalized.each_player_targets,
  });
  for (const f of quality.failures) blocking.push(`發佈門檻：${f.message}`);

  // 3. Cross-references the platform does not check at import time.
  const graph = normalized.location_graph;
  const refs = {
    nodes: new Set((graph?.nodes ?? []).map((n) => n.id)),
    evidence: new Set((graph?.nodes ?? []).flatMap((n) => n.evidence.map((e) => e.id))),
    tags: new Set((graph?.nodes ?? []).flatMap((n) => n.evidence.flatMap((e) => e.tags))),
    objectives: new Set(normalized.objectives.map((o) => o.id)),
    npcs: new Set(normalized.npcs.flatMap((n) => [n.name, n.id])),
  };

  normalized.endings.forEach((e, i) => {
    const ctx = `結局 ${i + 1}「${e.name}」的條件`;
    validateTerms(e.condition, ctx, refs, true, blocking);
    if (!e.description) warnings.push(`結局「${e.name}」沒有 description（給 AI 的結局指示）——結局畫面會沒有內容可寫。`);
  });
  if (normalized.endings.length && !normalized.endings.some((e) => e.type === "victory")) {
    warnings.push("沒有任何 victory 結局——玩家沒有可以「贏」的方式。");
  }
  if (normalized.endings.length && !normalized.endings.some((e) => e.type === "failure")) {
    warnings.push("沒有任何 failure 結局——故事無法以失敗收場（回合上限除外）。");
  }

  normalized.npcs.forEach((n) => {
    if (!n.goal) warnings.push(`NPC「${n.name}」沒有 goal——GM 不知道他想要什麼、在什麼條件下會合作或翻臉。`);
    if (!n.knowledge?.length) warnings.push(`NPC「${n.name}」沒有 knowledge——GM 只會講這裡列出的情報，空的代表他什麼都不會說。`);
    for (const k of n.knowledge ?? []) {
      validateTerms(k.when, `NPC「${n.name}」情報「${k.topic}」的解鎖條件`, refs, false, blocking);
    }
  });

  for (const node of graph?.nodes ?? []) {
    for (const ev of node.evidence) {
      if (!ev.how) warnings.push(`證物「${ev.name}」（${node.name}）沒有 how（玩家要做什麼才拿得到）——只有一般搜查能找到它。`);
      if (!ev.reveal_text) warnings.push(`證物「${ev.name}」（${node.name}）沒有 reveal_text——拿到時 GM 沒有內容可以描述。`);
    }
  }

  // 4. Objective phrasing.
  warnings.push(...objectiveWarnings(normalized.objectives));

  // 5. Counts for the human.
  const c = report.counts;
  // ── exactly one start ───────────────────────────────────────────────
  // The engine puts the party on the FIRST unlocked node (locations.ts).
  // Any other node that is enterable from turn 1 without walking there is a
  // second start: always, in free mode; in edges mode, when no path leads
  // to it from the start.
  const nodesArr: any[] = graph?.nodes ?? [];
  const unlockedNodes = nodesArr.filter((n) => n.initial === "unlocked");
  if (unlockedNodes.length > 1) {
    const start = unlockedNodes[0];
    let extra: any[];
    if (graph?.travel_mode === "edges") {
      const adj = new Map<string, Set<string>>();
      const link = (a: string, b: string) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a)!.add(b); };
      const ids = new Set(nodesArr.map((n) => n.id));
      const entryOf = (cid: string) => {
        const cont = (graph?.containers ?? []).find((x: any) => x.id === cid);
        const kids = nodesArr.filter((n) => n.container === cid);
        return cont && kids.some((n) => n.id === cont.entry) ? cont.entry : kids[0]?.id ?? null;
      };
      const ep = (id: string) => (ids.has(id) ? id : entryOf(id));
      for (const e of graph?.edges ?? []) {
        const a = ep(e.from), b = ep(e.to);
        if (!a || !b) continue;
        link(a, b); if (e.two_way) link(b, a);
      }
      for (const cont of graph?.containers ?? []) {
        if (!cont.all_children_connected) continue;
        const kids = nodesArr.filter((n) => n.container === cont.id).map((n) => n.id);
        kids.forEach((a) => kids.forEach((b) => { if (a !== b) link(a, b); }));
      }
      const seen = new Set<string>([start.id]); const q = [start.id];
      while (q.length) { const id = q.shift()!; (adj.get(id) ?? new Set<string>()).forEach((t) => { if (!seen.has(t)) { seen.add(t); q.push(t); } }); }
      extra = unlockedNodes.filter((n) => !seen.has(n.id));
    } else {
      extra = unlockedNodes.slice(1);
    }
    if (extra.length) {
      const names = extra.slice(0, 5).map((n) => `「${n.name}」`).join("、") + (extra.length > 5 ? "…" : "");
      blocking.push(
        `起點只能有一個。引擎把第一個 unlocked 地點「${start.name}」當起點，但另有 ${extra.length} 個地點一開始就 unlocked（${names}）` +
        (graph?.travel_mode === "edges" ? "，而且沒有路徑從起點走到它們。" : "，自由移動模式下玩家可以直接跳過去，等於多個起點。") +
        `把它們改成 discovered 並給 unlock 條件（例如 visit:${start.id}），或 hidden 並由某個地點的 discovers 帶到；或改 travel_mode 為 edges 並用 edges 從起點連過去。`
      );
    }
  }
  if (unlockedNodes.length) info.push(`起點：「${unlockedNodes[0].name}」（nodes 裡第一個 unlocked 地點）`);

  // ── evidence / location text must describe, not conclude ────────────
  // reveal_text is what the players perceive when they get the item. A
  // sentence that interprets it, states the truth, or scripts an NPC's
  // reaction belongs in gm_notes or NPC knowledge. Heuristic → warning.
  const CONCLUDES = /(證明|代表|顯示了|意味|真相|原來|其實|果然|可見|說明了|坐實|揭露|無疑|一定是|看得出|可以推斷|推測|顯然|技術不錯|他會|她會|若讓|對它.{0,6}一無所知)/;
  for (const node of nodesArr) {
    for (const ev of node.evidence ?? []) {
      const m = CONCLUDES.exec(String(ev.reveal_text ?? ""));
      if (m) warnings.push(`證物「${ev.name}」（${node.name}）的 reveal_text 像在下結論或寫劇本（「${m[0]}」）——只寫玩家看到、讀到、摸到的東西；它代表什麼、真相是什麼、NPC 會怎麼反應，放 gm_notes 或 NPC 情報。`);
    }
    const md = CONCLUDES.exec(String(node.desc ?? ""));
    if (md) warnings.push(`地點「${node.name}」的瀏覽描述像在下結論（「${md[0]}」）——玩家還沒調查就看得到的文字，只能寫外觀。`);
  }

  // ── objectives: hygiene the text checks cannot see ──────────────────
  // Mirrors docs/creator-guide/objectives.md rules 3 and 5 plus "every
  // objective must matter": the judge evaluates each one every turn, so an
  // objective nothing references is pure cost.
  {
    const objs: any[] = (normalized as any).objectives ?? [];
    const refs = new Map<string, Set<string>>();
    const add = (id: string, src: string) => { if (!refs.has(id)) refs.set(id, new Set()); refs.get(id)!.add(src); };
    const scan = (when: unknown, src: string) => {
      for (const grp of (Array.isArray(when) ? when : [])) for (const t of (Array.isArray(grp) ? grp : [grp])) {
        const s = String(t); if (s.startsWith("objective:")) add(s.slice(10), src);
      }
    };
    (normalized as any).endings?.forEach((e: any) => scan(e.condition, "結局"));
    nodesArr.forEach((n: any) => scan(n.unlock, "解鎖"));
    ((graph as any)?.npc_placements ?? []).forEach((p: any) => scan(p.when, "NPC位置"));
    ((graph as any)?.npc_encounters ?? []).forEach((e: any) => scan(e.when, "觸發"));
    (normalized as any).npcs?.forEach((p: any) => (p.knowledge ?? []).forEach((k: any) => scan(k.when, "情報")));
    const evNames = nodesArr.flatMap((n: any) => (n.evidence ?? []).map((e: any) => String(e.name ?? ""))).filter(Boolean);
    const nodeNames = nodesArr.map((n: any) => String(n.name ?? "")).filter(Boolean);
    objs.forEach((o: any, i: number) => {
      const t = String(o.text ?? ""), where = `目標 ${i + 1}「${t}」`;
      if (!refs.has(o.id) && !o.required) {
        warnings.push(`${where} 沒有被任何結局、解鎖、NPC 位置、觸發事件或情報引用——裁判每回合都會判它，但完成與否不影響任何事。讓某個結局或門檻引用它，或刪掉。`);
      }
      if (/(取得|拿到|找到|獲得|得到|搜出)/.test(t) && evNames.some((n) => n && t.includes(n))) {
        warnings.push(`${where} 是「拿到某件證物」——系統本來就知道，不必交給裁判。改在結局或解鎖條件用 item:<證物id>（指南規則 5）。`);
      }
      if (/(抵達|到達|進入|前往|來到)/.test(t) && nodeNames.some((n) => n && t.includes(n)) && !/(交|說|答應|下令|交出|攤)/.test(t)) {
        warnings.push(`${where} 是「到過某個地點」——改用 visit:<地點id>（指南規則 5）。`);
      }
      if (/(那個|某個|某人|那位|這位)/.test(t)) {
        warnings.push(`${where} 用了「那個／某個」這類指稱——用劇本裡的正式名字（指南規則 3），裁判才對得上。`);
      }
      if (refs.get(o.id) && Array.from(refs.get(o.id)!).every((s) => s === "結局") &&
          ((normalized as any).endings ?? []).filter((e: any) => JSON.stringify(e.condition ?? []).includes(`objective:${o.id}`)).every((e: any) => e.type === "failure")) {
        warnings.push(`${where} 只被 failure 結局引用——若這個失敗其實是「時間到」或「某 NPC 死了」，直接在 failure 結局用 round:／npc_dead:；只有裁判才判得出來的事件才需要目標（指南第四節）。`);
      }
    });
    const required = objs.filter((o: any) => o.required).length;
    if (objs.length > 6) warnings.push(`目標共 ${objs.length} 條（必要 ${required}）——指南建議必要 2–4 條、總數精簡。當門檻用的加分目標可以留，但每一條都要有人引用。`);
  }

  // ── encounters need a plausible place / time ───────────────────────
  // The engine fires an encounter the turn its condition holds, anywhere.
  // One keyed on an item/objective with no `at`/`delay` therefore pops the
  // NPC into whatever room the party got the item in.
  for (const e of (graph as any)?.npc_encounters ?? []) {
    const terms: string[] = (e.when ?? []).flat().map(String);
    const reactive = terms.length > 0 && terms.every((t: string) => /^(item|objective|count):/.test(t));
    if (reactive && !e.at && !e.delay) {
      warnings.push(`NPC「${e.npc}」的觸發事件只以「${terms.join("、")}」為條件，沒有 at 也沒有 delay——玩家在任何地方拿到／完成的下一回合，他就會出現在那裡。除非原文說他能隨時找上門，否則加 at（他平常所在的地點或區域 id），必要時加 delay。`);
    }
  }

  info.push(`地點 ${c.nodes}、證物 ${c.evidence}、NPC ${c.npcs}、目標 ${c.objectives}、結局 ${c.endings}、路徑 ${c.edges}、區域 ${c.containers}`);
  info.push(`full_story ${fullStory.trim().length} 字；language ${normalized.language}；travel_mode ${graph?.travel_mode ?? "（無地點圖）"}`);

  return { ok: blocking.length === 0, blocking, warnings, info, counts: c };
}

/** Human-readable rendering of a report (zh-TW), for the terminal and for
 *  pasting into the critic / fix prompts. */
export function renderReport(r: MachineReport): string {
  const lines: string[] = [];
  lines.push(r.ok ? "✅ 驗證器：通過（無阻斷項）" : `❌ 驗證器：${r.blocking.length} 個阻斷項`);
  if (r.blocking.length) {
    lines.push("", "【阻斷（必須修）】");
    r.blocking.forEach((b, i) => lines.push(`${i + 1}. ${b}`));
  }
  if (r.warnings.length) {
    lines.push("", `【警告（${r.warnings.length}）】`);
    r.warnings.forEach((w, i) => lines.push(`${i + 1}. ${w}`));
  }
  if (r.info.length) {
    lines.push("", "【資訊】");
    r.info.forEach((s) => lines.push(`- ${s}`));
  }
  return lines.join("\n");
}
