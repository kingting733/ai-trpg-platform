# 02 — Judgment rubric (checklists that replace "use good judgment")

Each rule: **criterion → positive example → negative example → action**.

## 1. When to upgrade to a stronger model
- **Criterion**: the task requires weighing trade-offs, diagnosing from incomplete evidence, or designing across ≥2 subsystems — OR a weaker attempt produced confident-but-wrong output once.
- **Positive**: "objectives seldom fire — find out why" (multi-system diagnosis) → strong model.
- **Negative**: "rename `hostile` to `stance` in these 5 call sites" → cheap model is fine.
- **Action**: upgrade one tier, pass the failure trace along. Never re-run the identical prompt on the same tier hoping for luck.

## 2. When work counts as truly complete
All of: (a) `npx tsc --noEmit` clean; (b) logic verified by scratchpad script or read-back (per 01 §6); (c) committed with root-cause message and pushed to the designated branch; (d) user told what changed, any manual step (migration!), and an exact playtest script; (e) known limitations stated honestly.
- **Positive**: "Pushed `a948db5`. Run nothing; playtest: attack NPC → pass 說服 → expect 🕊 log. Limitation: social_immune NPCs can't be pacified."
- **Negative**: "Done!" after edits that were never type-checked, with an unannounced new DB column.
- **Action**: if any of (a)–(e) is missing, the task is not done — say what remains instead of claiming completion.

## 3. When to stop and ask the user
- **Criterion**: the decision changes game balance/design, deletes or rewrites player-visible behavior, requires a DB migration on live data, or two interpretations of the request lead to materially different code.
- **Positive**: "Should a bare '搜查 B' move the party, or only explicit travel verbs?" — design taste, asked before coding.
- **Negative**: asking "should I run tsc?" or "may I add a log line?" — never ask about non-destructive mechanics.
- **Action**: present 2–3 options with a recommendation and trade-offs, then wait. For everything else, act and report.

## 4. Signals the direction is wrong (change approach, don't retry)
- **Criterion**: any of — same fix attempted twice without effect; the fix requires fighting the architecture (e.g. making the GM authoritative over state); each fix spawns a new symptom elsewhere; you're adding special cases to a matcher instead of asking who should be the authority.
- **Positive**: travel regex kept false-firing → instead of endless regex tuning, the session added GM `move_to` + server validation (authority redesign). That was the right pivot.
- **Negative**: adding a 6th keyword variant after 5 failed ones, same architecture.
- **Action**: stop; restate the problem in one sentence; list which of P1/P2/P3 (00-diagnosis) it matches; pick the playbook or ask the user.

## 5. How to verify the quality floor
- **Criterion**: before commit, run the minimum ladder — tsc; scratchpad test for changed pure logic; grep for other callers of anything whose signature/return type changed; re-read the final diff (`git diff`) once, looking only for "would this break an untouched caller?"
- **Positive**: `matchEvidence` changed to return an array → checked callers (`grep -n matchEvidence`), found exactly one, updated it.
- **Negative**: changing a shared helper and committing without checking its other call sites.
- **Action**: any unchecked box → do it now; it takes minutes and prevents the worst class of regression.

## 6. When to use web / source checking
- **Criterion**: claims about external APIs, model names, pricing, library behavior you haven't verified in `node_modules`/docs this session.
- **Positive**: unsure whether a Supabase RLS behavior applies → check docs before asserting.
- **Negative**: web-searching CoC rules the repo already encodes in `lib/game/resolution.ts` — the repo is the authority for this game's rules.
- **Action**: verify or say "unverified". Never state external facts from memory as certainties in code comments or user messages.

## 7. When to inspect repo code before answering
- **Criterion**: ANY question about current behavior ("what happens if…", "does the system…", "why did X happen"). This session repeatedly found the truth differed from memory (e.g. 'attack' missing from the verb list).
- **Positive**: "will 'attack her' find a target?" → read the targeting block, then answer with `path:line`.
- **Negative**: answering behavior questions from the conversation summary alone after many edits.
- **Action**: grep/read the exact code path first; cite `file:line` in the answer. If you didn't look, say so.

## 8. When to consolidate/test instead of adding features
- **Criterion**: ≥2 user bug reports in the same subsystem since its last verification; or a new feature would stack on top of an unverified one.
- **Positive**: after objective-judge, inventory, combat, and pacify all changed without a playtest — recommend a playtest checklist before the next feature (the session did exactly this).
- **Negative**: bolting a new AI judge onto a subsystem whose last AI judge is still misfiring.
- **Action**: propose the smallest verification pass first; list open unverified changes to the user.

## 9. When an AI-driven decision is too fragile — make it deterministic
- **Criterion**: the decision changes authoritative state (HP, location, endings, hostility) or gates progression, AND wrongness is not cheaply self-correcting next turn.
- **Positive**: endings are evaluated by pure code over structured conditions; the AI only writes the epilogue prose.
- **Negative**: letting the GM's prose decide when the game ends (the old system this repo already migrated away from — do not regress to it).
- **Action**: structure it — stable ids, explicit conditions, server validation of any AI-proposed field. AI may propose; code disposes. Low-stakes context (flavor, a bag item) may stay AI-driven.

## 10. When to document a limitation instead of overbuilding
- **Criterion**: the edge case is rare, the robust fix needs new schema/UI/judgment machinery, and a one-line honest caveat costs the player little.
- **Positive**: "GM may narrate one wrong-turn arrival if its move_to is rejected; state re-anchors next turn" — documented, not over-engineered.
- **Negative**: leaving "objectives with multi-step wording can never complete" undocumented — that's a real gameplay-breaking gap, not a cosmetic one; it needs a fix or an explicit user decision.
- **Action**: write the limitation in the user-facing summary AND `docs/ai-ops/06-lessons.md` if it teaches a rule. If the limitation breaks a core loop, it is a bug, not a limitation.
