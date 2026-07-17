// Server-authoritative location unlock system.
//
// The SCENARIO defines a location graph (nodes + unlock conditions + NPC
// placement rules + triggered NPC encounters). The ROOM carries the live
// state. All state transitions happen in code — the AI GM is only TOLD the
// state and given narration directives; it never decides what is locked,
// unlocked, or who is present.

import { type NpcRef, npcDisplayName } from "@/lib/game/npc";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LocationStatus = "hidden" | "discovered" | "unlocked";

/** One unlock term. Supported forms:
 *  - "visit:<nodeId>"        party has entered that node at least once
 *  - "item:<evidenceId>"     party has found that evidence
 *  - "count:<tag>:<n>"       party holds >= n evidence pieces carrying <tag>
 *  - "round:<n>"             current round >= n
 *  - "after:<nodeId>:<n>"    >= n rounds have passed since first entering node
 *  - "objective:<id>"        objectiveProgress[<id>].done is true
 */
export type UnlockTerm = string;

/** Minimal shape needed to evaluate objective:<id> terms — kept structural so
 *  this module doesn't depend on lib/ai/objectives.ts. */
export type ObjectiveProgressLike = Record<string, { done?: boolean } | undefined>;

export interface EvidenceDef {
  id: string;
  name: string;
  /** Tags used by count:<tag>:<n> conditions (e.g. "azhe_identity"). */
  tags: string[];
  /** How it can be obtained — matched against the player's action text. */
  how: string;
  /** Optional image revealed to the players the moment this evidence is awarded. */
  reveal_image?: string;
  /** Optional text revealed to the players the moment this evidence is awarded. */
  reveal_text?: string;
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
  /** Optional image revealed to the players on the party's FIRST entry here. */
  node_image?: string;
  /** Optional text revealed to the players on the party's FIRST entry here. */
  node_text?: string;
  /** v2: parent container id. Undefined = top-level place node. */
  container?: string;
  /** v2: editor canvas position (layout only — no gameplay meaning). */
  pos?: { x: number; y: number };
}

// ── v2 map-mode types (containers + edges) ────────────────────────────────────
// Design doc: docs/design/location-map-v2.md. Containers group place nodes into
// regions (1404室 holding 門口/客廳/神位…). They are NEVER standable — the
// party's `current` is always a place node. Edges define adjacency; all
// lock/visibility gating stays on NODE status (single gating authority).

/** "free" = v1 behavior: every unlocked node reachable from anywhere (legacy
 *  default). "edges" = map mode: movement follows edges/containers. */
export type TravelMode = "free" | "edges";

export interface ContainerDef {
  id: string;
  /** Creator/player-facing region name, e.g. 「1404室」. */
  name: string;
  /** Child place-node id the party lands on when entering this container. */
  entry: string;
  /** 此區域內地點可互相前往 — children are mutually adjacent without edges. */
  all_children_connected: boolean;
  /** Show still-locked children on the player map (as 🔒). */
  show_locked_children: boolean;
  /** Editor canvas position (layout only). */
  pos?: { x: number; y: number };
}

/** Adjacency between two place nodes and/or containers. A container endpoint
 *  resolves to that container's entry node at runtime. No conditions on edges
 *  in MVP — lock state lives on the destination node. */
export interface EdgeDef {
  from: string;
  to: string;
  /** true = 雙向路徑 (default), false = 單向路徑 (from → to only). */
  two_way: boolean;
}

/**
 * Where an NPC is at a given moment.
 * Rows are evaluated in order; the LAST row whose `when` is satisfied wins.
 * `when` empty = always satisfied (good as a baseline row).
 * This lets you express "老闆 is normally at shop, but after round 5 at dock":
 *   { npc:"老闆", at:"shop", when:[] }
 *   { npc:"老闆", at:"dock", when:[["round:5"]] }
 */
export interface NpcPlacement {
  /** NPC reference — the roster entry's stable id (legacy data may hold a name;
   *  both resolve via lib/game/npc.resolveNpc). */
  npc: string;
  at: string;
  when: UnlockTerm[][];
}

/**
 * A one-shot NPC encounter that fires when `when` first becomes true.
 * The server logs it once and instructs the GM via the `beat`.
 */
export interface NpcEncounter {
  npc: string;
  when: UnlockTerm[][];
  /** GM directive describing how the NPC arrives / what they want. */
  beat: string;
}

export interface LocationGraph {
  /** 2 = container/edge-aware schema. Absent in raw legacy data; coercion
   *  always outputs 2. */
  version?: 2;
  /** Movement rules — see TravelMode. Legacy graphs coerce to "free". */
  travel_mode: TravelMode;
  containers: ContainerDef[];
  /** Place nodes — the only standable locations. */
  nodes: LocationNode[];
  edges: EdgeDef[];
  npc_placements: NpcPlacement[];
  npc_encounters: NpcEncounter[];
}

export interface LocationState {
  /** LEGACY MIRROR — kept in sync with the ACTING character's node after each
   *  move so old readers keep working. New code reads positionOf() instead. */
  current: string | null;
  /** Split-party v1: per-character positions, keyed by in-room characters.id.
   *  Characters absent from the map fall back to `current` (positionOf). */
  positions: Record<string, string>;
  status: Record<string, LocationStatus>;
  /** SHARED party knowledge: first visit BY ANYONE counts. */
  visited: string[];
  /** Round on which ANYONE first entered each node (for after: gates). */
  entered_round: Record<string, number>;
  evidence_found: string[];
  /** Consecutive turns with no travel/evidence/unlock progress (party-level). */
  stuck_counter: number;
  /** Keys of NpcEncounters already fired (format "enc:<index>"). */
  encounters_fired: string[];
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
      reveal_image: asStr(e.reveal_image) || undefined,
      reveal_text: asStr(e.reveal_text) || undefined,
    }))
    .slice(0, 20);
}

function coerceNpcPlacements(v: unknown): NpcPlacement[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((p) => p && typeof p === "object" && asStr((p as any).npc) && asStr((p as any).at))
    .map((p: any) => ({
      npc: asStr(p.npc),
      at: asStr(p.at),
      when: coerceUnlock(p.when),
    }))
    .slice(0, 100);
}

function coerceNpcEncounters(v: unknown): NpcEncounter[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e) => e && typeof e === "object" && asStr((e as any).npc) && Array.isArray((e as any).when) && (e as any).when.length > 0)
    .map((e: any) => ({
      npc: asStr(e.npc),
      when: coerceUnlock(e.when),
      beat: asStr(e.beat),
    }))
    .slice(0, 50);
}

function coercePos(v: any): { x: number; y: number } | undefined {
  if (v && typeof v === "object" && Number.isFinite(Number(v.x)) && Number.isFinite(Number(v.y))) {
    return { x: Number(v.x), y: Number(v.y) };
  }
  return undefined;
}

