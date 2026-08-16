// The publish bar — the minimum a scenario must clear before it can be shown
// to other players. Pure rules, no I/O, so the same check runs in the editor
// (to tell a creator what is missing) and in the submit route (to enforce it).
//
// WHY A BAR AT ALL: anyone can write a scenario, and until now anyone could put
// it straight on the public list. The failure mode is not malice, it is a
// half-finished scenario — three locations, nothing to find, no ending that can
// ever trigger — which wastes a whole party's evening before they notice.
//
// EVERY RULE HERE IS MECHANICAL, never a judgement about writing quality. Each
// one corresponds to something the engine literally cannot do without:
// somewhere to go, something to find, a way for the story to end, and prose for
// the GM to read. Taste is the reviewer's job (see the review queue); this is
// the floor.

import { coerceLocationGraph } from "@/lib/game/locations";
import { coerceEndings } from "@/lib/game/endings";
import { coerceScenarioObjectives } from "@/lib/game/objectives-def";

/** Minimums. Deliberately low — this is a floor, not a standard. */
export const QUALITY_BAR = {
  minLocations: 3,
  minEvidence: 2,
  minEndings: 1,
  minObjectives: 1,
  minStoryChars: 200,
  minDescriptionChars: 20,
} as const;

export interface QualityFailure {
  /** Stable key for tests and for linking the message to a field. */
  key:
    | "title"
    | "description"
    | "locations"
    | "evidence"
    | "endings"
    | "ending_conditions"
    | "objectives"
    | "full_story"
    | "opening_scene";
  /** Player-facing zh-TW explanation of what is missing and why it matters. */
  message: string;
}

/** The scenario columns the bar reads. Loose on purpose — the row comes
 *  straight from Supabase, and the editor passes a draft of the same shape. */
export interface ScenarioQualityInput {
  title?: string | null;
  description?: string | null;
  opening_scene?: string | null;
  source_document?: string | null;
  location_graph?: unknown;
  endings?: unknown;
  objectives?: unknown;
  winning_targets?: string | null;
  each_player_targets?: string | null;
}

function len(v: unknown): number {
  return typeof v === "string" ? v.trim().length : 0;
}

/**
 * Check a scenario against the publish bar.
 *
 * Returns EVERY failure, not just the first — a creator fixing one thing at a
 * time and resubmitting five times is a worse experience than one honest list.
 */
export function checkScenarioQuality(s: ScenarioQualityInput): {
  ok: boolean;
  failures: QualityFailure[];
} {
  const failures: QualityFailure[] = [];

  if (len(s.title) < 2) {
    failures.push({ key: "title", message: "劇本需要一個名字。" });
  }
  if (len(s.description) < QUALITY_BAR.minDescriptionChars) {
    failures.push({
      key: "description",
      message: `簡介至少 ${QUALITY_BAR.minDescriptionChars} 個字——這是別人在列表上唯一看得到的東西。`,
    });
  }

  const graph = coerceLocationGraph(s.location_graph);
  const nodes = graph?.nodes ?? [];
  if (nodes.length < QUALITY_BAR.minLocations) {
    failures.push({
      key: "locations",
      message: `至少需要 ${QUALITY_BAR.minLocations} 個地點（目前 ${nodes.length} 個）。只有一兩個地點的話，玩家沒有地方可以探索。`,
    });
  }

  const evidenceCount = nodes.reduce((n, node) => n + (node.evidence?.length ?? 0), 0);
  if (evidenceCount < QUALITY_BAR.minEvidence) {
    failures.push({
      key: "evidence",
      message: `至少需要 ${QUALITY_BAR.minEvidence} 件證物（目前 ${evidenceCount} 件）。沒有東西可以找，調查就不成立。`,
    });
  }

  const endings = coerceEndings(s.endings);
  if (endings.length < QUALITY_BAR.minEndings) {
    failures.push({
      key: "endings",
      message: "至少需要 1 個結局，否則這個故事永遠不會結束。",
    });
  } else {
    // An ending whose condition is empty can never fire — the scenario looks
    // finished in the editor and then runs forever.
    const triggerable = endings.filter(
      (e) => Array.isArray(e.condition) && e.condition.some((g) => Array.isArray(g) && g.length > 0)
    );
    if (triggerable.length === 0) {
      failures.push({
        key: "ending_conditions",
        message: "沒有任何結局寫了觸發條件——這些結局永遠不會發生。至少給一個結局設定條件。",
      });
    }
  }

  const objectives = coerceScenarioObjectives(s.objectives);
  const hasLegacyTargets = len(s.winning_targets) > 0 || len(s.each_player_targets) > 0;
  if (objectives.length < QUALITY_BAR.minObjectives && !hasLegacyTargets) {
    failures.push({
      key: "objectives",
      message: "至少需要 1 個任務目標，玩家才知道自己在追什麼。",
    });
  }

  if (len(s.source_document) < QUALITY_BAR.minStoryChars) {
    failures.push({
      key: "full_story",
      message: `故事原文至少 ${QUALITY_BAR.minStoryChars} 個字（目前 ${len(s.source_document)} 字）。AI 主持人靠這一段理解全貌，少了它敘事品質會明顯下降。`,
    });
  }

  if (len(s.opening_scene) < 20) {
    failures.push({
      key: "opening_scene",
      message: "需要開場場景——這是玩家看到的第一段文字。",
    });
  }

  return { ok: failures.length === 0, failures };
}
