// Stable NPC identity + tolerant reference resolution.
//
// NPCs are authored in the scenario roster (NpcEntry, lib/ai/gm.ts) and
// referenced from three places by string: location placements, encounters, and
// ending conditions (npc_dead:/npc_alive:). Historically that string was the
// NPC's display NAME, so renaming an NPC silently broke every reference and the
// runtime npc_states it had accumulated.
//
// Each NpcEntry now carries a stable `id`. New references store the id;
// resolution accepts EITHER id or name, so legacy data — name-based refs and
// id-less rosters — keeps working unchanged. IMPORTANT: ids are minted only in
// the editor (and persisted on save). The runtime never mints ids (that would
// produce a fresh random key every turn and break state continuity); it only
// consumes persisted ids, falling back to the name as the stable key.

export interface NpcRef {
  id?: string;
  name: string;
}

/** Mint a stable, collision-resistant id for a newly created NPC. */
export function newNpcId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `npc_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `npc_${Math.random().toString(36).slice(2, 10)}`;
}

/** Backfill ids for roster entries missing one. EDITOR-ONLY (see file header). */
export function ensureNpcIds<T extends NpcRef>(roster: T[]): T[] {
  return roster.map((n) => (n.id ? n : { ...n, id: newNpcId() }));
}

/** Resolve a reference (id preferred, name fallback) to its roster entry. */
export function resolveNpc<T extends NpcRef>(ref: string, roster: T[]): T | undefined {
  if (!ref) return undefined;
  return roster.find((n) => n.id === ref) ?? roster.find((n) => n.name === ref);
}

/** Display name for a reference; falls back to the raw ref if unknown. */
export function npcDisplayName(ref: string, roster: NpcRef[]): string {
  return resolveNpc(ref, roster)?.name ?? ref;
}

/** Canonical key under which an NPC's runtime state is stored (id if known,
 *  else name — both stable). */
export function npcStateKey(ref: string, roster: NpcRef[]): string {
  const e = resolveNpc(ref, roster);
  return e?.id ?? e?.name ?? ref;
}

/** Look up an NPC's runtime state entry, tolerant of id- or name-keyed state. */
export function npcStateEntry<V>(
  ref: string,
  roster: NpcRef[],
  states: Record<string, V>,
): V | undefined {
  const e = resolveNpc(ref, roster);
  if (e) return (e.id ? states[e.id] : undefined) ?? states[e.name];
  return states[ref];
}

// ── Editor-side migration: rewrite name-based refs to ids ─────────────────────

/** Rewrite the `npc` field of placement/encounter rows from name → id. */
export function migrateNpcRefList<T extends { npc: string }>(list: T[], roster: NpcRef[]): T[] {
  return list.map((row) => {
    const id = resolveNpc(row.npc, roster)?.id;
    return id && id !== row.npc ? { ...row, npc: id } : row;
  });
}

/** Rewrite npc_dead:/npc_alive: terms inside ending conditions from name → id. */
export function migrateNpcRefsInConditions(conds: string[][], roster: NpcRef[]): string[][] {
  return conds.map((group) =>
    group.map((term) => {
      for (const kind of ["npc_dead", "npc_alive"] as const) {
        const prefix = `${kind}:`;
        if (term.startsWith(prefix)) {
          const ref = term.slice(prefix.length);
          const id = resolveNpc(ref, roster)?.id;
          return id ? `${prefix}${id}` : term;
        }
      }
      return term;
    })
  );
}
