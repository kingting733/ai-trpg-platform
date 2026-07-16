# Split Party v1 — per-character positions (individual location system)

Status: **phases A–D BUILT** (TDD: 74 split-party cases + 68 legacy regression
cases green; five-lens adversarial review passed). **Phase E — the two-player
integration playtest below — is REQUIRED before announcing the feature.**
Decisions locked with the author: **shared map knowledge ✓ · shared
inventory ✓ · solo-combat rule ✓.**

## Why

Today the party occupies ONE node (`location_state.current`) and moves as a
unit. Splitting up is the engine of CoC horror — someone alone in the dark —
and the turn-based structure already narrates one player's scene per turn, so
per-character positions fit the engine's grain. No scenario-editor changes:
maps already support this; only the runtime is party-locked.

## Data model (no SQL migration — all inside rooms.location_state JSONB)

```ts
interface LocationState {
  /** LEGACY MIRROR — kept in sync with the ACTING character's node after each
   *  turn so old readers keep working. New code never reads it directly. */
  current: string | null;
  /** NEW: per-character positions, keyed by in-room characters.id. */
  positions: Record<string, string>;
  // ALL SHARED (party knowledge — decision ✓):
  status; visited; entered_round; evidence_found; stuck_counter; encounters_fired;
}
```

- `positionOf(state, characterId, graph): nodeId` — fallback chain:
  `positions[id]` → legacy `current` → first unlocked node. This makes every
  old room coerce cleanly: on first read, everyone stands where the party was.
- `entered_round` / `visited` / `discovers` semantics: first entry **by anyone**
  (shared knowledge). `after:` gates unchanged.
- `stuck_counter` stays party-level (progress by anyone resets it).
- Inventory, ledger, summary, objectives, endings: **untouched**.

## Runtime rules

1. **Travel moves the ACTOR only.** `resolveTravelIntent(actionText, graph,
   state, actorNode)` — candidates/reachability computed from the actor's node.
   GM `move_to` likewise moves only the actor (`resolveMoveTarget` from actor's
   node). Travel log line names the character: `📍 阿明 前往：走廊` (not 隊伍).
2. **Exits are per character.** `computeExits(graph, state, fromNode)` —
   same function, explicit origin. Free mode unchanged (everything open).
3. **Evidence awards at the actor's node.** `matchEvidence(..., actorNode)`.
   Awarded 證物 go to the shared bag (decision ✓).
4. **NPC presence is per scene.** `npcsAt(graph, state, nodeId, round, obj)` —
   placement rows resolve as today, presence checked against the given node.
5. **Solo-combat rule (decision ✓).** A hostile NPC attacks only characters
   located at ITS node this turn. No co-located character → no attack (it
   holds/roams per placement rules). A lone investigator fights alone.
6. **First-visit media / on_enter / discovers** fire on first visit by anyone.
7. **Encounters** fire once globally (as today); the beat is delivered into the
   acting character's scene.
8. **Spawn**: opening + turn-1 seed put every character at the entry node.
   Splitting is opt-in by walking away.

## GM prompt changes (buildLocationBlock + turn message)

- `SCENE THIS TURN: <actor> is at <region › node>` — desc/evidence/NPCs of
  the ACTOR's node only.
- `PARTY WHEREABOUTS: 阿明 @ 神位 · 小美 @ 走廊 …` + hard rule: characters not
  at this scene's node are NOT present — do not show them acting, speaking, or
  perceiving here; do not reveal to the actor what happened in scenes they did
  not witness (the players at the table can see everything; the CHARACTERS
  cannot).
- **Choices are for the NEXT actor's node**: a short block
  `NEXT TURN'S SCENE: <next> is at <node>; 可前往: …` and the choice rules
  bind to THAT block (they already say "current location or one 可前往 exit").
- MOVING/blocked/off-graph directives: reworded from 隊伍 to the actor.

## Choice sanitization (server)

`sanitizeChoices` validates against the **NEXT actor's** node + exits.
Anticipated `move_to` matters only when next actor === actor (single-player
room): then validate against the destination. Otherwise the actor's move does
not change the next actor's position.

## Player UI

- 地點 panel: 📍 shows **my character's** position + my exits (click-to-fill
  unchanged); a small 隊友 list shows teammates' positions (shared knowledge ✓).
