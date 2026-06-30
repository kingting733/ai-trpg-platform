// Party-wide, emergent item tracker.
//
// SOFT system by design: the inventory is CONTEXT for the GM (so it stops
// forgetting earned items or inventing ones the party never picked up). It is
// NEVER read by unlock/ending condition logic — only the 證物 (evidence) system
// gates progression. An item that IS a 證物 carries its stable evidence_id, so
// the inventory contains evidence as a visible subset without ever becoming a
// second source of truth. Because it never gates anything, a wrong item in the
// list is low-stakes — exactly why it can be driven by per-turn GM judgment.

export interface InventoryItem {
  /** Display name / identity of the item. */
  name: string;
  /** Short context: where/how it was obtained. */
  note?: string;
  /** If this item is also a 證物, its stable evidence id; otherwise null. */
  evidence_id?: string | null;
  /** Round it was acquired (for logs/debugging). */
  round?: number;
}

export interface ItemEvent {
  name: string;
  note?: string;
}

const norm = (s: string) => s.trim().toLowerCase();
const MAX_ITEMS = 100;

export function coerceInventory(raw: unknown): InventoryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: InventoryItem[] = [];
  const seen = new Set<string>();
  for (const it of raw as unknown[]) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name) continue;
    const key = norm(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: name.slice(0, 80),
      note: typeof o.note === "string" && o.note.trim() ? o.note.trim().slice(0, 200) : undefined,
      evidence_id: typeof o.evidence_id === "string" && o.evidence_id.trim() ? o.evidence_id.trim() : null,
      round: typeof o.round === "number" ? o.round : undefined,
    });
  }
  return out.slice(0, MAX_ITEMS);
}

/**
 * Apply the GM-emitted acquire/consume events for this turn. Pure: returns a new
 * list plus what actually changed (for system logs). Dedupe and removal are by
 * normalized name. A 證物-backed item can NOT be consumed here — those are
 * progression-critical and owned by the evidence system, not this soft layer.
 */
export function applyItemEvents(
  current: InventoryItem[],
  acquired: ItemEvent[],
  consumed: string[],
  round: number,
): { next: InventoryItem[]; added: InventoryItem[]; removed: string[] } {
  const map = new Map<string, InventoryItem>();
  for (const it of current) map.set(norm(it.name), it);

  const added: InventoryItem[] = [];
  for (const ev of acquired) {
    const name = (ev?.name ?? "").trim();
    if (!name) continue;
    const key = norm(name);
    if (map.has(key)) continue; // already held — don't duplicate
    const item: InventoryItem = {
      name: name.slice(0, 80),
      note: ev.note?.trim() ? ev.note.trim().slice(0, 200) : undefined,
      evidence_id: null,
      round,
    };
    map.set(key, item);
    added.push(item);
  }

  const removed: string[] = [];
  for (const c of consumed) {
    const name = (c ?? "").trim();
    if (!name) continue;
    const existing = map.get(norm(name));
    if (existing && !existing.evidence_id) {
      map.delete(norm(name));
      removed.push(existing.name);
    }
  }

  return { next: Array.from(map.values()).slice(0, MAX_ITEMS), added, removed };
}

/**
 * The bridge: fold a freshly-awarded 證物 into the inventory so players see it in
 * their bag. Idempotent by evidence_id and by name. The evidence system remains
 * the sole authority over progression; this is purely so the bag is complete.
 */
export function addEvidenceItem(
  current: InventoryItem[],
  name: string,
  evidenceId: string,
  round: number,
): InventoryItem[] {
  const exists = current.some(
    (it) => it.evidence_id === evidenceId || norm(it.name) === norm(name),
  );
  if (exists) return current;
  return [...current, { name: name.trim().slice(0, 80), evidence_id: evidenceId, round }].slice(0, MAX_ITEMS);
}

/** GM-facing possessions block. Null when the bag is empty. */
export function buildInventoryBlock(items: InventoryItem[]): string | null {
  if (!items.length) return null;
  const list = items.map((it) => it.name).join("、");
  return (
    `CURRENT PARTY POSSESSIONS (authoritative — the party holds EXACTLY these items, nothing more):\n${list}\n` +
    `The party does NOT possess any item not on this list. Do not let a character use, produce, or rely on an item they do not hold; if a player claims one, narrate its absence naturally. When your narration clearly has the party pick up a new item or use one up, report it via the "items" field.`
  );
}