function coerceContainers(v: unknown): ContainerDef[] {
  if (!Array.isArray(v)) return [];
  const out = v
    .filter((c) => c && typeof c === "object" && asStr((c as any).id) && asStr((c as any).name))
    .map((c: any): ContainerDef => ({
      id: asStr(c.id),
      name: asStr(c.name),
      entry: asStr(c.entry),
      all_children_connected: c.all_children_connected !== false, // default ON
      show_locked_children: c.show_locked_children !== false,     // default ON
      pos: coercePos(c.pos),
    }))
    .slice(0, 12);
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

function coerceEdges(v: unknown): EdgeDef[] {
  if (!Array.isArray(v)) return [];
  const out = v
    .filter((e) => e && typeof e === "object" && asStr((e as any).from) && asStr((e as any).to))
    .map((e: any): EdgeDef => ({
      from: asStr(e.from),
      to: asStr(e.to),
      two_way: e.two_way !== false, // default 雙向
    }))
    .filter((e) => e.from !== e.to)
    .slice(0, 120);
  // Dedupe identical pairs (a→b twice, or a↔b duplicated in both directions).
  const seen = new Set<string>();
  return out.filter((e) => {
    const k1 = `${e.from}→${e.to}`;
    const k2 = e.two_way ? `${e.to}→${e.from}` : null;
    if (seen.has(k1) || (k2 && seen.has(k2))) return false;
    seen.add(k1);
    if (k2) seen.add(k2);
    return true;
  });
}

/** Coerce arbitrary JSON into a valid LocationGraph, or null if unusable.
 *  Legacy flat graphs (no travel_mode/containers/edges) coerce to
 *  travel_mode "free" — byte-identical v1 movement behavior. */
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
      node_image: asStr(n.node_image) || undefined,
      node_text: asStr(n.node_text) || undefined,
      container: asStr(n.container) || undefined,
      pos: coercePos(n.pos),
    }))
    .slice(0, 40);
  // Dedupe ids — first definition wins.
  const seen = new Set<string>();
  const deduped = nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  if (deduped.length === 0) return null;
  // At least one node must be initially enterable, or the game can never start.
  if (!deduped.some((n) => n.initial === "unlocked")) deduped[0].initial = "unlocked";

  const containers = coerceContainers(raw?.containers);
  const containerIds = new Set(containers.map((c) => c.id));
  // Drop dangling container references; a place with an unknown parent is
  // treated as top-level rather than silently vanishing.
  for (const n of deduped) {
    if (n.container && !containerIds.has(n.container)) n.container = undefined;
  }
  // Container/node ids must not collide (edges reference both namespaces).
  const nodeIds = new Set(deduped.map((n) => n.id));
  const validContainers = containers.filter((c) => !nodeIds.has(c.id));
  // Entry fallback: keep whatever is stored; runtime + validator handle a
  // missing/invalid entry (fallback = first child).
  const validIds = new Set([...Array.from(nodeIds), ...validContainers.map((c) => c.id)]);
  const edges = coerceEdges(raw?.edges).filter((e) => validIds.has(e.from) && validIds.has(e.to));

  return {
    version: 2,
    travel_mode: raw?.travel_mode === "edges" ? "edges" : "free",
    containers: validContainers,
    nodes: deduped,
    edges,
    npc_placements: coerceNpcPlacements(raw?.npc_placements),
    npc_encounters: coerceNpcEncounters(raw?.npc_encounters),
  };
}

/** Authoring-time validation — returns human-readable warnings (zh-TW).
 *  Pass `npcRefs` (the roster's valid NPC references — ids and/or names) to also
 *  validate NPC references.
 *  Pass `objectiveIds` (from the scenario's objective list) to also validate objective:<id> references. */
