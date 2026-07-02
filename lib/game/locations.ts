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
  nodes: LocationNode[];
  npc_placements: NpcPlacement[];
  npc_encounters: NpcEncounter[];
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
      node_image: asStr(n.node_image) || undefined,
      node_text: asStr(n.node_text) || undefined,
    }))
    .slice(0, 40);
  // Dedupe ids — first definition wins.
  const seen = new Set<string>();
  const deduped = nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  if (deduped.length === 0) return null;
  // At least one node must be initially enterable, or the game can never start.
  if (!deduped.some((n) => n.initial === "unlocked")) deduped[0].initial = "unlocked";
  return {
    nodes: deduped,
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
  objectiveProgress: ObjectiveProgressLike = {}
): string[] {
  if (!state.current || graph.npc_placements.length === 0) return [];

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
    if (lastSatisfied && lastSatisfied.at === state.current) present.push(npc);
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

/** Find the location the action most plausibly refers to (any status).
 *
 *  Scoring, strongest first: full short-name match, then a whole distinctive
 *  segment, then a PARTIAL match — a CJK chunk (≥2 chars) the player typed that
 *  is a substring of the name (so "神位" reaches "1404神位", whose number is glued
 *  to the name and forms one segment). Partial matches are weak and gated by an
 *  ambiguity guard: if two locations match a partial equally, we decline rather
 *  than guess. */
export function detectTravelTarget(
  actionText: string,
  graph: LocationGraph,
  state: LocationState
): { node: LocationNode; status: LocationStatus } | null {
  const a = actionText.toLowerCase();
  const cjkRuns = (a.match(/[㐀-鿿]+/g) ?? []).filter((r) => r.length >= 2);
  const scored: { node: LocationNode; score: number }[] = [];
  for (const node of graph.nodes) {
    if (node.id === state.current) continue;
    let score = mentionScore(a, node.name); // exact / whole-segment (≥100)
    if (score === 0) {
      // Partial: a CJK chunk the player typed appears inside the name.
      const nameLower = node.name.toLowerCase();
      for (const run of cjkRuns) {
        if (nameLower.includes(run) && run.length > score) score = run.length;
      }
    }
    if (score > 0) scored.push({ node, score });
  }
  if (scored.length === 0) return null;
  scored.sort((x, y) => y.score - x.score);
  const [best, second] = scored;
  // Weak (partial, <100) matches must clearly beat the runner-up, else it's
  // ambiguous ("神位" shared by two rooms) and we don't guess.
  if (best.score < 100 && second && best.score < second.score * 2) return null;
  return { node: best.node, status: state.status[best.node.id] ?? "hidden" };
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
  state: LocationState
): LocationNode | null {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  let best: LocationNode | null = null;
  let bestScore = 0;
  for (const node of graph.nodes) {
    if (node.id === state.current) continue;
    if (state.status[node.id] !== "unlocked") continue; // locked/hidden: never
    const full = node.name.trim().toLowerCase();
    const sn = shortName(node.name).toLowerCase();
    let score = 0;
    if (q === full || q === sn) score = 1000;
    else if (full.includes(q) || q.includes(sn)) score = 100 + Math.min(q.length, full.length);
    else score = mentionScore(q, node.name);
    if (score > bestScore) {
      best = node;
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
  // Generic successful search (the action named no specific piece): award the
  // NEXT unfound clue at this location — one per successful check. A passed 偵查
  // in a room should reveal one of its clues; the dice gate repeats, and a
  // targeted phrasing above still prioritises the specific piece it names.
  return unfound[0] ?? null;
}

// ── GM directive block ────────────────────────────────────────────────────────

export type TravelDirective =
  | { kind: "arrived"; node: LocationNode; firstVisit?: boolean }
  | { kind: "soft_wall"; node: LocationNode }
  | { kind: "unknown_place"; node: LocationNode }
  | { kind: "off_graph" };

/** Compact per-turn block telling the GM the authoritative location state.
 *  `currentRound` is needed to evaluate NPC placement conditions.
 *  `firedEncounters` are NPC encounter events that fired this turn. */
export function buildLocationBlock(
  graph: LocationGraph,
  state: LocationState,
  travel: TravelDirective | null,
  stuckHint: string | null,
  currentRound: number,
  firedEncounters: NpcEncounter[] = [],
  objectiveProgress: ObjectiveProgressLike = {},
  npcRoster: NpcRef[] = [],
): string {
  const current = graph.nodes.find((n) => n.id === state.current);
  const lines: string[] = ["LOCATION SYSTEM (server-authoritative — you MUST follow this; you cannot reveal hidden places yourself, and the party's position only changes via the move_to field below or a TRAVEL notice from the system):"];

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

  // NPC presence — server-computed, GM must not add or remove NPCs from the scene.
  const npcsHere = evaluateNpcPlacements(graph, state, currentRound, objectiveProgress);
  if (graph.npc_placements.length > 0) {
    if (npcsHere.length > 0) {
      lines.push(`NPCS PRESENT HERE: ${npcsHere.map((ref) => npcDisplayName(ref, npcRoster)).join("、")}`);
    }
    lines.push("NPCs not listed above are NOT at this location — do not introduce them into the current scene unless an encounter fires.");
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
  lines.push(
    `MOVING: if the acting player's action means going to one of the 可前往 locations (however they phrase it — partial name, "回去那裡", a typo), narrate the party moving there and set "move_to" in your JSON to that location's EXACT name from the list. If they try somewhere locked or unknown, the party STAYS at CURRENT LOCATION — narrate why entry fails and set move_to to null. If the system already announced "TRAVEL THIS TURN" below, the move is done: set move_to to null. Never narrate the party being anywhere except CURRENT LOCATION or a move_to/TRAVEL destination.`
  );

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
          `(a) MUNDANE & PLAUSIBLE for this setting (e.g. a shop, café, street corner, public office) — play a side-scene there: atmosphere, rumors, NPC chatter, or soft hints pointing toward the known locations. The party may stay as long as the players wish, but you must NOT award any listed evidence, confirm any hidden place, or advance unlock conditions there — anything truly important always lives at the listed locations, so naturally nudge them back when the scene runs dry.`,
          `(b) A PLOT-RELEVANT place from your story notes that is not yet open, or an attempt to bypass locked areas, or something that doesn't fit the world — deny it with an in-world reason (road closed, no address, too dangerous) and steer the players toward the known locations listed above. Give no confirmation the place exists.`,
          `If the party is already in such a side-scene (see recent story log), keep narrating from there — they can move on to any 可前往 location at any time, or to another mundane place under the same rules.`,
        ].join(" ")
      );
    }
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
