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

### 2026-09-16 — Worked example in a prompt used a field name the coercer never read
- Context: building the story machine's validator on top of the import path.
- Symptom: the creator prompt's EXAMPLE wrote endings with `"summary"`, but `coerceEndings` only read `description` → every ending imported from a prompt-following LLM had an empty epilogue directive, silently.
- Fix: `coerceEndings` accepts `summary` as a synonym (same pattern as NPC knowledge `content`→`info`); example switched to `description`.
- Rule: a worked example inside a prompt is a contract — validate it through the real coercer (the story machine's fixture test now does this for the whole shape) instead of trusting it by eye.
- Files updated: lessons only.

### 2026-09-18 — A trigger keyed on auth.uid() blocks the service role, i.e. exactly the trusted caller
- Context: admin clicked 核准 in /admin and got the publish-gate error meant for creators.
- Symptom: `/api/admin/scenarios/[id]/review` passed its own admin check, then the UPDATE (done with `createAdminClient()`, per the hardening rule) was refused by `enforce_scenario_publish_gate()`.
- Root cause: under the service role there is no user JWT → `auth.uid()` is NULL → `is_admin()` is false. The gate had no notion of "trusted server write", so the one path designed to publish was the one it blocked. Two rules written in different weeks (hardening: sensitive writes use service role; review: only admins may publish) were each correct and jointly impossible.
- Fix: `fix_publish_gate_service_role.sql` — gate also passes when the request's JWT role is `service_role` (`is_service_role()`); the browser can never present that role, so the creator-side guarantee is intact.
- Rule: any DB-side authorization check (`is_admin()`, `auth.uid() = …`) that a service-role route will hit needs an explicit service-role allowance, or the route needs a user-client write plus an RLS policy. Decide which at design time; test the admin path with the admin's real client, not just the creator path.
- Files updated: lessons only.

### 2026-09-18 — "Sole candidate" fallback redirected a named spell onto a bystander
- Context: player picked 萎縮術 and typed the target 「郭一山」; the spell burned 林秀瑤.
- Symptom: explicit target ignored; the only NPC present took the hit and retaliated.
- Root cause: target chain was exact → fuzzy → "if exactly one candidate present, use them". 郭一山 was not a valid target in that scene (elsewhere / not an NPC), fuzzy scored 0, and the fallback — written for 「攻擊她」 — fired on a turn that clearly named someone else. Same chain in the attack path.
- Fix: `findNamedNonCandidate()` — if the text names any known character who is not a candidate, decline with that name in the error; `isBareNameLike()` — a bare name that matched nobody is a miss, not a wildcard. Both fallbacks guarded.
- Rule: a "pick the only option" fallback must first prove the input is UNNAMED. Any known name in the text that is not among the options means the player asked for something you cannot do — say which, do not substitute.
- Files updated: lessons only.

### 2026-09-18 — "He is standing right there" — narration placed an NPC where the placement table did not
- Context: follow-up to the 萎縮術 mis-target. The player insisted 郭一山 was in the same place; the narration had him holding the door as the party stepped into the corridor.
- Symptom: an NPC the story shows beside you is refused (or, before the guard, silently swapped) as a target.
- Root cause: presence is decided by `npc_placements` (last satisfied placement's node); an NPC with any placement is present ONLY there. The GM narrated him at the room's door during the move turn, which reads as "with us" once the party is in the corridor. Server and narration disagreed and the player only saw the narration.
- Fix: the refusal now says where the server has the NPC (「郭一山此刻在『辦公室』，不在你所在的『走廊』」, hidden nodes never named) and `[target:resolve]` logs actor node, named NPC, placement, candidates. `npcPlacementNode()` added for "where is this NPC".
- Rule: when server state refuses something the narration made look possible, the refusal must state the server's fact in the player's terms; otherwise every such refusal is reported as a bug. Creators who want an escort NPC must give him a placement per node (or none, to follow the party).
- Files updated: lessons only.

### 2026-09-16 — Story machine: the writer echoed full_story, so output size scaled with input and got truncated
- Context: first run of the story machine UI on a 68k-character campaign module.
- Symptom: `claude -p --model opus` ran 24 minutes, then the round died with "找不到合法的 JSON" — the raw output stopped mid-sentence inside `full_story`.
- Root cause: writer rule 6 demanded `full_story` verbatim, so a 68k-character input required a 68k-character output on top of the scenario structure; that crossed the model's per-response output limit. The platform's own cap (`SOURCE_DOC_MAX_CHARS`, 100k) never got a chance to apply.
- Fix: the writer now emits the placeholder `__FULL_STORY__` and the machine injects the text after extraction (`injectStory`; CLI `extract --story <file>`); critic/fix prompts get the placeholder too (`stripStory`). Stories over a threshold are condensed first (`condensePrompt`), default sonnet.
- Rule: never ask a model to reproduce input verbatim inside its output — copy it in code; the model's output budget must be spent only on what it has to decide.
- File updated: lessons only (story-machine README documents the contract).

### 2026-09-16 — Validator warned on 或 inside parentheses, the exact form its own message recommends
- Context: five consecutive story-machine runs, two different writer models, each ended with the same warning on the "bad ending" objective.
- Symptom: `目標 …（使用炸藥或鐵鎚） 含有「或」——…例如「取得農場控制權（合作或武力）」` — the recommended example itself contains 或 in parentheses.
- Root cause: the check ran the regex over the whole objective text; the rule's intent is "branches go in parentheses", so parenthesised 或 is compliance, not violation.
- Fix: strip `（…）`/`(…)` before testing (`validate.ts`); verified against the four real strings (three parenthesised pass, the bare "A，或 B" still warns).
- Rule: when a validator message shows a "correct" example, feed that example through the validator — a rule that flags its own example is self-contradictory and models will keep tripping it.
- File updated: lessons only.

### 2026-09-16 — Story machine server died on EPIPE when a role command exited without reading stdin
- Context: zero-token pipeline test with `head -c 3000` standing in for the condenser.
- Symptom: `/api/run` returned a run id, then every request got "Connection refused" — the whole Node process was gone.
- Root cause: `child.stdin.write(prompt)` on a child that had already exited raised an `error` event on the stdin stream with no listener; Node treats an unhandled stream error as fatal.
- Fix: `child.stdin.on("error", () => {})` in `runCmd`; the `close` handler already reports the real outcome.
- Rule: any spawned child that receives piped input needs a stdin error handler — the failing command should fail the step, never the server.
- File updated: lessons only.

### 2026-09-16 — "Most locations unlocked" means many start points; evidence text was narrating conclusions
- Context: reviewing the story machine's output on a campaign-scale module with the product owner.
- Symptom: 10 of 17 locations `unlocked` in free travel mode — the party can jump anywhere on turn 1, so the opening location is meaningless; and `reveal_text` on evidence stated interpretations and scripted NPC reactions ("駕駛技術不錯", "若讓他看清內容物他會改口") instead of what the players perceive.
- Root cause: the creator prompt's guidance said "大部分地點用 unlocked", and nothing distinguished observation from conclusion for evidence text. The engine starts the party on the FIRST unlocked node (`locations.ts`), so extra unlocked nodes are extra starts.
- Fix: one-start rule and observe-don't-conclude rule added to the writer preamble, critic rubric (rules 8, 9), the shared creator guidance in `lib/ai/scenario-json-prompt.ts`, and the machine validator (extra starts → blocking; concluding text → keyword warning).
- Rule: any "initially open" flag is a start point in disguise — count them; and any text the player receives verbatim must be sensory, with meaning kept on the GM side.
- File updated: lessons only (story-machine README documents both rules).

### 2026-09-18 — NPC encounters fired "regardless of location" the turn an item was taken
- Context: product owner reviewing a generated scenario's NPC 觸發事件.
- Symptom: pick up the journal in the sea cave → the mayor "arrives" in the cave next turn. The GM directive literally said "arrives regardless of location, weave in immediately".
- Root cause: `NpcEncounter` had only `when` + `beat`; `evaluateEncounters` fired the turn the condition held, and the condition grammar has no "party is currently at X" term, so authors could not express "when they next come to the town hall".
- Fix: optional `at` (node or container id — wait until the party is there) and `delay` (rounds after the condition first holds) on encounters; `encounters_armed` in LocationState remembers the arming round; GM wording changes when `at` is set. Legacy data unchanged. Author docs, story-machine writer rule 10 / rubric 10 / validator warning added. Verified with a scratch tsx script (legacy, at node, at container, delay, coercion round-trip).
- Rule: any "fires when condition X" trigger needs an answer to WHERE and WHEN it may fire — a trigger with no place gate is a teleport.
- File updated: lessons only.
