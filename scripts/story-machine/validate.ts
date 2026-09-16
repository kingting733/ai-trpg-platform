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
    if (/(或者|或是|，或|或(?!許))/.test(o.text)) {
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
