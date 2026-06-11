// Server-authoritative location unlock system.
//
// The SCENARIO defines a location graph (nodes + unlock conditions). The ROOM
// carries the live state (current location, per-node status, evidence found).
// All state transitions happen in code — the AI GM is only TOLD the state and
// given narration directives; it never decides what is locked or unlocked.
// This mirrors the objectives/npc_states pattern used elsewhere.

// ── Types ─────────────────────────────────────────────────────────────────────

export type LocationStatus = "hidden" | "discovered" | "unlocked";

/** One unlock term. Supported forms:
 *  - "visit:<nodeId>"        party has entered that node at least once
 *  - "item:<evidenceId>"     party has found that evidence
 *  - "count:<tag>:<n>"       party holds >= n evidence pieces carrying <tag>
 *  - "round:<n>"             current round >= n
 *  - "after:<nodeId>:<n>"    >= n rounds have passed since first entering node
 */
export type UnlockTerm = string;

export interface EvidenceDef {
  id: string;
  name: string;
  /** Tags used by count:<tag>:<n> conditions (e.g. "azhe_identity"). */
  tags: string[];
  /** How it can be obtained — matched against the player's action text. */
  how: string;
}

export interface LocationNode {
  id: string;
  name: string;
  /** GM-facing scene notes. */
  desc: string;
  initial: LocationStatus;
  /** Any-of groups of all-of terms: [[a,b],[c]] = (a AND b) OR c. */
  unlock: UnlockTerm[][];
  evidence: EvidenceDef[];
  /** GM beat for the party's FIRST entry. */
  on_enter: string;
  /** In-world flavour for why entry fails while locked. */
  locked_narration: string;
  /** Hint the GM may surface when the party is stuck here. */
  stuck_hint: string;
  /** Node ids that become "discovered" when the party first enters this node. */
  discovers: string[];
}

export interface LocationGraph {
  nodes: LocationNode[];
}

export interface LocationState {
  current: string | null;
  status: Record<string, LocationStatus>;
  visited: string[];
  /** Round on which the party FIRST entered each node (for after: gates). */
  entered_round: Record<string, number>;
  evidence_found: string[];
  /** Consecutive turns with no travel/evidence/unlock progress. */
  stuck_counter: number;
}

// ── Coercion / validation ─────────────────────────────────────────────────────

const STATUSES: LocationStatus[] = ["hidden", "discovered", "unlocked"];

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(asStr).filter(Boolean) : [];
}

function coerceUnlock(v: unknown): UnlockTerm[][] {
  if (!Array.isArray(v)) return [];
  return v
    .map((g) => (Array.isArray(g) ? g.map(asStr).filter(Boolean) : typeof g === "string" && g.trim() ? [g.trim()] : []))
    .filter((g) => g.length > 0);
}

function coerceEvidence(v: unknown): EvidenceDef[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e) => e && typeof e === "object" && asStr((e as any).id))
    .map((e: any) => ({
      id: asStr(e.id),
      name: asStr(e.name) || asStr(e.id),
      tags: asStrArr(e.tags),
      how: asStr(e.how),
    }))
    .slice(0, 20);
}

/** Coerce arbitrary JSON into a valid LocationGraph, or null if unusable. */
export function coerceLocationGraph(raw: any): LocationGraph | null {
  const nodesRaw = Array.isArray(raw?.nodes) ? raw.nodes : Array.isArray(raw) ? raw : null;
  if (!nodesRaw) return null;
  const nodes: LocationNode[] = nodesRaw
    .filter((n: any) => n && typeof n === "object" && asStr(n.id) && asStr(n.name))
    .map((n: any) => ({
      id: asStr(n.id),
      name: asStr(n.name),
      desc: asStr(n.desc),
      initial: STATUSES.includes(n.initial) ? n.initial : "hidden",
      unlock: coerceUnlock(n.unlock),
      evidence: coerceEvidence(n.evidence),
      on_enter: asStr(n.on_enter),
      locked_narration: asStr(n.locked_narration),
      stuck_hint: asStr(n.stuck_hint),
      discovers: asStrArr(n.discovers),
    }))
    .slice(0, 40);
  // Dedupe ids — first definition wins.
  const seen = new Set<string>();
  const deduped = nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  if (deduped.length === 0) return null;
  // At least one node must be initially enterable, or the game can never start.
  if (!deduped.some((n) => n.initial === "unlocked")) deduped[0].initial = "unlocked";
  return { nodes: deduped };
}

