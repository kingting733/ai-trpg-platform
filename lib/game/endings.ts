// Server-authoritative multi-ending system.
//
// ScenarioEndings are defined by the creator; the server evaluates them every
// turn using pure code — no AI decides when the game ends. The AI is only
// called once to generate the personalised epilogue AFTER a trigger fires.
//
// Advanced Mode (endings[] non-empty) fully replaces Simple Mode
// (winning_targets / failure_conditions). Both modes co-exist per-scenario.

import type { LocationState, LocationGraph } from "@/lib/game/locations";

export type EndingType = "victory" | "failure" | "neutral";

export interface ScenarioEnding {
  /** Short unique id within the scenario, e.g. "true_end". */
  id: string;
  /** Player-visible ending name, e.g. "真結局 — 阿澤的救贖". */
  name: string;
  type: EndingType;
  /**
   * Any-of groups of all-of terms (same syntax as location unlock conditions)
   * plus three new terms:
   *   npc_dead:<name>   — NPC's alive flag is false in npc_states
   *   npc_alive:<name>  — NPC is NOT dead (or not in npc_states yet)
   *   objective:<id>    — objectiveProgress[id].done is true
   */
  condition: string[][];
  /**
   * Creator's directive for the AI epilogue. The AI expands this using the
   * actual story ledger to produce a personalised closing screen, e.g.
   * "阿澤終於得到了救贖，揭示了真相……描述每位角色的命運以及玩家的選擇帶來的後果。"
   */
  description: string;
  /**
   * Endings are evaluated in descending priority order; the first satisfied
   * ending wins. Default 0.
   */
  priority: number;
}

// ── Coercion ──────────────────────────────────────────────────────────────────

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function coerceCondition(v: unknown): string[][] {
  if (!Array.isArray(v)) return [];
  return v
    .map((g) =>
      Array.isArray(g)
        ? (g as unknown[]).map(asStr).filter(Boolean)
        : typeof g === "string" && g.trim()
        ? [g.trim()]
        : []
    )
    .filter((g) => g.length > 0);
}

export function coerceEndings(raw: unknown): ScenarioEnding[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((e) => e && typeof e === "object" && asStr((e as any).name))
    .map((e: any, i) => ({
      id: asStr(e.id) || `end_${i}`,
      name: asStr(e.name),
      type: (["victory", "failure", "neutral"] as const).includes(e.type)
        ? (e.type as EndingType)
        : "neutral",
      condition: coerceCondition(e.condition),
      description: asStr(e.description),
      priority: Number.isFinite(Number(e.priority)) ? Number(e.priority) : 0,
    }))
    .slice(0, 10)
    .sort((a, b) => b.priority - a.priority);
}

// ── Evaluation (pure code — no AI) ────────────────────────────────────────────

function evalEndingTerm(
  term: string,
  locState: LocationState | null,
  graph: LocationGraph | null,
  npcStates: Record<string, { alive: boolean }>,
  objectiveProgress: Record<string, { done?: boolean }>,
  currentRound: number,
): boolean {
  const colonIdx = term.indexOf(":");
  if (colonIdx === -1) return false;
  const kind = term.slice(0, colonIdx);
  const rest = term.slice(colonIdx + 1);

  switch (kind) {
    case "npc_dead": {
      const s = npcStates[rest];
      return s !== undefined && s.alive === false;
    }
    case "npc_alive": {
      const s = npcStates[rest];
      return s === undefined || s.alive !== false;
    }
    case "objective":
      return objectiveProgress[rest]?.done === true;

    // Location-system terms (same logic as evalTerm in locations.ts)
    case "visit":
      return locState?.visited.includes(rest) ?? false;
    case "item":
      return locState?.evidence_found.includes(rest) ?? false;
    case "count": {
      if (!locState || !graph) return false;
      const sepIdx = rest.lastIndexOf(":");
      if (sepIdx === -1) return false;
      const tag = rest.slice(0, sepIdx);
      const n = Number(rest.slice(sepIdx + 1));
      if (!tag || !Number.isFinite(n)) return false;
      const have = graph.nodes
        .flatMap((node) => node.evidence)
        .filter((e) => locState.evidence_found.includes(e.id) && e.tags.includes(tag)).length;
      return have >= n;
    }
    case "round":
      return currentRound >= Number(rest);
    case "after": {
      if (!locState) return false;
      const sepIdx = rest.lastIndexOf(":");
      if (sepIdx === -1) return false;
      const nodeId = rest.slice(0, sepIdx);
      const n = Number(rest.slice(sepIdx + 1));
      const entered = locState.entered_round[nodeId];
      return entered !== undefined && currentRound - entered >= n;
    }
    default:
      return false;
  }
}

/**
 * Return the first (highest-priority) ending whose conditions are all met,
 * or null if none are satisfied. Endings with an empty condition never fire.
 */
export function evaluateEndings(
  endings: ScenarioEnding[],
  locState: LocationState | null,
  graph: LocationGraph | null,
  npcStates: Record<string, { alive: boolean }>,
  objectiveProgress: Record<string, { done?: boolean }>,
  currentRound: number,
): ScenarioEnding | null {
  for (const ending of endings) {
    if (ending.condition.length === 0) continue;
    const satisfied = ending.condition.some((group) =>
      group.every((term) =>
        evalEndingTerm(term, locState, graph, npcStates, objectiveProgress, currentRound)
      )
    );
    if (satisfied) return ending;
  }
  return null;
}
