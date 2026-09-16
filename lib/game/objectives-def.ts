// Pure, client-safe objective definitions.
//
// An "objective" is a single concrete, checkable goal (e.g. "取回聖石並逃出神廟").
// Objectives are no longer the thing that ends the game — they are a TRACKER.
// Other systems judge progress against them by STABLE id:
//   - location unlock conditions  (objective:<id>)
//   - multi-ending conditions      (objective:<id>)
// The story now ends ONLY through the ending system (see lib/game/endings.ts).
//
// Every objective is TEAM-WIDE: any one character completing it satisfies the
// whole party. (The former "each_player" scope — every surviving player must do
// it personally — was removed: it could deadlock a room whenever a player who
// had not yet completed it could no longer act, and creators never needed it.)
//
// Stable ids are the whole point: renaming or reordering an objective must NOT
// break references that point at it — exactly the rename-safety we gave NPCs.
// That's why the editor generates a random id once and keeps it, instead of the
// old positional `obj_N` scheme that shifted whenever a line moved.

export interface ScenarioObjective {
  /** Stable id, referenced by location/ending conditions as objective:<id>. */
  id: string;
  /** Player-meaningful goal text, shown as the friendly label everywhere. */
  text: string;
  /** Optional/bonus objectives don't gate a "all required done" check. */
  required: boolean;
}

export function newObjectiveId(): string {
  return `obj_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

export function emptyObjective(): ScenarioObjective {
  return { id: newObjectiveId(), text: "", required: true };
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
        required: o.required !== false,
      };
    })
    .filter((o): o is ScenarioObjective => o !== null)
    .slice(0, 12);
}

/**
 * Migrate a legacy scenario's free-text objective boxes into structured
 * objectives. Ids are assigned as obj_1, obj_2, … in the SAME positional order
 * the old UI used (party lines first, then the old each-player lines), so any
 * existing `objective:obj_N` reference in endings/location conditions keeps
 * pointing at the same goal after migration. Old each-player lines become
 * ordinary team objectives. New objectives added later get random ids.
 */
export function objectivesFromLegacyText(
  winningTargets: string | null | undefined,
  eachPlayerTargets: string | null | undefined
): ScenarioObjective[] {
  const stripNum = (s: string) => s.replace(/^\s*\d+[.)、]\s*/, "").trim();
  const lines = [
    ...(winningTargets ?? "").split("\n"),
    ...(eachPlayerTargets ?? "").split("\n"),
  ].map(stripNum).filter(Boolean);
  return lines.map((text, i) => ({ id: `obj_${i + 1}`, text: text.slice(0, 200), required: true }));
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
