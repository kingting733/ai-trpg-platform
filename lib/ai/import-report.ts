// Import report — turns SILENT field-dropping into visible feedback.
//
// A scenario JSON produced by a foreign LLM (ChatGPT / Claude / Gemini / …)
// is untrusted, plausible-but-often-invalid input: it invents unlock terms,
// references node ids that don't exist, and overflows the graph caps. All of
// that is handled safely by coerceLocationGraph / normalizeImported — but
// SILENTLY. The creator sees "imported!" and never learns that 5 of their 45
// locations were sliced away or that a path was discarded.
//
// This module diffs the RAW parsed JSON against the NORMALIZED result and
// reports exactly what survived, what was dropped, and what the authoring
// validator complains about. Pure — no I/O, no AI.

import {
  GRAPH_CAPS,
  coerceLocationGraph,
  validateLocationGraph,
  type LocationGraph,
} from "@/lib/game/locations";
import type { ImportedScenario } from "@/lib/ai/import-scenario";

/** Top-level keys the importer actually consumes. Anything else the LLM
 *  invented is reported so the creator knows it had no effect. */
const KNOWN_KEYS = new Set([
  "language", "title", "genre", "difficulty", "description", "objective",
  "max_players", "estimated_play_time", "tags", "opening_scene",
  "locations", "npcs", "objectives", "winning_targets", "each_player_targets",
  "failure_conditions", "failure_turn_limit", "ending_conditions", "gm_notes",
  "location_graph", "endings",
  // Not a scenario column, but meaningful: the original prose, stored as
  // source_document and fed to the GM at play time.
  "full_story",
]);

export interface ImportCounts {
  locations: number;
  npcs: number;
  objectives: number;
  endings: number;
  nodes: number;
  containers: number;
  edges: number;
  evidence: number;
  npcPlacements: number;
  npcEncounters: number;
}

export interface ImportReport {
  counts: ImportCounts;
  /** Top-level keys in the JSON that the importer ignores entirely. */
  unknownKeys: string[];
  /** Authored content that coercion discarded (cap overflow, dangling refs). */
  dropped: string[];
  /** Authoring problems (invalid unlock terms, unreachable nodes, …) plus
   *  this module's own findings. zh-TW, creator-facing. */
  warnings: string[];
  /** Whether the JSON carried the original prose. Without it the GM's
   *  source document becomes the JSON blob itself — narration quality tanks. */
  hasFullStory: boolean;
  /** True when nothing was dropped and there are no warnings. */
  ok: boolean;
}

function countEvidence(graph: LocationGraph | null): number {
  if (!graph) return 0;
  return graph.nodes.reduce((n, node) => n + node.evidence.length, 0);
}

function arrLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

/**
 * Compare what the LLM emitted against what the platform kept.
 * `raw` is the parsed JSON as-is; `normalized` is normalizeImported(raw).
 */
export function buildImportReport(raw: any, normalized: ImportedScenario): ImportReport {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const graph = normalized.location_graph;

  const counts: ImportCounts = {
    locations: normalized.locations.length,
    npcs: normalized.npcs.length,
    objectives: normalized.objectives.length,
    endings: normalized.endings.length,
    nodes: graph?.nodes.length ?? 0,
    containers: graph?.containers.length ?? 0,
    edges: graph?.edges.length ?? 0,
    evidence: countEvidence(graph),
    npcPlacements: graph?.npc_placements.length ?? 0,
    npcEncounters: graph?.npc_encounters.length ?? 0,
  };

  const unknownKeys = Object.keys(src).filter((k) => !KNOWN_KEYS.has(k)).sort();

  // ── Losses: compare the RAW arrays against what survived coercion ──────────
  const dropped: string[] = [];
  const rawGraph = src.location_graph;
  const lost = (label: string, before: number, after: number, cap?: number) => {
    if (before > after) {
      dropped.push(
        `${label}：輸入 ${before} 個，實際保留 ${after} 個` +
        (cap != null && before > cap ? `（超過上限 ${cap}）` : "（無效或重複的項目已被移除）")
      );
    }
  };
  if (rawGraph && typeof rawGraph === "object") {
    lost("地點", arrLen(rawGraph.nodes), counts.nodes, GRAPH_CAPS.nodes);
    lost("區域", arrLen(rawGraph.containers), counts.containers, GRAPH_CAPS.containers);
    lost("路徑", arrLen(rawGraph.edges), counts.edges, GRAPH_CAPS.edges);
    lost("NPC 位置設定", arrLen(rawGraph.npc_placements), counts.npcPlacements, GRAPH_CAPS.npc_placements);
    lost("NPC 觸發事件", arrLen(rawGraph.npc_encounters), counts.npcEncounters, GRAPH_CAPS.npc_encounters);
  }
  lost("NPC", arrLen(src.npcs), counts.npcs);
  lost("任務目標", arrLen(src.objectives), counts.objectives);
  lost("結局", arrLen(src.endings), counts.endings);

  // ── Warnings: the authoring validator + our own checks ────────────────────
  const warnings: string[] = [];

  const hasFullStory = typeof src.full_story === "string" && src.full_story.trim().length > 0;
  if (!hasFullStory) {
    warnings.push(
      "JSON 缺少 full_story（故事原文）。AI 主持人會把「原始文件」當作劇本全文來讀 —— " +
      "沒有原文的話它只能讀到這份 JSON 本身，敘事品質會明顯下降。請在 JSON 內補上 full_story，" +
      "或匯入後手動把故事原文貼到「原始文件」欄位。"
    );
  }

  if (unknownKeys.length) {
    warnings.push(
      `以下欄位不屬於本平台的格式，已被忽略（不會有任何效果）：${unknownKeys.join("、")}。`
    );
  }

  // Re-validate the coerced graph exactly as the editor does, so invalid unlock
  // terms / unreachable nodes / dangling NPC refs surface at IMPORT time
  // instead of being discovered mid-playtest.
  if (graph) {
    const npcRefs = new Set<string>();
    for (const n of normalized.npcs) {
      if (n && typeof (n as any).name === "string") npcRefs.add((n as any).name);
      if (n && typeof (n as any).id === "string") npcRefs.add((n as any).id);
    }
    const objectiveIds = new Set(normalized.objectives.map((o) => o.id));
    warnings.push(
      ...validateLocationGraph(graph, npcRefs.size ? npcRefs : undefined, objectiveIds.size ? objectiveIds : undefined)
    );
  } else if (rawGraph) {
    warnings.push("location_graph 無法解析，地點系統未匯入 —— 請檢查它是否為合法的物件且含有 nodes 陣列。");
  }

  return {
    counts,
    unknownKeys,
    dropped,
    warnings,
    hasFullStory,
    ok: dropped.length === 0 && warnings.length === 0,
  };
}

/** Convenience for callers holding only the raw JSON (e.g. a paste box preview). */
export function reportFromRaw(raw: any, normalized: ImportedScenario): ImportReport {
  return buildImportReport(raw, normalized);
}

/** Re-coerce a graph from raw JSON — used by callers that want the coerced
 *  graph and the report in one step. */
export function coerceGraphForReport(rawGraph: unknown): LocationGraph | null {
  return coerceLocationGraph(rawGraph);
}