export function validateLocationGraph(
  graph: LocationGraph,
  npcRefs?: Set<string>,
  objectiveIds?: Set<string>
): string[] {
  const warnings: string[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const evidenceIds = new Set(graph.nodes.flatMap((n) => n.evidence.map((e) => e.id)));
  const evidenceTags = new Set(graph.nodes.flatMap((n) => n.evidence.flatMap((e) => e.tags)));

  function validateTerms(terms: UnlockTerm[][], context: string) {
    for (const group of terms) {
      for (const term of group) {
        const parts = term.split(":");
        const kind = parts[0];
        if (kind === "visit" || kind === "after") {
          if (!ids.has(parts[1] ?? "")) warnings.push(`${context} 引用了不存在的地點 id：${term}`);
        } else if (kind === "item") {
          if (!evidenceIds.has(parts[1] ?? "")) warnings.push(`${context} 引用了不存在的證物 id：${term}`);
        } else if (kind === "count") {
          if (!evidenceTags.has(parts[1] ?? "")) warnings.push(`${context} 引用了沒有任何證物使用的標籤：${term}`);
          if (!Number.isFinite(Number(parts[2]))) warnings.push(`${context} 的 count 條件缺少數量：${term}`);
        } else if (kind === "round") {
          if (!Number.isFinite(Number(parts[1]))) warnings.push(`${context} 的 round 條件缺少回合數：${term}`);
        } else if (kind === "objective") {
          if (objectiveIds && !objectiveIds.has(parts[1] ?? "")) warnings.push(`${context} 引用了不存在的任務目標：${term}`);
        } else {
          warnings.push(`${context} 含無法識別的解鎖條件：${term}（支援 visit:/item:/count:/round:/after:/objective:）`);
        }
      }
    }
  }

  for (const n of graph.nodes) {
    for (const ref of n.discovers) {
      if (!ids.has(ref)) warnings.push(`地點「${n.name}」的 discovers 引用了不存在的地點 id：${ref}`);
    }
    validateTerms(n.unlock, `地點「${n.name}」的解鎖條件`);
    if (n.initial !== "unlocked" && n.unlock.length === 0 && !graph.nodes.some((m) => m.discovers.includes(n.id))) {
      warnings.push(`地點「${n.name}」被鎖定但沒有任何解鎖條件，也沒有其他地點能發現它 — 玩家永遠到不了。`);
    }
  }

  // ── v2 map-mode checks ──
  for (const c of graph.containers) {
    const children = graph.nodes.filter((n) => n.container === c.id);
    if (children.length === 0) {
      warnings.push(`區域「${c.name}」內沒有任何地點 — 遊戲中會被忽略。`);
      continue;
    }
    if (!c.entry || !children.some((n) => n.id === c.entry)) {
      warnings.push(`區域「${c.name}」沒有設定有效的入口地點 — 進入時會落在第一個子地點（建議明確設定）。`);
    }
  }
  if (graph.travel_mode === "edges") {
    // Stranded-node check: BFS over edges + container sibling links from every
    // initially-unlocked node. Unreachable place nodes can never be stood on.
    const adj = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      if (!adj.has(a)) adj.set(a, new Set());
      adj.get(a)!.add(b);
    };
    const entryOf = (cid: string) => {
      const c = graph.containers.find((x) => x.id === cid);
      if (!c) return null;
      const children = graph.nodes.filter((n) => n.container === cid);
      return children.some((n) => n.id === c.entry) ? c.entry : children[0]?.id ?? null;
    };
    const resolveEndpoint = (id: string): string | null =>
      ids.has(id) ? id : entryOf(id);
    for (const e of graph.edges) {
      const from = resolveEndpoint(e.from);
      const to = resolveEndpoint(e.to);
      if (!from || !to) continue;
      link(from, to);
      if (e.two_way) link(to, from);
    }
    for (const c of graph.containers) {
      if (!c.all_children_connected) continue;
      const children = graph.nodes.filter((n) => n.container === c.id);
      for (const a of children) for (const b of children) if (a.id !== b.id) link(a.id, b.id);
    }
    const queue = graph.nodes.filter((n) => n.initial === "unlocked").map((n) => n.id);
    const reached = new Set(queue);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nxt of Array.from(adj.get(cur) ?? [])) {
        if (!reached.has(nxt)) { reached.add(nxt); queue.push(nxt); }
      }
    }
    for (const n of graph.nodes) {
      if (!reached.has(n.id)) {
        warnings.push(`地圖模式下地點「${n.name}」沒有任何路徑可以到達（不與任何起點連通）— 玩家永遠走不到。`);
      }
    }
  }

  for (const p of graph.npc_placements) {
    if (!ids.has(p.at)) warnings.push(`NPC「${p.npc}」的位置設定引用了不存在的地點 id：${p.at}`);
    if (npcRefs && p.npc && !npcRefs.has(p.npc)) warnings.push(`NPC 位置設定中的「${p.npc}」不在此劇本的 NPC 名單中。`);
    validateTerms(p.when, `NPC「${p.npc}」的位置條件`);
  }

  for (let i = 0; i < graph.npc_encounters.length; i++) {
    const e = graph.npc_encounters[i];
    if (npcRefs && e.npc && !npcRefs.has(e.npc)) warnings.push(`NPC 觸發事件中的「${e.npc}」不在此劇本的 NPC 名單中。`);
    validateTerms(e.when, `NPC「${e.npc}」觸發事件 ${i + 1} 的條件`);
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
    positions: {},
    status,
    visited: first ? [first.id] : [],
    entered_round: first ? { [first.id]: 1 } : {},
    evidence_found: [],
    stuck_counter: 0,
    encounters_fired: [],
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
  // Per-character positions: keep only entries pointing at known nodes.
  const positions: Record<string, string> = {};
  if (raw.positions && typeof raw.positions === "object") {
    for (const [cid, nid] of Object.entries(raw.positions)) {
      if (typeof nid === "string" && status[nid] !== undefined) positions[cid] = nid;
    }
  }
  return {
    current: typeof raw.current === "string" && status[raw.current] ? raw.current : base.current,
    positions,
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
    encounters_fired: asStrArr(raw.encounters_fired),
  };
}

// ── Condition evaluation (pure code — no AI) ──────────────────────────────────

function evalTerm(
  term: UnlockTerm,
  state: LocationState,
  graph: LocationGraph,
  currentRound: number,
  objectiveProgress: ObjectiveProgressLike
): boolean {
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
    case "objective":
      return objectiveProgress[parts[1] ?? ""]?.done === true;
    default:
      return false;
  }
}

function condSatisfied(
  when: UnlockTerm[][],
  state: LocationState,
  graph: LocationGraph,
  currentRound: number,
  objectiveProgress: ObjectiveProgressLike
): boolean {
  if (when.length === 0) return true;
  return when.some((group) => group.every((t) => evalTerm(t, state, graph, currentRound, objectiveProgress)));
}

// Empty fallbacks so callers WITHOUT a location system (no graph/state) can still
// evaluate the location-free terms (round:/objective:). item:/visit:/count:/after:
// simply return false against these empties, which is the safe "still locked"
// default for a scenario that gates on evidence it has no location system for.
const EMPTY_LOCATION_STATE: LocationState = {
  current: null, positions: {}, status: {}, visited: [], entered_round: {}, evidence_found: [],
  stuck_counter: 0, encounters_fired: [],
};
const EMPTY_LOCATION_GRAPH: LocationGraph = {
  version: 2, travel_mode: "free", containers: [], nodes: [], edges: [],
  npc_placements: [], npc_encounters: [],
};

/**
 * Public, null-tolerant evaluator for the shared `string[][]` unlock-condition
 * grammar (used by the NPC-knowledge gate as well as location unlocks). An empty
 * `when` means "always satisfied". Pass whatever location state/graph exist;
 * null is fine for scenarios with no location system.
 */
export function evalUnlockConditions(
  when: UnlockTerm[][],
  state: LocationState | null,
  graph: LocationGraph | null,
  currentRound: number,
  objectiveProgress: ObjectiveProgressLike = {}
): boolean {
  return condSatisfied(
    when,
    state ?? EMPTY_LOCATION_STATE,
    graph ?? EMPTY_LOCATION_GRAPH,
    currentRound,
    objectiveProgress
  );
}

function unlockSatisfied(
  node: LocationNode,
  state: LocationState,
  graph: LocationGraph,
  currentRound: number,
  objectiveProgress: ObjectiveProgressLike
): boolean {
  if (node.unlock.length === 0) return false; // no conditions → only discovers[]/initial can open it
  return node.unlock.some((group) => group.every((t) => evalTerm(t, state, graph, currentRound, objectiveProgress)));
}

export interface UnlockChanges {
  unlocked: LocationNode[];
  discovered: LocationNode[];
}

/** Re-evaluate every non-unlocked node. Mutates state.status; returns changes.
 *  A node whose conditions are met goes straight to "unlocked" (even from
 *  hidden — finding the way IS the discovery). */
