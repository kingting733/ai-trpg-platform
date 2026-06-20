// Pure, client-safe objective definitions.
//
// An "objective" is a single concrete, checkable goal (e.g. "取回聖石並逃出神廟").
// Objectives are no longer the thing that ends the game — they are a TRACKER.
// Other systems judge progress against them by STABLE id:
//   - location unlock conditions  (objective:<id>)
//   - multi-ending conditions      (objective:<id>)
// The story now ends ONLY through the ending system (see lib/game/endings.ts).
//
// Stable ids are the whole point: renaming or reordering an objective must NOT
// break references that point at it — exactly the rename-safety we gave NPCs.
// That's why the editor generates a random id once and keeps it, instead of the
// old positional `obj_N` scheme that shifted whenever a line moved.

export type ObjectiveScope = "party" | "each_player";

export interface ScenarioObjective {
  /** Stable id, referenced by location/ending conditions as objective:<id>. */
  id: string;
  /** Player-meaningful goal text, shown as the friendly label everywhere. */
  text: string;
  /**
   * "party"       — any ONE player completing it satisfies the whole group.
   * "each_player" — EVERY surviving player must complete it individually.
   */
  scope: ObjectiveScope;
  /** Optional/bonus objectives don't gate a "all required done" check. */
  required: boolean;
}

export function newObjectiveId(): string {
  return `obj_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

export function emptyObjective(scope: ObjectiveScope = "party"): ScenarioObjective {
  return { id: newObjectiveId(), text: "", scope, required: true };
}

export function coerceScenarioObjectives(raw: unknown): ScenarioObjective[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((o) => o && typeof o === "object")
    .map((o: any): ScenarioObjective | null => {
      const text = typeof o.text === "string" ? o.text.trim() : "";
      if (!text) return null;
      return {
        id: typeof o.id === "string" && o.id.trim() ? o.id.trim() : newObjectiveId(),
        text: text.slice(0, 200),
        scope: o.scope === "each_player" ? "each_player" : "party",
        required: o.required !== false,
      };
    })
    .filter((o): o is ScenarioObjective => o !== null)
    .slice(0, 12);
}

/**
 * Migrate a legacy scenario's free-text objective boxes into structured
 * objectives. Ids are assigned as obj_1, obj_2, … in the SAME positional order
 * the old UI used (party lines first, then each-player lines), so any existing
 * `objective:obj_N` reference in endings/location conditions keeps pointing at
 * the same goal after migration. New objectives added later get random ids.
 */
export function objectivesFromLegacyText(
  winningTargets: string | null | undefined,
  eachPlayerTargets: string | null | undefined
): ScenarioObjective[] {
  const stripNum = (s: string) => s.replace(/^\s*\d+[.)、]\s*/, "").trim();
  const party = (winningTargets ?? "").split("\n").map(stripNum).filter(Boolean);
  const each = (eachPlayerTargets ?? "").split("\n").map(stripNum).filter(Boolean);
  const out: ScenarioObjective[] = [];
  let i = 1;
  for (const text of party) out.push({ id: `obj_${i++}`, text: text.slice(0, 200), scope: "party", required: true });
  for (const text of each) out.push({ id: `obj_${i++}`, text: text.slice(0, 200), scope: "each_player", required: true });
  return out;
}

/**
 * Resolve a scenario's effective objectives at runtime: prefer the structured
 * `objectives` column; fall back to migrating the legacy free-text boxes so
 * older scenarios (saved before structured objectives existed) still work.
 */
export function resolveScenarioObjectives(
  rawObjectives: unknown,
  winningTargets: string | null | undefined,
  eachPlayerTargets: string | null | undefined
): ScenarioObjective[] {
  const structured = coerceScenarioObjectives(rawObjectives);
  if (structured.length) return structured;
  return objectivesFromLegacyText(winningTargets, eachPlayerTargets);
}

/** {id, name} options for ConditionBuilder — friendly text, stable id value. */
export function objectiveOptions(objectives: ScenarioObjective[]): { id: string; name: string }[] {
  return objectives.filter((o) => o.text.trim()).map((o) => ({ id: o.id, name: o.text }));
}