- Everything else unchanged.

## Compatibility

- Old rooms: `positions` absent → seeded from legacy `current` on first turn.
- Parties that never split behave identically to today.
- `current` kept as a mirror of the last actor's node so any unmigrated reader
  (or an old client build) still shows something sane.

## Risks & mitigations

- **GM scene-bleed** (info from A's scene leaking into B's narration): the
  WHEREABOUTS hard rule + RECENT TURNS untouched; accept imperfection, watch in
  playtest, consider tagging log lines with their scene node in v2.
- **Choices-for-wrong-room bug class**: covered by the next-actor exits block +
  sanitizeChoices validation + dedicated tests (below).
- **Spectator drag / lethal solo fights**: by design (genre); note in creator
  guidance. The stuck-nudge machinery can poke quiet rooms in v2.

## Out of scope (v1)

Per-player fog-of-war · per-character inventory · NPC pathfinding toward
players · simultaneous scene resolution · private (hidden) narration per player.

---

# TDD plan (repo P3: scratchpad node suites, RED first)

**Phase A — pure lib (`lib/game/locations.ts`)** — one suite per change, each
written RED against the un-modified module, then GREEN:

- A1 `positionOf`: positions hit → node; missing → legacy current; both
  missing → first unlocked; unknown character; graph with no unlocked node.
- A2 `coerceLocationState`: positions round-trip; junk positions filtered
  (unknown node ids dropped); legacy state (no positions) unchanged otherwise.
- A3 `computeExits(graph, state, fromNode)`: two characters at different nodes
  get different 可前往 sets; omitted param falls back to legacy current
  (regression: all existing call sites unchanged until migrated); free mode.
- A4 `resolveTravelIntent(..., actorNode)`: same action text resolves
  differently for A (corridor) vs B (inside flat); blocked/locked/hidden per
  actor; container entry per actor.
- A5 `matchEvidence(..., actorNode)`: award at actor's node, not the legacy
  party node; regression for single-position rooms.
- A6 `npcsAt(node)`: NPC present for co-located character only; placement
  rows with conditions; `eligibleCombatTargets(characters, positions, npcNode)`
  returns only co-located, alive characters (solo-combat rule), empty → no
  attack.
- A7 `buildLocationBlock(actorNode, whereabouts)`: contains SCENE THIS TURN
  with actor's node; PARTY WHEREABOUTS lines; the not-present hard rule; NEXT
  TURN'S SCENE block with next actor's exits; travel directives say the
  character's name, not 隊伍.

**Phase B — route rewiring (`app/api/gm/respond/route.ts`)**
Not directly unit-testable (Supabase I/O) — verified by A-suite signatures +
typecheck + the integration checklist below. Changes: actor position resolve →
travel block per actor → evidence per actor → NPC presence/combat filter →
positions write + legacy `current` mirror → directives per actor.

- B-guard test (pure, extracted): `applyActorMove(state, actorId, nodeId)`
  updates positions + mirrors current + marks visited/entered_round only on
  first visit by anyone.

**Phase C — choices**
- C1 `sanitizeChoices` against NEXT actor's node; single-player room
  anticipates the actor's own move; multiplayer ignores the actor's move for
  validation; locked/hidden name drops computed from next actor's exits.

**Phase D — UI (panel + opening seed)**
Visual; typecheck + manual. Panel shows my position; teammates list renders;
old room (legacy state) renders without crash.

**Phase E — integration playtest checklist (staging room, 2+ players)**
1. Both spawn at entry; A walks to 神位, B stays — panel shows split.
2. A's turn narrates 神位 only; B's next-turn choices are for B's node (門口),
   not A's.
3. Hostile NPC at 神位 attacks A only; B untouched (solo-combat ✓).
4. B discovers a hidden room → A's map also shows it (shared knowledge ✓).
5. A picks up 證物 at 神位 → shared bag shows it for B (shared inventory ✓).
6. GM narration for B does not mention what A saw (scene-bleed spot check,
   5-turn sample).
7. Legacy room (created pre-split) resumes: everyone stands at old `current`,
   turns work, no console errors.
8. Single-player room regression: move + act in one flow still works,
   choices follow the player across rooms.

Ship order: A (all suites green) → B → C → D → commit per phase → E before
announcing.
