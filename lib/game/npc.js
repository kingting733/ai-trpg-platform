"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.newNpcId = newNpcId;
exports.ensureNpcIds = ensureNpcIds;
exports.resolveNpc = resolveNpc;
exports.npcDisplayName = npcDisplayName;
exports.npcStateKey = npcStateKey;
exports.npcStateEntry = npcStateEntry;
exports.migrateNpcRefList = migrateNpcRefList;
exports.migrateNpcRefsInConditions = migrateNpcRefsInConditions;
/** Mint a stable, collision-resistant id for a newly created NPC. */
function newNpcId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `npc_${crypto.randomUUID().slice(0, 8)}`;
    }
    return `npc_${Math.random().toString(36).slice(2, 10)}`;
}
/** Backfill ids for roster entries missing one. EDITOR-ONLY (see file header). */
function ensureNpcIds(roster) {
    return roster.map((n) => (n.id ? n : { ...n, id: newNpcId() }));
}
/** Resolve a reference (id preferred, name fallback) to its roster entry. */
function resolveNpc(ref, roster) {
    if (!ref)
        return undefined;
    return roster.find((n) => n.id === ref) ?? roster.find((n) => n.name === ref);
}
/** Display name for a reference; falls back to the raw ref if unknown. */
function npcDisplayName(ref, roster) {
    return resolveNpc(ref, roster)?.name ?? ref;
}
/** Canonical key under which an NPC's runtime state is stored (id if known,
 *  else name — both stable). */
function npcStateKey(ref, roster) {
    const e = resolveNpc(ref, roster);
    return e?.id ?? e?.name ?? ref;
}
/** Look up an NPC's runtime state entry, tolerant of id- or name-keyed state. */
function npcStateEntry(ref, roster, states) {
    const e = resolveNpc(ref, roster);
    if (e)
        return (e.id ? states[e.id] : undefined) ?? states[e.name];
    return states[ref];
}
// ── Editor-side migration: rewrite name-based refs to ids ─────────────────────
/** Rewrite the `npc` field of placement/encounter rows from name → id. */
function migrateNpcRefList(list, roster) {
    return list.map((row) => {
        const id = resolveNpc(row.npc, roster)?.id;
        return id && id !== row.npc ? { ...row, npc: id } : row;
    });
}
/** Rewrite npc_dead:/npc_alive: terms inside ending conditions from name → id. */
function migrateNpcRefsInConditions(conds, roster) {
    return conds.map((group) => group.map((term) => {
        for (const kind of ["npc_dead", "npc_alive"]) {
            const prefix = `${kind}:`;
            if (term.startsWith(prefix)) {
                const ref = term.slice(prefix.length);
                const id = resolveNpc(ref, roster)?.id;
                return id ? `${prefix}${id}` : term;
            }
        }
        return term;
    }));
}
