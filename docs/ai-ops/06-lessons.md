# 06 — Lessons log (append-only; format defined in 04-maintenance-protocol.md)

### 2026-07-03 — AI judge returned empty because of token starvation, not logic
- Context: objective tracker "seldom works" despite correct prompt/wiring.
- Symptom: `[objectives:check] no verdict — callAI returned empty` on HTTP 200.
- Root cause: judge call had `max_tokens: 200`; the classify model spends hidden reasoning tokens from that budget before emitting JSON → empty visible output.
- Fix: budget 800 (`AI_CLASSIFY_MAX_TOKENS`), plus logging of finish_reason/usage on empty-200s.
- Rule: an empty LLM response on HTTP 200 is a budget/model problem, not a prompt problem — log finish_reason before touching prompts.
- File updated: 00-diagnosis (P1).

### 2026-07-03 — Two AI prompts in one pipeline contradicted each other
- Context: objectives never completed even on exact-text input.
- Symptom: judge demanded "GM narration explicitly confirms success" while the GM was ordered to never announce objectives.
- Root cause: two prompts written at different times, never read side by side.
- Fix: judge now scores concrete narrated events, told the GM won't announce.
- Rule: when two prompts hand off to each other, read both together and check what one requires the other is allowed to produce.
- File updated: lessons only.

### 2026-07-03 — Keyword lists silently missing the most obvious word
- Context: "attack NPC" did nothing; passed STR check, no damage, no dodge log.
- Symptom: combat path skipped entirely; degraded to a solo check.
- Root cause: `detectAttackType` keyword list lacked the literal word "attack" (and kill/shoot/踢/殺…).
- Fix: expanded lists; ranged verbs split into their own class.
- Rule: when a detector "never fires", test its trigger list against the user's exact input before debugging downstream.
- File updated: lessons only.

### 2026-07-03 — One-way state flags create permanent wrong behavior
- Context: NPC kept attacking after the story made peace.
- Symptom: hostility set on retaliation, no code path ever cleared it.
- Root cause: boolean `hostile` designed for onset only; no de-escalation authority.
- Fix: runtime `stance` overriding disposition + two validated clear paths (passed social check; GM `npc_calmed` field).
- Rule: any flag set by an event needs an explicit answer to "what clears it?" at design time — "nothing" must be a deliberate choice.
- File updated: 02-rubric §9 pattern.

### 2026-07-03 — Renamed enum values left stale comparisons elsewhere
- Context: winning gave "失敗結局不開放角色成長".
- Symptom: growth gate checked `ending_type === "good"|"normal"` while the ending system now writes `"victory"`; UI masked it by falling back to a default badge.
- Root cause: the ending-type enum was renamed without grepping for consumers of the old literal values.
- Fix: shared `endingAllowsGrowth()` helper as single source of truth.
- Rule: when renaming stored enum values, grep the whole repo for every literal of the OLD values before shipping.
- File updated: lessons only.

### 2026-07-03 — Fuzzy matching needs both looseness AND ambiguity guards
- Context: travel/attack targeting: "去" false-teleports vs "go 門口" not matching "1404 室門口".
- Symptom: oscillating between too-strict (players can't move) and too-loose (teleport on unrelated text).
- Root cause: matching tuned as one knob; it's two — trigger sensitivity and target resolution.
- Fix: permissive triggers + strict resolution (unlocked-only, partial matches allowed but declined when two candidates are close) + GM `move_to` fallback validated by server.
- Rule: make triggers generous and resolution conservative; on ambiguity decline rather than guess; give the AI a validated escape hatch for natural language.
- File updated: 00-diagnosis (P2).

### 2026-07-03 — "Award if exactly one remains" style special cases surprise everyone
- Context: searching a room with 2 clues awarded nothing; with 1 clue it worked.
- Symptom: intermittent-looking evidence awards.
- Root cause: generic-search fallback only fired at `unfound.length === 1`.
- Fix: method-matching (search-type 取得方式 vs specific actions like 破壞電腦).
- Rule: count-dependent special cases (`length === 1`) in game logic are bug factories — prefer classifying intent.
- File updated: lessons only.

### 2026-07-03 — Player-visible surfaces leaked GM-internal info in three places
- Context: 證物 highlighted gold in bag, `🔎 取得證物` log line, `已取得證物 N 件` count in the location panel.
- Symptom: players could identify plot-critical items and clue counts.
- Root cause: each new UI surface rendered raw internal state; no shared "player-safe rendering" rule existed, so the same leak was re-created independently three times.
- Fix: uniform 📦 物品 wording everywhere; count removed.
- Rule: any new player-facing render of game state must be checked against "does this reveal importance/progress the GM hides?" — the same leak reappears on every new surface.
- File updated: CLAUDE.md non-negotiables.
