# Location Map v2 — Container / Place / Edge system

Status: **approved** (2026-07-08). Decisions: BFS one-turn travel · no hidden-leak
fix (accepted risk, "just a game for fun") · hand-rolled minimal canvas (no
react-flow dependency).

## Why

The v1 graph is flat with **no adjacency**: any unlocked node is reachable from
anywhere. This caused a family of bugs patched individually (teleporting
searches, "go out" escaping the map, GM options acting across locations, fuzzy
match ambiguity over the whole map). v2 makes space *structural*: containers
group place nodes, edges define adjacency, players move node-to-node.

## Data model (all inside scenarios.location_graph JSONB — no DB migration)

```ts
interface LocationGraph {
  version?: 2;                       // absent = legacy flat graph
  travel_mode: "free" | "edges";     // "free" = v1 behavior (legacy default)
  containers: ContainerDef[];
  nodes: LocationNode[];             // place nodes only — the ONLY standable things
  edges: EdgeDef[];
  npc_placements: NpcPlacement[];    // unchanged
  npc_encounters: NpcEncounter[];    // unchanged
}
interface ContainerDef {
  id: string; name: string;
  entry: string;                     // child place-node id (REQUIRED, validated)
  all_children_connected: boolean;   // 此區域內地點可互相前往
  show_locked_children: boolean;     // locked children visible on player map
  pos?: { x: number; y: number };    // editor layout only
}
// LocationNode gains: container?: string; pos?: {x,y}
interface EdgeDef { from: string; to: string; two_way: boolean } // node OR container ids
```

**Single gating authority: node status.** Edges carry only adjacency +
direction in MVP. The creator-facing path kinds map onto existing machinery:
可以前往 = edge + unlocked target · 單向/雙向 = two_way · 看得到但進不去 =
`discovered` · 條件達成後可前往 = node `unlock` · 未發現 = `hidden`+`discovers`.
Edge-level conditions (a locked door between two open rooms) = v2 feature.

## Runtime rules

- `location_state` unchanged; `current` is always a **place node**. Containers
  are never standable and never appear in state.
- `computeExits(graph, state)`: siblings when `all_children_connected`, plus
  edge targets (one-way respected; container targets resolve to `entry`),
  partitioned by node status (unlocked → 可前往 / discovered or
  show_locked_children → 進不去 / hidden → omitted).
- **Travel = one-turn BFS** over open exits. Reachable via open path → move in
  one action. Path crosses a locked node → refuse, naming the blocker
  (「要到電梯得先經過走廊，但鐵閘還鎖著」). "Explicit node-to-node" means the
  *state* is always one exact node, not one edge per turn.
- Travel INTO a container by name places the party at its `entry` node.
- `detectTravelTarget` / `resolveMoveTarget` candidates (edges mode) =
  reachable set + adjacent-locked. Hidden nodes never match.
- GM directive: 可前往 = computed exits only; nearby-locked listed with
  `locked_narration` hints; never enumerate other containers' interiors.
- **Free mode** (`travel_mode: "free"`) = exact v1 behavior, kept forever.
  Legacy graphs coerce to it automatically; zero behavior change until a
  creator opts into 地圖模式.

## Editor (3 layers, hand-rolled)

1. **全圖**: fixed canvas (no pan/zoom), draggable container cards + top-level
   place nodes, SVG edge lines (solid=雙向, arrowhead=單向), click-click edge
   creation (「連接」→ click target → popover 單向/雙向/刪除).
2. **容器內部**: child nodes on canvas + settings strip (入口地點 dropdown,
   ☑ 此區域內地點可互相前往 with faint auto-lines, ☑ 讓玩家看見未解鎖的內部地點).
3. **節點詳情** side panel: reuses existing field blocks (name/desc/初始狀態/
   解鎖條件 ConditionBuilder/discovers chips/證物/首次進入圖片文字/on_enter/
   locked_narration/stuck_hint). `id` auto-generated, tucked in 進階.

No technical vocabulary in creator UI (no "edge/graph/unlock_condition").

## Player UI

Grouped 地點 panel (desktop sidebar + mobile 地點 sheet):
📍 目前位置 `1404室 › 神位` · 可前往 (tap-to-fill) · 看得到但進不去 🔒.
No player mini-map in MVP.

## Validation

- container entry exists among its children (error)
- stranded nodes: BFS from starting node over edges+containers (warning)
- container with no children (warning)
- edge endpoints exist (error)

## Scope

- **MVP**: schema+coercion+validation → runtime → player panel → visual editor
  → integration. Verify pure functions with scratchpad node scripts (no test
  suite — repo rule P3).
- **v2**: edge conditions · pan/zoom + drag-to-connect · per-edge travel
  flavor · NPC chips on canvas · player mini-map · auto-layout.
- **Not building**: nested containers · per-player positions · timed edges ·
  NPC pathfinding · multi-floor visualization.

## Accepted risks

- Full graph (incl. hidden nodes) still ships to the client — accepted.
- Prompt-level GM constraints remain probabilistic; server-side matching
  restrictions are the hard guarantee.