export function evaluateUnlocks(
  graph: LocationGraph,
  state: LocationState,
  currentRound: number,
  objectiveProgress: ObjectiveProgressLike = {}
): UnlockChanges {
  const changes: UnlockChanges = { unlocked: [], discovered: [] };
  for (const node of graph.nodes) {
    if (state.status[node.id] === "unlocked") continue;
    if (unlockSatisfied(node, state, graph, currentRound, objectiveProgress)) {
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

/**
 * Return NPC names present at the current node this turn.
 *
 * For each unique NPC, find all placements in order. The LAST satisfied row
 * determines where the NPC is. If that row's `at` is the current node, the
 * NPC is present.
 */
export function evaluateNpcPlacements(
  graph: LocationGraph,
  state: LocationState,
  currentRound: number,
  objectiveProgress: ObjectiveProgressLike = {},
  atNode?: string | null
): string[] {
  const scene = atNode ?? state.current;
  if (!scene || graph.npc_placements.length === 0) return [];

  // Group placements by NPC, preserving insertion order.
  const byNpc = new Map<string, NpcPlacement[]>();
  for (const p of graph.npc_placements) {
    if (!byNpc.has(p.npc)) byNpc.set(p.npc, []);
    byNpc.get(p.npc)!.push(p);
  }

  const present: string[] = [];
  byNpc.forEach((placements, npc) => {
    let lastSatisfied: NpcPlacement | null = null;
    for (const p of placements) {
      if (condSatisfied(p.when, state, graph, currentRound, objectiveProgress)) lastSatisfied = p;
    }
    if (lastSatisfied && lastSatisfied.at === scene) present.push(npc);
  });
  return present;
}

/**
 * Fire any NPC encounters whose conditions just became true.
 * Mutates state.encounters_fired so each fires at most once per room.
 * Returns the newly fired encounters.
 */
export function evaluateEncounters(
  graph: LocationGraph,
  state: LocationState,
  currentRound: number,
  objectiveProgress: ObjectiveProgressLike = {}
): NpcEncounter[] {
  if (graph.npc_encounters.length === 0) return [];
  const fired: NpcEncounter[] = [];
  for (let i = 0; i < graph.npc_encounters.length; i++) {
    const enc = graph.npc_encounters[i];
    const key = `enc:${i}`;
    if (state.encounters_fired.includes(key)) continue;
    // encounters need an explicit when (they can't fire "always" — that would
    // be every turn)
    if (enc.when.length === 0) continue;
    if (condSatisfied(enc.when, state, graph, currentRound, objectiveProgress)) {
      state.encounters_fired.push(key);
      fired.push(enc);
    }
  }
  return fired;
}

// ── Split-party v1: per-character positions ───────────────────────────────────

/** Where a character stands. Fallback chain keeps every legacy room working:
 *  positions[id] → the party's legacy `current` → the first unlocked node. */
export function positionOf(state: LocationState, characterId: string, graph: LocationGraph): string | null {
  const pos = state.positions?.[characterId];
  if (pos && state.status[pos] !== undefined) return pos;
  if (state.current && state.status[state.current] !== undefined) return state.current;
  const firstOpen = graph.nodes.find((n) => state.status[n.id] === "unlocked");
  return firstOpen?.id ?? null;
}

/** Move ONE character. Mutates state: sets their position, mirrors the legacy
 *  `current` (old readers keep working), and — on the first visit BY ANYONE —
 *  marks visited/entered_round and fires the node's discovers (shared party
 *  knowledge ✓). Returns what changed for the caller's logging. */
export function applyActorMove(
  graph: LocationGraph,
  state: LocationState,
  characterId: string,
  nodeId: string,
  currentRound: number,
): { firstVisit: boolean; discovered: LocationNode[] } {
  if (!state.positions) state.positions = {};
  state.positions[characterId] = nodeId;
  state.current = nodeId; // legacy mirror
  if (state.visited.includes(nodeId)) return { firstVisit: false, discovered: [] };
  state.visited.push(nodeId);
  state.entered_round[nodeId] = currentRound;
  const discovered = applyDiscovers(graph, state, nodeId);
  return { firstVisit: true, discovered };
}

/** Solo-combat rule: a hostile NPC attacks only characters located at ITS node
 *  (and still standing). Characters without a position entry fall back through
 *  positionOf, so legacy rooms behave as before (everyone at `current`). */
export function eligibleCombatTargets<T extends { id: string; hp: number }>(
  characters: T[],
  state: LocationState,
  npcNode: string,
  graph: LocationGraph,
): T[] {
  return characters.filter((c) => c.hp > 0 && positionOf(state, c.id, graph) === npcNode);
}

// ── v2 runtime: adjacency, exits, reachability ────────────────────────────────

/** Resolve a container id to the place node the party lands on when entering
 *  it — the configured entry, or the first child as fallback. */
export function entryNodeOf(graph: LocationGraph, containerId: string): LocationNode | null {
  const c = graph.containers.find((x) => x.id === containerId);
  if (!c) return null;
  const children = graph.nodes.filter((n) => n.container === containerId);
  if (children.length === 0) return null;
  return children.find((n) => n.id === c.entry) ?? children[0];
}

/** Directed adjacency between PLACE nodes: edges (container endpoints resolved
 *  to their entry node) plus sibling links inside all_children_connected
 *  containers. Pure structure — lock status is applied by the callers. */
function buildAdjacency(graph: LocationGraph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const resolve = (id: string): string | null =>
    nodeIds.has(id) ? id : entryNodeOf(graph, id)?.id ?? null;
  for (const e of graph.edges) {
    const from = resolve(e.from);
    const to = resolve(e.to);
    if (!from || !to || from === to) continue;
    link(from, to);
    if (e.two_way) link(to, from);
  }
  for (const c of graph.containers) {
    if (!c.all_children_connected) continue;
    const kids = graph.nodes.filter((n) => n.container === c.id);
    for (const a of kids) for (const b of kids) if (a.id !== b.id) link(a.id, b.id);
  }
  return adj;
}

export interface ComputedExits {
  /** Enterable this turn（可前往）. Edges mode: every node reachable from the
   *  current one via a path of open (unlocked) nodes — BFS one-turn travel.
   *  Free mode: every unlocked node (v1 behavior). */
  open: LocationNode[];
  /** Visible but not enterable（看得到但進不去）: discovered nodes, plus locked
   *  children of the current container when it shows locked children. */
  locked: LocationNode[];
}

/** BFS over open (unlocked) nodes only, starting at `fromId` (inclusive). */
function openReachable(graph: LocationGraph, adj: Map<string, Set<string>>, fromId: string): Set<string> {
  const reached = new Set<string>([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nxt of Array.from(adj.get(cur) ?? [])) {
      if (reached.has(nxt)) continue;
      const node = graph.nodes.find((n) => n.id === nxt);
      if (!node) continue;
      reached.add(nxt);
      // Note: reached-but-locked nodes are recorded (they're the frontier) but
      // never traversed further.
      queue.push(nxt);
    }
  }
  return reached;
}

/** The authoritative per-turn exit computation used by the GM directive, the
 *  travel matcher, GM move_to validation and the player panel.
 *  `fromNode` (split-party): the character's own node; omitted/null falls back
 *  to the legacy party position. */
export function computeExits(graph: LocationGraph, state: LocationState, fromNode?: string | null): ComputedExits {
  const origin = fromNode ?? state.current;
  if (graph.travel_mode !== "edges") {
    return {
      open: graph.nodes.filter((n) => n.id !== origin && state.status[n.id] === "unlocked"),
      locked: graph.nodes.filter((n) => state.status[n.id] === "discovered"),
    };
  }
  if (!origin) return { open: [], locked: [] };
  const adj = buildAdjacency(graph);
  // Walk only THROUGH unlocked nodes; locked ones end the walk (frontier).
  const reached = new Set<string>([origin]);
  const queue = [origin];
  const frontierLocked = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nxt of Array.from(adj.get(cur) ?? [])) {
      if (reached.has(nxt) || frontierLocked.has(nxt)) continue;
      if (state.status[nxt] === "unlocked") {
        reached.add(nxt);
        queue.push(nxt);
      } else {
        frontierLocked.add(nxt);
      }
    }
  }
  const open = graph.nodes.filter((n) => n.id !== origin && reached.has(n.id));

  const lockedIds = new Set<string>();
  // Globally known-but-locked places (the system announced them).
  for (const n of graph.nodes) if (state.status[n.id] === "discovered") lockedIds.add(n.id);
  // Locked doors you can literally see from an open node you can stand in.
  for (const id of Array.from(frontierLocked)) {
    if (state.status[id] === "discovered") lockedIds.add(id);
  }
  // Standing inside a container that shows its locked children reveals them
  // (walking into the flat, you can see the bedroom door) — any status.
  const curNode = graph.nodes.find((n) => n.id === origin);
  const curContainer = curNode?.container ? graph.containers.find((c) => c.id === curNode.container) : null;
  if (curContainer?.show_locked_children) {
    for (const n of graph.nodes) {
      if (n.container === curContainer.id && state.status[n.id] !== "unlocked") lockedIds.add(n.id);
    }
  }
  const locked = graph.nodes.filter((n) => lockedIds.has(n.id) && !reached.has(n.id) && n.id !== origin);
  return { open, locked };
}

/** For an unlocked-but-unreachable target: is there ANY physical path, and if
 *  so which locked node blocks it first? (Ignores lock status while walking,
 *  then reports the first non-open node on the found path.) */
export function findPathBlocker(
  graph: LocationGraph,
  state: LocationState,
  targetId: string,
  fromNode?: string | null
): { hasPath: boolean; blocker: LocationNode | null } {
  const origin = fromNode ?? state.current;
  if (!origin) return { hasPath: false, blocker: null };
  const adj = buildAdjacency(graph);
  const parent = new Map<string, string>();
  const queue = [origin];
  const seen = new Set<string>([origin]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === targetId) break;
    for (const nxt of Array.from(adj.get(cur) ?? [])) {
      if (seen.has(nxt)) continue;
      seen.add(nxt);
      parent.set(nxt, cur);
      queue.push(nxt);
    }
  }
  if (!seen.has(targetId)) return { hasPath: false, blocker: null };
  // Reconstruct origin → target and report the first non-unlocked hop.
  const path: string[] = [];
  for (let cur: string | undefined = targetId; cur && cur !== origin; cur = parent.get(cur)) path.unshift(cur);
  for (const id of path) {
    if (state.status[id] !== "unlocked") {
      return { hasPath: true, blocker: graph.nodes.find((n) => n.id === id) ?? null };
    }
  }
  return { hasPath: true, blocker: null };
}

