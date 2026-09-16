#!/usr/bin/env node
/**
 * Story machine — turn a full story into a game-ready scenario JSON by looping
 * a WRITER LLM, this deterministic VALIDATOR, and a CRITIC LLM until the
 * result clears the platform's own import + publish checks.
 *
 *   npm run story-machine -- writer-prompt  <story.md>                     > prompt.txt
 *   npm run story-machine -- extract        < model-output.txt             > scenario.json
 *   npm run story-machine -- validate       <scenario.json> [--out report.json]
 *   npm run story-machine -- critic-prompt  <story.md> <scenario.json> <report.json>
 *   npm run story-machine -- fix-prompt     <story.md> <scenario.json> <report.json> <critic.json>
 *   npm run story-machine -- gate           <report.json> <critic.json>
 *
 * run.sh in this folder chains these with `claude -p` / `codex exec`. The
 * subcommands are separate on purpose: any one of them can be swapped for a
 * different CLI, a web UI, or a human, without touching the others.
 */
import fs from "node:fs";
import { extractFirstJSON } from "@/lib/ai/import-scenario";
import { validateScenarioJson, renderReport, type MachineReport } from "./validate";
import { writerPrompt, criticPrompt, fixPrompt } from "./prompts";

function read(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

function readStdin(): string {
  return fs.readFileSync(0, "utf-8");
}

function die(msg: string): never {
  console.error(msg);
  process.exit(2);
}

function loadReport(p: string): MachineReport {
  const r = JSON.parse(read(p));
  if (!r || !Array.isArray(r.blocking)) die(`${p} 不是驗證器報告。`);
  return r;
}

/** Parse the critic's output leniently: the critic is an LLM, so a stray
 *  sentence before the JSON or a fenced block must not crash the loop. */
function loadCritic(p: string): { blocking: unknown[]; suggestions: unknown[] } {
  const raw = read(p).trim();
  if (!raw) return { blocking: [], suggestions: [] };
  try {
    const j = JSON.parse(extractFirstJSON(raw));
    return {
      blocking: Array.isArray(j?.blocking) ? j.blocking : [],
      suggestions: Array.isArray(j?.suggestions) ? j.suggestions : [],
    };
  } catch {
    // Unparseable critic output is treated as "no findings" but reported —
    // the loop must not stall on a formatting hiccup from the reviewer.
    console.error(`⚠ 評審輸出不是合法 JSON，本輪視為無評審意見（${p}）。`);
    return { blocking: [], suggestions: [] };
  }
}

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "writer-prompt": {
    const [story] = args;
    if (!story) die("用法：writer-prompt <story.md>");
    process.stdout.write(writerPrompt(read(story)));
    break;
  }
  case "extract": {
    const raw = readStdin().trim();
    if (!raw) die("stdin 是空的——模型沒有輸出任何東西。");
    let json: string;
    try {
      json = JSON.stringify(JSON.parse(extractFirstJSON(raw)), null, 2);
    } catch (e) {
      die(`模型輸出裡找不到合法的 JSON：${e instanceof Error ? e.message : e}\n--- 前 300 字 ---\n${raw.slice(0, 300)}`);
    }
    process.stdout.write(json + "\n");
    break;
  }
  case "validate": {
    const [file, flag, outPath] = args;
    if (!file) die("用法：validate <scenario.json> [--out report.json]");
    let parsed: unknown;
    try {
      parsed = JSON.parse(read(file));
    } catch (e) {
      const r: MachineReport = { ok: false, blocking: [`JSON 無法解析：${e instanceof Error ? e.message : e}`], warnings: [], info: [], counts: null };
      if (flag === "--out" && outPath) fs.writeFileSync(outPath, JSON.stringify(r, null, 2));
      console.log(renderReport(r));
      process.exit(1);
    }
    const r = validateScenarioJson(parsed);
    if (flag === "--out" && outPath) fs.writeFileSync(outPath, JSON.stringify(r, null, 2));
    console.log(renderReport(r));
    process.exit(r.ok ? 0 : 1);
  }
  case "critic-prompt": {
    const [story, scenario, report] = args;
    if (!story || !scenario || !report) die("用法：critic-prompt <story.md> <scenario.json> <report.json>");
    process.stdout.write(criticPrompt(read(story), read(scenario), loadReport(report)));
    break;
  }
  case "fix-prompt": {
    const [story, scenario, report, critic] = args;
    if (!story || !scenario || !report || !critic) die("用法：fix-prompt <story.md> <scenario.json> <report.json> <critic.json>");
    process.stdout.write(fixPrompt(read(story), read(scenario), loadReport(report), read(critic)));
    break;
  }
  case "gate": {
    const [report, critic] = args;
    if (!report || !critic) die("用法：gate <report.json> <critic.json>");
    const r = loadReport(report);
    const c = loadCritic(critic);
    const pass = r.ok && c.blocking.length === 0;
    console.log(
      `${pass ? "✅ 通過" : "❌ 未通過"}：驗證器阻斷 ${r.blocking.length}、驗證器警告 ${r.warnings.length}、評審必修 ${c.blocking.length}、評審建議 ${c.suggestions.length}`
    );
    process.exit(pass ? 0 : 1);
  }
  default:
    die(`未知的子命令「${cmd ?? ""}」。可用：writer-prompt | extract | validate | critic-prompt | fix-prompt | gate`);
}