/** Authoring-time validation — returns human-readable warnings (zh-TW). */
export function validateLocationGraph(graph: LocationGraph): string[] {
  const warnings: string[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const evidenceIds = new Set(graph.nodes.flatMap((n) => n.evidence.map((e) => e.id)));
  const evidenceTags = new Set(graph.nodes.flatMap((n) => n.evidence.flatMap((e) => e.tags)));

  for (const n of graph.nodes) {
    for (const ref of n.discovers) {
      if (!ids.has(ref)) warnings.push(`地點「${n.name}」的 discovers 引用了不存在的地點 id：${ref}`);
    }
    for (const group of n.unlock) {
      for (const term of group) {
        const parts = term.split(":");
        const kind = parts[0];
        if (kind === "visit" || kind === "after") {
          if (!ids.has(parts[1] ?? "")) warnings.push(`地點「${n.name}」的解鎖條件引用了不存在的地點 id：${term}`);
        } else if (kind === "item") {
          if (!evidenceIds.has(parts[1] ?? "")) warnings.push(`地點「${n.name}」的解鎖條件引用了不存在的證物 id：${term}`);
        } else if (kind === "count") {
          if (!evidenceTags.has(parts[1] ?? "")) warnings.push(`地點「${n.name}」的解鎖條件引用了沒有任何證物使用的標籤：${term}`);
          if (!Number.isFinite(Number(parts[2]))) warnings.push(`地點「${n.name}」的 count 條件缺少數量：${term}`);
        } else if (kind === "round") {
          if (!Number.isFinite(Number(parts[1]))) warnings.push(`地點「${n.name}」的 round 條件缺少回合數：${term}`);
        } else {
          warnings.push(`地點「${n.name}」含無法識別的解鎖條件：${term}（支援 visit:/item:/count:/round:/after:）`);
        }
      }
    }
    if (n.initial !== "unlocked" && n.unlock.length === 0 && !graph.nodes.some((m) => m.discovers.includes(n.id))) {
      warnings.push(`地點「${n.name}」被鎖定但沒有任何解鎖條件，也沒有其他地點能發現它 — 玩家永遠到不了。`);
    }
  }
  return warnings;
}

// ── State ─────────────────────────────────────────────────────────────────────

export function initLocationState(graph: LocationGraph): LocationState {
  const status: Record<string, LocationStatus> = {};
  for (const n of graph.nodes) status[n.id] = n.initial;
  const first = graph.nodes.find((n) => n.initial === "unlocked");
  return {
    current: first?.id ?? null,
    status,
    visited: first ? [first.id] : [],
    entered_round: first ? { [first.id]: 1 } : {},
    evidence_found: [],
    stuck_counter: 0,
  };
}

export function coerceLocationState(raw: any, graph: LocationGraph): LocationState {
  if (!raw || typeof raw !== "object") return initLocationState(graph);
  const base = initLocationState(graph);
  const status: Record<string, LocationStatus> = { ...base.status };
  if (raw.status && typeof raw.status === "object") {
    for (const [k, v] of Object.entries(raw.status)) {
      if (status[k] !== undefined && STATUSES.includes(v as LocationStatus)) status[k] = v as LocationStatus;
    }
  }
  return {
    current: typeof raw.current === "string" && status[raw.current] ? raw.current : base.current,
    status,
    visited: asStrArr(raw.visited).filter((id) => status[id] !== undefined),
    entered_round:
      raw.entered_round && typeof raw.entered_round === "object"
        ? Object.fromEntries(
            Object.entries(raw.entered_round).filter(
              ([k, v]) => status[k] !== undefined && Number.isFinite(Number(v))
            ).map(([k, v]) => [k, Number(v)])
          )
        : base.entered_round,
    evidence_found: asStrArr(raw.evidence_found),
    stuck_counter: Number.isFinite(Number(raw.stuck_counter)) ? Number(raw.stuck_counter) : 0,
  };
}

// ── Condition evaluation (pure code — no AI) ──────────────────────────────────

function evalTerm(term: UnlockTerm, state: LocationState, graph: LocationGraph, currentRound: number): boolean {
  const parts = term.split(":");
  switch (parts[0]) {
    case "visit":
      return state.visited.includes(parts[1] ?? "");
    case "item":
      return state.evidence_found.includes(parts[1] ?? "");
    case "count": {
      const tag = parts[1] ?? "";
      const need = Number(parts[2]);
      if (!tag || !Number.isFinite(need)) return false;
      const have = graph.nodes
        .flatMap((n) => n.evidence)
        .filter((e) => state.evidence_found.includes(e.id) && e.tags.includes(tag)).length;
      return have >= need;
    }
    case "round":
      return currentRound >= Number(parts[1]);
    case "after": {
      const entered = state.entered_round[parts[1] ?? ""];
      return entered !== undefined && currentRound - entered >= Number(parts[2]);
    }
    default:
      return false;
  }
}

function unlockSatisfied(node: LocationNode, state: LocationState, graph: LocationGraph, currentRound: number): boolean {
  if (node.unlock.length === 0) return false; // no conditions → only discovers[]/initial can open it
  return node.unlock.some((group) => group.every((t) => evalTerm(t, state, graph, currentRound)));
}

export interface UnlockChanges {
  unlocked: LocationNode[];
  discovered: LocationNode[];
}

/** Re-evaluate every non-unlocked node. Mutates state.status; returns changes.
 *  A node whose conditions are met goes straight to "unlocked" (even from
 *  hidden — finding the way IS the discovery). */
export function evaluateUnlocks(graph: LocationGraph, state: LocationState, currentRound: number): UnlockChanges {
  const changes: UnlockChanges = { unlocked: [], discovered: [] };
  for (const node of graph.nodes) {
    if (state.status[node.id] === "unlocked") continue;
    if (unlockSatisfied(node, state, graph, currentRound)) {
      state.status[node.id] = "unlocked";
      changes.unlocked.push(node);
    }
  }
  return changes;
}

/** Mark nodes listed in `discovers` of an entered node: hidden → discovered. */
export function applyDiscovers(graph: LocationGraph, state: LocationState, enteredNodeId: string): LocationNode[] {
  const node = graph.nodes.find((n) => n.id === enteredNodeId);
  if (!node) return [];
  const out: LocationNode[] = [];
  for (const id of node.discovers) {
    if (state.status[id] === "hidden") {
      state.status[id] = "discovered";
      const ref = graph.nodes.find((n) => n.id === id);
      if (ref) out.push(ref);
    }
  }
  return out;
}

// ── Fuzzy matching (shared with the media-reveal logic style) ─────────────────

function shortName(name: string): string {
  return name.trim().split(/[：:，,。．\.\n——–\-（(【\[]/)[0].trim().slice(0, 30);
}

function nameSegments(sn: string): string[] {
  return sn
    .split(/[的之\s、與和及\/]+/)
    .map((t) => t.trim())
    .filter((t) => (/^[\x00-\x7F]+$/.test(t) ? t.length >= 4 : t.length >= 2));
}

function mentionScore(actionLower: string, name: string): number {
  const sn = shortName(name);
  if (!sn) return 0;
  if (actionLower.includes(sn.toLowerCase())) return sn.length + 100;
  let best = 0;
  for (const seg of nameSegments(sn)) {
    if (actionLower.includes(seg.toLowerCase()) && seg.length > best) best = seg.length;
  }
  return best;
}

/** Find the location the action most plausibly refers to (any status). */
export function detectTravelTarget(
  actionText: string,
  graph: LocationGraph,
  state: LocationState
): { node: LocationNode; status: LocationStatus } | null {
  const a = actionText.toLowerCase();
  let best: LocationNode | null = null;
  let bestScore = 0;
  for (const node of graph.nodes) {
    if (node.id === state.current) continue;
    const score = mentionScore(a, node.name);
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }
  if (!best) return null;
  return { node: best, status: state.status[best.id] ?? "hidden" };
}

/** Does the action look like the party is trying to GO somewhere (vs just
 *  mentioning a place)? */
const TRAVEL_RE = /前往|出發|移動|趕往|去|回到|返回|進入|走向|走到|搭|坐車|乘|go to|head|travel|enter|return to|move to|visit/i;
export function looksLikeTravel(actionText: string): boolean {
  return TRAVEL_RE.test(actionText);
}

/** Match evidence at the current location against a successful search action.
 *  Returns the evidence to award (name/how segment match, or the only
 *  remaining piece on a generic search). */
export function matchEvidence(
  actionText: string,
  graph: LocationGraph,
  state: LocationState
): EvidenceDef | null {
  if (!state.current) return null;
  const node = graph.nodes.find((n) => n.id === state.current);
  if (!node) return null;
  const unfound = node.evidence.filter((e) => !state.evidence_found.includes(e.id));
  if (unfound.length === 0) return null;
  const a = actionText.toLowerCase();
  let best: EvidenceDef | null = null;
  let bestScore = 0;
  for (const e of unfound) {
    const score = Math.max(mentionScore(a, e.name), e.how ? mentionScore(a, e.how) : 0);
    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }
  if (best) return best;
  // Generic successful search: if exactly ONE piece remains here, award it.
  if (unfound.length === 1) return unfound[0];
  return null;
}

// ── GM directive block ────────────────────────────────────────────────────────

export type TravelDirective =
  | { kind: "arrived"; node: LocationNode; firstVisit?: boolean }
  | { kind: "soft_wall"; node: LocationNode }
  | { kind: "unknown_place"; node: LocationNode }
  | { kind: "off_graph" };

/** Compact per-turn block telling the GM the authoritative location state. */
export function buildLocationBlock(
  graph: LocationGraph,
  state: LocationState,
  travel: TravelDirective | null,
  stuckHint: string | null
): string {
  const current = graph.nodes.find((n) => n.id === state.current);
  const lines: string[] = ["LOCATION SYSTEM (server-authoritative — you MUST follow this; you cannot move the party or reveal places yourself):"];

  if (current) {
    lines.push(`CURRENT LOCATION: ${current.name}${current.desc ? ` — ${current.desc}` : ""}`);
    const unfound = current.evidence.filter((e) => !state.evidence_found.includes(e.id));
    if (unfound.length) {
      lines.push(
        `EVIDENCE OBTAINABLE HERE (lock behind successful checks; do NOT volunteer): ${unfound
          .map((e) => `${e.name}${e.how ? `（${e.how}）` : ""}`)
          .join("、")}`
      );
    }
  }

  const found = graph.nodes.flatMap((n) => n.evidence).filter((e) => state.evidence_found.includes(e.id));
  if (found.length) lines.push(`EVIDENCE THE PARTY HOLDS: ${found.map((e) => e.name).join("、")}`);

  const unlockedOthers = graph.nodes.filter((n) => n.id !== state.current && state.status[n.id] === "unlocked");
  const discoveredLocked = graph.nodes.filter((n) => state.status[n.id] === "discovered");
  const exitsParts: string[] = [];
  if (unlockedOthers.length) exitsParts.push(`可前往：${unlockedOthers.map((n) => shortName(n.name)).join("、")}`);
  if (discoveredLocked.length) exitsParts.push(`已知但尚未能進入：${discoveredLocked.map((n) => shortName(n.name)).join("、")}`);
  if (exitsParts.length) lines.push(`KNOWN LOCATIONS — ${exitsParts.join(" | ")}`);
  lines.push("Locations not listed above are UNKNOWN to the players — never name, confirm, or hint at their existence until the system announces them.");

  if (travel) {
    if (travel.kind === "arrived") {
      lines.push(
        `TRAVEL THIS TURN: the party has MOVED to ${travel.node.name}. Narrate the transition and the new scene.${
          travel.firstVisit && travel.node.on_enter ? ` FIRST-VISIT BEAT: ${travel.node.on_enter}` : ""
        }`
      );
    } else if (travel.kind === "soft_wall") {
      lines.push(
        `TRAVEL BLOCKED: the actor tried to go to ${travel.node.name}, which is NOT yet accessible. Narrate an in-world reason entry fails${
          travel.node.locked_narration ? `（建議：${travel.node.locked_narration}）` : ""
        }. You may hint at what might open the way, but do NOT let them in. The party stays where it is.`
      );
    } else if (travel.kind === "unknown_place") {
      lines.push(
        `UNKNOWN PLACE: the actor referred to a place the party has not learned about. Treat it as in-character speculation — the world gives no confirmation it exists.`
      );
    } else if (travel.kind === "off_graph") {
      lines.push(
        [
          `OFF-GRAPH MOVEMENT: the actor wants to go to a place that is NOT in the scenario's location list. Judge it:`,
          `(a) MUNDANE & PLAUSIBLE for this setting (e.g. a shop, café, street corner, public office) — you may play a SHORT side-scene there: atmosphere, rumors, or a soft hint pointing toward the known locations at most. You must NOT award any listed evidence, confirm any hidden place, or advance unlock conditions. The side-scene lasts THIS TURN ONLY — do not open an ongoing storyline there; afterwards the party is back at their current location.`,
          `(b) A PLOT-RELEVANT place from your story notes that is not yet open, or an attempt to bypass locked areas, or something that doesn't fit the world — deny it with an in-world reason (road closed, no address, too dangerous) and steer the players toward the known locations listed above. Give no confirmation the place exists.`,
        ].join(" ")
      );
    }
  }

  if (stuckHint) {
    lines.push(`PACING NUDGE (party has stalled — weave this hint into the scene naturally, never as a system message): ${stuckHint}`);
  }

  return lines.join("\n");
}

/** Short display name helper for UI / logs. */
export function locationShortName(name: string): string {
  return shortName(name);
}