// ── Fuzzy matching (shared with the media-reveal logic style) ─────────────────

function shortName(name: string): string {
  return name.trim().split(/[：:，,。．\.\n——–\-（(【\[]/)[0].trim().slice(0, 30);
}

function nameSegments(sn: string): string[] {
  return sn
    .split(/[的之\s、與和及\/]+/)
    .map((t) => t.trim())
    // Require longer segments than the generic media-reveal matcher: a 2-char
    // CJK overlap is common enough in ordinary sentences to false-positive as
    // "the party wants to travel here" (e.g. an action mentioning an item or
    // verb that coincidentally shares 2 characters with a location's name).
    .filter((t) => (/^[\x00-\x7F]+$/.test(t) ? t.length >= 4 : t.length >= 3));
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

/** A named travel candidate — a place node under its own name, or under its
 *  container's name (container mention resolves to the entry node). */
interface TravelCandidate {
  name: string;
  node: LocationNode;
}

/** Find the candidate the action most plausibly refers to.
 *
 *  Scoring, strongest first: full short-name match, then a whole distinctive
 *  segment, then a PARTIAL match — a CJK chunk (≥2 chars) shared between the
 *  typed text and the name (both directions, so "神位" reaches "1404神位" and
 *  "神位" buried in "走近客廳角落嘅神位" still matches). DESTINATION-LAST
 *  tiebreak: in Chinese, "A角落嘅B" / "從A去B" put the true destination LAST, so
 *  the latest-mentioned location wins over raw score. Ambiguity guard: a weak
 *  winner tied at the same text position as a comparable runner-up → decline. */
function matchLocationName(actionText: string, candidates: TravelCandidate[]): LocationNode | null {
  const a = actionText.toLowerCase();
  const cjkRuns = (a.match(/[㐀-鿿]+/g) ?? []).filter((r) => r.length >= 2);
  const scored: { node: LocationNode; score: number; pos: number }[] = [];
  for (const cand of candidates) {
    let score = 0;
    let pos = -1;
    const nameLower = cand.name.toLowerCase();
    const sn = shortName(cand.name).toLowerCase();
    // Full short-name match (strong, ≥100).
    const full = sn ? a.indexOf(sn) : -1;
    if (full >= 0) {
      score = sn.length + 100;
      pos = full;
    }
    // Whole distinctive segment (weak).
    if (score === 0) {
      for (const seg of nameSegments(shortName(cand.name))) {
        const i = a.indexOf(seg.toLowerCase());
        if (i >= 0 && seg.length > score) { score = seg.length; pos = i; }
      }
    }
    // Partial CJK match (weak): the longest common substring (≥2 chars)
    // between any CJK run of the NAME and the action text. Subsumes both
    // "typed chunk inside name" (神位 → 1404神位) and "name core buried in a
    // longer typed run" (神位 in 走近客廳角落嘅神位), and also survives names
    // whose CJK is split by digits — "14樓走廊" has run 樓走廊, whose substring
    // 走廊 still matches "返回走廊".
    if (score === 0 && cjkRuns.length) {
      const nameRuns = (nameLower.match(/[㐀-鿿]+/g) ?? []).filter((r) => r.length >= 2);
      for (const nr of nameRuns) {
        for (let len = Math.min(nr.length, 30); len >= 2; len--) {
          if (len <= score) break;
          let found = false;
          for (let i = 0; i + len <= nr.length; i++) {
            const sub = nr.slice(i, i + len);
            const j = a.indexOf(sub);
            if (j >= 0) { score = len; pos = j; found = true; break; }
          }
          if (found) break;
        }
      }
    }
    if (score > 0) scored.push({ node: cand.node, score, pos });
  }
  if (scored.length === 0) return null;
  scored.sort((x, y) => (y.pos - x.pos) || (y.score - x.score));
  const [best, second] = scored;
  if (
    best.score < 100 &&
    second &&
    second.node.id !== best.node.id && // same node via two names is not ambiguity
    best.pos === second.pos &&
    best.score < second.score * 2
  ) {
    return null;
  }
  return best.node;
}

/** What the player's travel-ish action resolves to, mode-aware. */
export type TravelIntent =
  | { kind: "go"; node: LocationNode }
  /** Known but not enterable（soft wall）. */
  | { kind: "locked"; node: LocationNode }
  /** Edges mode: destination is open but every path crosses a locked node
   *  (blocker) — or no physical path exists at all (blocker null). */
  | { kind: "blocked"; node: LocationNode; blocker: LocationNode | null }
  /** Free mode only: the player named a place they should not know exists. */
  | { kind: "unknown"; node: LocationNode };

/**
 * Resolve which location an action refers to and whether the party can go.
 *
 * Free mode (v1): matches ANY node; unlocked → go, discovered → locked,
 * hidden → unknown. Edges mode: hidden nodes are NEVER matchable (naming one
 * falls through to off_graph — the system won't confirm it exists); travel is
 * one-turn BFS over open nodes; unlocked-but-cut-off destinations report the
 * blocking node. Container names always resolve to their entry node.
 */
export function resolveTravelIntent(
  actionText: string,
  graph: LocationGraph,
  state: LocationState,
  actorNode?: string | null
): TravelIntent | null {
  // Split-party: everything is relative to the ACTING character's node.
  const origin = actorNode ?? state.current;
  const edgesMode = graph.travel_mode === "edges";
  const exits = edgesMode ? computeExits(graph, state, origin) : null;

  const candidates: TravelCandidate[] = [];
  if (edgesMode) {
    const visible = new Set([...exits!.open, ...exits!.locked].map((n) => n.id));
    for (const n of graph.nodes) {
      if (n.id === origin) continue;
      // Known places: current exits + anything unlocked/discovered before
      // (announced to the players when it opened, even if now cut off).
      if (visible.has(n.id) || state.status[n.id] === "unlocked" || state.status[n.id] === "discovered") {
        candidates.push({ name: n.name, node: n });
      }
    }
  } else {
    for (const n of graph.nodes) {
      if (n.id !== origin) candidates.push({ name: n.name, node: n });
    }
  }
  // Containers are addressable by name; the character lands on the entry node.
  for (const c of graph.containers) {
    const entry = entryNodeOf(graph, c.id);
    if (!entry || entry.id === origin) continue;
    if (edgesMode && state.status[entry.id] === "hidden") continue; // unknown region
    candidates.push({ name: c.name, node: entry });
  }

  const node = matchLocationName(actionText, candidates);
  if (!node) return null;
  const status = state.status[node.id] ?? "hidden";

  if (!edgesMode) {
    if (status === "unlocked") return { kind: "go", node };
    if (status === "discovered") return { kind: "locked", node };
    return { kind: "unknown", node };
  }
  if (status !== "unlocked") return { kind: "locked", node };
  if (exits!.open.some((n) => n.id === node.id)) return { kind: "go", node };
  const { hasPath, blocker } = findPathBlocker(graph, state, node.id, origin);
  return { kind: "blocked", node, blocker: hasPath ? blocker : null };
}

/**
 * Validate a GM-declared move_to against the authoritative state. Accepts ONLY
 * unlocked, non-current nodes — the GM can express the player's intent, but it
 * can never move the party somewhere the server hasn't opened. Name matching is
 * tolerant (exact > substring > segment/partial) since the GM may echo a short
 * form of the node name.
 */
export function resolveMoveTarget(
  name: string,
  graph: LocationGraph,
  state: LocationState,
  actorNode?: string | null
): LocationNode | null {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  // The pool is the server-computed OPEN exits from the ACTOR's node — in edges
  // mode that already means "reachable via a path of open nodes", so the GM can
  // never move a character across a locked door or to a disconnected place.
  const pool: TravelCandidate[] = computeExits(graph, state, actorNode ?? state.current).open.map((n) => ({ name: n.name, node: n }));
  for (const c of graph.containers) {
    const entry = entryNodeOf(graph, c.id);
    if (entry && pool.some((p) => p.node.id === entry.id)) pool.push({ name: c.name, node: entry });
  }
  let best: LocationNode | null = null;
  let bestScore = 0;
  for (const cand of pool) {
    const full = cand.name.trim().toLowerCase();
    const sn = shortName(cand.name).toLowerCase();
    let score = 0;
    if (q === full || q === sn) score = 1000;
    else if (full.includes(q) || q.includes(sn)) score = 100 + Math.min(q.length, full.length);
    else score = mentionScore(q, cand.name);
    if (score > bestScore) {
      best = cand.node;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

/** Does the action look like the party is trying to GO somewhere (vs just
 *  mentioning a place)? Includes the common verbs 去 / go — a false trigger
 *  here is harmless because travel only actually happens when the text ALSO
 *  names a real, unlocked location (detectTravelTarget + the status gate). "go"
 *  uses a word boundary so it does not match good/gold/going; 去 needs none. */
const TRAVEL_RE = /前往|出發|移動|趕往|回到|返回|走向|走到|搭車|坐車|乘車|去|go to|travel to|head to|return to|move to|head back|travel back|\bgo\b/i;
export function looksLikeTravel(actionText: string): boolean {
  return TRAVEL_RE.test(actionText);
}

// Does a clue's 取得方式 (how) describe a plain SEARCH (so a generic search of
// the room reveals it), vs a specific action like breaking/prying something? An
// empty how means "just search here".
const HOW_SEARCH_RE = /搜|查|翻|找|閱|讀|看|探|search|investigat|examin|inspect|look|explor|read/i;
function howIsGenericSearch(how?: string): boolean {
  const h = (how ?? "").trim();
  return h === "" || HOW_SEARCH_RE.test(h);
}

/**
 * Evidence to award at the current location for a successful action. A clue is
 * awarded when the action MATCHES it — either it names the clue / performs its
 * 取得方式 (so "破壞電腦" yields the break-the-computer clue), or, when the action
 * is a generic search, the clue is search-obtainable (its 取得方式 is a search or
 * is unspecified). Action-specific clues are therefore NOT handed out by plain
 * searching. `isSearch` = the action reads like a search.
 */
export function matchEvidence(
  actionText: string,
  graph: LocationGraph,
  state: LocationState,
  isSearch: boolean,
  atNode?: string | null
): EvidenceDef[] {
  const scene = atNode ?? state.current;
  if (!scene) return [];
  const node = graph.nodes.find((n) => n.id === scene);
  if (!node) return [];
  const unfound = node.evidence.filter((e) => !state.evidence_found.includes(e.id));
  if (unfound.length === 0) return [];
  const a = actionText.toLowerCase();

  const out: EvidenceDef[] = [];
  const taken = new Set<string>();
  // 1. The action names the clue, or performs its 取得方式 (method match).
  for (const e of unfound) {
    if (mentionScore(a, e.name) > 0 || (e.how ? mentionScore(a, e.how) > 0 : false)) {
      out.push(e);
      taken.add(e.id);
    }
  }
  // 2. A generic search additionally reveals every search-obtainable clue here.
  if (isSearch) {
    for (const e of unfound) {
      if (!taken.has(e.id) && howIsGenericSearch(e.how)) out.push(e);
    }
  }
  return out;
}

// ── GM directive block ────────────────────────────────────────────────────────

export type TravelDirective =
  | { kind: "arrived"; node: LocationNode; firstVisit?: boolean }
  | { kind: "soft_wall"; node: LocationNode }
  /** Edges mode: destination is open, but the way there crosses a locked node
   *  (blocker) — or no physical route exists at all (blocker null). */
  | { kind: "blocked_path"; node: LocationNode; blocker: LocationNode | null }
  | { kind: "unknown_place"; node: LocationNode }
  | { kind: "off_graph" };

/** Split-party scene context: who acts this turn and where everyone stands.
 *  Provided by the route; when present the block narrates ONE character's
 *  scene instead of a single party position. */
export interface SceneContext {
  actorName: string;
  actorNode: string | null;
  nextName: string;
  nextNode: string | null;
  whereabouts: Array<{ name: string; node: string | null }>;
  /** Ledger facts that happened AT the actor's node (scene memory) — keeps
   *  physical continuity when turns from other locations interleave. */
  sceneFacts?: string[];
}

/** Compact per-turn block telling the GM the authoritative location state.
 *  `currentRound` is needed to evaluate NPC placement conditions.
 *  `firedEncounters` are NPC encounter events that fired this turn.
 *  `scene` (split-party): per-character scene framing; omitted = legacy
 *  single-party-position output. */
export function buildLocationBlock(
  graph: LocationGraph,
  state: LocationState,
  travel: TravelDirective | null,
  stuckHint: string | null,
  currentRound: number,
  firedEncounters: NpcEncounter[] = [],
  objectiveProgress: ObjectiveProgressLike = {},
  npcRoster: NpcRef[] = [],
  scene?: SceneContext | null,
): string {
  const sceneNode = scene?.actorNode ?? state.current;
  const current = graph.nodes.find((n) => n.id === sceneNode);
  const nodeName = (id: string | null | undefined): string => {
    if (!id) return "（未知）";
    return shortName(graph.nodes.find((n) => n.id === id)?.name ?? id);
  };
  const lines: string[] = ["LOCATION SYSTEM (server-authoritative — you MUST follow this; you cannot reveal hidden places yourself, and a character's position only changes via the move_to field below or a TRAVEL notice from the system):"];

  if (current) {
    // Region breadcrumb (1404室 › 1404神位) so the GM narrates the right scale.
    const region = current.container ? graph.containers.find((c) => c.id === current.container) : null;
    const crumb = `${region ? `${region.name} › ` : ""}${current.name}`;
    if (scene) {
      lines.push(`SCENE THIS TURN: ${scene.actorName} is at ${crumb}${current.desc ? ` — ${current.desc}` : ""}. Narrate ONLY this location this turn.`);
    } else {
      lines.push(`CURRENT LOCATION: ${crumb}${current.desc ? ` — ${current.desc}` : ""}`);
    }
    const unfound = current.evidence.filter((e) => !state.evidence_found.includes(e.id));
    if (unfound.length) {
      lines.push(
        `EVIDENCE OBTAINABLE HERE (lock behind successful checks; do NOT volunteer): ${unfound
          .map((e) => `${e.name}${e.how ? `（${e.how}）` : ""}`)
          .join("、")}`
      );
    }
  }

  if (scene) {
    // Scene memory: what already physically happened AT this location — the
    // drawer someone opened stays open even if other rooms' turns interleaved.
    if (scene.sceneFacts && scene.sceneFacts.length) {
      lines.push(
        `SCENE HISTORY (things that already happened AT THIS LOCATION — keep physical continuity with them; do not reset, undo, or re-describe them as new): ${scene.sceneFacts.join("；")}`
      );
    }
    // Where every character stands. Characters elsewhere are NOT in this scene.
    lines.push(
      `PARTY WHEREABOUTS: ${scene.whereabouts.map((w) => `${w.name} @ ${nodeName(w.node)}`).join(" · ")}. ` +
      `Characters whose location differs from this scene's are NOT present here — do not show them acting, speaking, or perceiving in this scene, and do not tell ${scene.actorName} what happened in scenes they did not witness (players can read everything; the CHARACTERS cannot).`
    );
  }

  // NPC presence — server-computed, GM must not add or remove NPCs from the scene.
  const npcsHere = evaluateNpcPlacements(graph, state, currentRound, objectiveProgress, sceneNode);
  if (graph.npc_placements.length > 0) {
    if (npcsHere.length > 0) {
      lines.push(`NPCS PRESENT HERE: ${npcsHere.map((ref) => npcDisplayName(ref, npcRoster)).join("、")}`);
    }
    lines.push("NPCs not listed above are NOT at this location — do not introduce them into the current scene unless an encounter fires.");
  }

  const found = graph.nodes.flatMap((n) => n.evidence).filter((e) => state.evidence_found.includes(e.id));
  if (found.length) lines.push(`EVIDENCE THE PARTY HOLDS: ${found.map((e) => e.name).join("、")}`);

  // Server-computed exits: in edges mode 可前往 = reachable via open paths from
  // the scene's node (not every unlocked node); free mode = v1 lists unchanged.
  const exits = computeExits(graph, state, sceneNode);
  const unlockedOthers = exits.open;
  const discoveredLocked = exits.locked;
  const exitsParts: string[] = [];
  if (unlockedOthers.length) exitsParts.push(`可前往：${unlockedOthers.map((n) => shortName(n.name)).join("、")}`);
  if (discoveredLocked.length) exitsParts.push(`已知但尚未能進入：${discoveredLocked.map((n) => shortName(n.name)).join("、")}`);
  if (exitsParts.length) lines.push(`KNOWN LOCATIONS — ${exitsParts.join(" | ")}`);
  lines.push("Locations not listed above are UNKNOWN to the players — never name, confirm, or hint at their existence until the system announces them.");
  const mover = scene ? scene.actorName : "the party";
  lines.push(
    `MOVING: if the acting player's action means going to one of the 可前往 locations (however they phrase it — partial name, "回去那裡", a typo), narrate ${mover} moving there and set "move_to" in your JSON to that location's EXACT name from the list. If they try somewhere locked or unknown, ${mover} STAYS at the scene's location — narrate why entry fails and set move_to to null. If the system already announced "TRAVEL THIS TURN" below, the move is done: set move_to to null. Never narrate ${mover} being anywhere except this scene's location or a move_to/TRAVEL destination.${scene ? ` move_to moves ONLY ${scene.actorName} — other characters stay where they are.` : ""}`
  );

  if (travel) {
    if (travel.kind === "arrived") {
      lines.push(
        `TRAVEL THIS TURN: ${mover} has MOVED to ${travel.node.name}. Narrate the transition and the new scene.${
          travel.firstVisit && travel.node.on_enter ? ` FIRST-VISIT BEAT: ${travel.node.on_enter}` : ""
        }`
      );
    } else if (travel.kind === "soft_wall") {
      lines.push(
        `TRAVEL BLOCKED: ${mover} tried to go to ${travel.node.name}, which is NOT yet accessible. Narrate an in-world reason entry fails${
          travel.node.locked_narration ? `（建議：${travel.node.locked_narration}）` : ""
        }. You may hint at what might open the way, but do NOT let them in. ${mover} stays where they are.`
      );
    } else if (travel.kind === "blocked_path") {
      lines.push(
        travel.blocker
          ? `TRAVEL BLOCKED EN ROUTE: ${mover} tried to reach ${travel.node.name}, but the way there passes through ${travel.blocker.name}, which is not yet passable${
              travel.blocker.locked_narration ? `（建議：${travel.blocker.locked_narration}）` : ""
            }. Narrate that the route is cut off at ${travel.blocker.name} — do NOT teleport them past it. ${mover} stays where they are; set move_to to null.`
          : `TRAVEL IMPOSSIBLE: ${mover} tried to reach ${travel.node.name}, but no route leads there from their position. Narrate in-world that there is simply no way through from here. ${mover} stays where they are; set move_to to null.`
      );
    } else if (travel.kind === "unknown_place") {
      lines.push(
        `UNKNOWN PLACE: the actor referred to a place the party has not learned about. Treat it as in-character speculation — the world gives no confirmation it exists.`
      );
    } else if (travel.kind === "off_graph") {
      lines.push(
        [
          `OFF-GRAPH MOVEMENT (STRICT — this scenario's map is FIXED to the KNOWN LOCATIONS listed above; there is nothing beyond it):`,
          `the actor tried to leave to a place that is NOT on the map (e.g. "go outside", "leave this room", a street, a shop, "anywhere else"). Do NOT invent a new area, side-scene, exterior, or destination, and do NOT let anyone leave the map. Keep ${mover} at this scene's location.`,
          `Narrate briefly and in-world why they can't simply wander off that way (the exit is blocked/leads nowhere useful/there is no reason to leave), then point them at the real routes: name the 可前往 locations as the only ways onward.${discoveredLocked.length ? " Locked-but-known places exist too, but stay closed until their conditions are met." : ""}`,
          `Set "move_to" to null. Award no evidence, confirm no hidden place, advance no unlock condition.`,
        ].join(" ")
      );
    }
  }

  // Split-party: the 3 suggested choices are for the NEXT character, who may be
  // standing somewhere else entirely — bind them to THAT scene, not this one.
  if (scene && scene.nextNode) {
    const nextNodeDef = graph.nodes.find((n) => n.id === scene.nextNode);
    const nextExits = computeExits(graph, state, scene.nextNode);
    const nextParts: string[] = [];
    if (nextExits.open.length) nextParts.push(`可前往：${nextExits.open.map((n) => shortName(n.name)).join("、")}`);
    if (nextExits.locked.length) nextParts.push(`看得到但進不去：${nextExits.locked.map((n) => shortName(n.name)).join("、")}`);
    lines.push(
      `NEXT TURN'S SCENE (for the 3 suggested choices ONLY): ${scene.nextName} is at ${shortName(nextNodeDef?.name ?? scene.nextNode)}. ` +
      `The choices MUST be actions ${scene.nextName} can take THERE — at that location, or moving to one of ITS exits${nextParts.length ? `（${nextParts.join(" | ")}）` : ""}. ` +
      `Do NOT write choices set at ${scene.actorName}'s location unless it is the same place.`
    );
  }

  // Triggered NPC encounters this turn.
  for (const enc of firedEncounters) {
    lines.push(
      `NPC ENCOUNTER THIS TURN — ${npcDisplayName(enc.npc, npcRoster)} arrives / makes contact with the party regardless of location. Weave this into the scene immediately. Beat: ${enc.beat}`
    );
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

// ── Legacy location migration ──────────────────────────────────────────────────

/** Minimal shape of a legacy free-text location entry. */
export interface LegacyLocationEntry {
  name: string;
  clues?: string;
  items?: string;
  reveal_image?: string;
  reveal_text?: string;
}

/**
 * Convert the old free-text `locations` array into LocationGraph nodes so the
 * legacy system can be retired without losing data or the player-facing
 * search-reveal feature.
 *
 * Each entry becomes an ALWAYS-UNLOCKED node (legacy locations had no gating, so
 * the party can reach them all freely). Clues/items fold into the GM-facing
 * `desc`; any reveal image/text becomes a searchable evidence piece carrying the
 * same media, so a successful search still surfaces it to players exactly as
 * before.
 */
export function nodesFromLegacyLocations(locs: LegacyLocationEntry[]): LocationNode[] {
  return locs
    .filter((l) => l && typeof l.name === "string" && l.name.trim())
    .slice(0, 40)
    .map((l, i): LocationNode => {
      const descParts: string[] = [];
      if (l.clues?.trim()) descParts.push(`線索：${l.clues.trim()}`);
      if (l.items?.trim()) descParts.push(`物品：${l.items.trim()}`);
      const reveal = (l.reveal_image?.trim() || l.reveal_text?.trim()) ? {
        id: `loc${i + 1}_find`,
        name: "搜索發現",
        tags: [],
        how: "搜索此地點",
        reveal_image: l.reveal_image?.trim() || undefined,
        reveal_text: l.reveal_text?.trim() || undefined,
      } as EvidenceDef : null;
      return {
        id: `loc${i + 1}`,
        name: l.name.trim(),
        desc: descParts.join("\n"),
        initial: "unlocked",
        unlock: [],
        evidence: reveal ? [reveal] : [],
        on_enter: "",
        locked_narration: "",
        stuck_hint: "",
        discovers: [],
      };
    });
}
