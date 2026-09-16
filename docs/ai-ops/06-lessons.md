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

### 2026-07-12 — GM prompt audit: rules drift into contradiction; enforce in code
- Context: full review of the GM narration prompt stack (buildSystemPrompt / buildTurnMessage / criticalGuidance).
- Symptoms found: (1) line ordering choices "in third person for <Name>" directly contradicted the later NO CHARACTER NAME rule — a fossil from before the no-name change; (2) the turn-message epilogue said "6-8 sentences, rich in atmosphere" while WRITING STYLE demands economical prose — the last-read instruction re-injected the banned purple style every turn; (3) social/occult crit guidance ("恐嚇 crit → 主動洩露資訊") was unscoped and could bulldoze NPC knowledge gates; (4) suggested choices were the only GM output with zero server validation.
- Root cause: the prompt grew by accretion — every fixed bug added a block, and duplicated rules (choice spec stated in both system and turn message) drifted apart independently.
- Fix: contradictions deleted, epilogue defers to the style blocks, crit reveals scoped to the NPC KNOWLEDGE list / module text, freelance stuck-hints subordinated to the server PACING NUDGE, and sanitizeChoices() now enforces name-strip / length-clamp / no-locked-or-hidden-location rules in code (anticipating move_to).
- Rules: (a) never state the same rule in two prompt places — one canonical block, referenced elsewhere; (b) when a prompt rule is checkable server-side, enforce it in code and keep the prompt line as guidance only; (c) any crit/bonus guidance that says "reveal information" must name WHICH gate bounds it.
- Files updated: lessons only.

### 2026-09-16 — Objective tracker audit: per-player scope deadlocked rooms; stateless judge needed one memory slot
- Context: full review of the 任務目標 pipeline (definitions → per-turn judge → progress → endings → player UI).
- Symptoms found: (1) `each_player` objectives could never complete once a player who had not done it could no longer act — turn order skipped SAN≤0 characters but the "who still needs to do it" set only excluded HP≤0, and `done` was only recomputed when someone newly completed, so a death after a partial completion also stalled it; (2) multi-step goals ("在四個角落各放一撮米") never completed because the judge saw one turn at a time with no memory of earlier steps; (3) `✓ 目標達成：<objective text>` was written as a player-visible system log — a direct leak of GM-internal wording; (4) `checkFailureTriggered` + two ending-narration helpers were dead exports nobody called, while the opening prompt still told the GM failure conditions "end the adventure in defeat".
- Fix: scope removed entirely (every objective is team-wide; legacy each-player lines migrate as ordinary objectives); judge gains a per-objective cumulative `note` it reads back next turn (memory only — never completes anything by itself; cleared on completion; shown to the GM as 進度, never to players); chat line deleted; dead code deleted; canonical OBJECTIVE RULE lives once in `lib/ai/gm.ts` and the per-turn tracker references it.
- Rules: (a) any "every member must" condition needs an answer for members who become unable to act — if there is none, the condition must not exist; (b) a stateless per-turn classifier cannot judge cumulative goals; give it exactly one explicit, server-validated memory field rather than widening its context window; (c) before wiring a "judge" prompt, grep for callers — a prompt that exists but is never called still misleads whoever reads the editor hint next to it.
- Files updated: lessons only.
