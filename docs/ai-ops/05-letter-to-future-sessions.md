# 05 — Letter to future sessions

You are operating a live multiplayer game with one non-technical-leaning owner who playtests personally and reports bugs as experiences ("it works sometimes"). This letter is what I'd want told to me before touching anything.

## Three things the owner did not ask for, but matter most

1. **There is a stack of unverified changes.** One long session shipped ~30 commits (objective judge fix, inventory, NPC aggression + pacify, damage bonus, ranged combat, GM-driven movement, text effects, evidence method-matching) with `tsc` + scratchpad checks but almost no live playtest. Before adding features, ask the owner for one structured playtest and watch the Vercel logs. Expect to find 2–3 integration bugs in the NPC-aggression ↔ pacify ↔ GM-narration loop first.
2. **Migrations may be missing in the live DB.** `add_scenario_objectives.sql` and `add_inventory.sql` were never confirmed applied. If inventory or objectives "do nothing", run the P1 playbook (00-diagnosis) — check `information_schema.columns` before reading any code.
3. **The multi-step objective gap is a real, known, unfixed hole.** Objectives like "在四個角落各放一撮米" can never complete under the per-turn judge (no partial-progress memory). The owner hit it and it was diagnosed but not fixed. Options already scoped: split into atomic objectives (cheap) or sub-step tracking (bigger). Don't rediscover this from scratch.

## How this operating system will decay, and the countermeasures

- **Docs drift from code.** A matcher gets rewritten, the doc still describes the old one → future sessions trust the doc and misdiagnose. Countermeasure: fix any doc the moment it misleads you (04 §staleness) and prefer `file:line`-free descriptions of *principles* over restating code details.
- **CLAUDE.md bloat.** Each session is tempted to add "one more rule". Countermeasure: 04's one-in-one-out and the 80-line cap; new knowledge goes to 06-lessons.
- **Lessons log becomes write-only noise.** Countermeasure: the compression schedule in 04; promote recurring rules upward, keep the log short enough to actually read.
- **The player-info-leak rule erodes** — every new UI surface re-leaks 證物/progress. It happened three times in one session. Countermeasure: it's in CLAUDE.md non-negotiables; reviewers must check it explicitly (03 template 5, check #4).

## Biggest harness limitations (honest)

- **No runtime verification.** You cannot run the game, the DB, or the AI calls from here. `tsc` + scratchpad node scripts + user playtests are the entire ladder. Anything you claim beyond that is speculation — label it.
- **No cross-session memory except these files.** Whatever you learn and don't write here is gone.
- **MCP (GitHub) flaps.** Tools disappear and return; don't conclude capabilities are gone.
- **Multi-agent orchestration (Workflow) is opt-in only**; day-to-day you have the Agent tool (Explore/Plan/general-purpose) with model overrides sonnet/opus/haiku/fable.
- **The core file is huge.** `app/api/gm/respond/route.ts` (~1400 lines) doesn't fit comfortably in a working context alongside everything else. Search into it; never read it whole "for orientation".

## On ambiguous, taste-based, or judgment-heavy tasks

Decomposition, checklists, and adversarial review (01, 02, 03) raise the floor on *execution*. They do not manufacture taste. Game-balance numbers, horror-writing tone, what "feels fair" to players, whether a UX is confusing — these cannot be made deterministic by any rubric in this folder.

When you face one:
1. Check 02-judgment-rubric — if a rule covers it, follow it.
2. If not, and the stakes are real: **upgrade the model** (01 §5), or generate 2–3 candidate options with trade-offs and **ask the owner** — they answer design questions quickly and decisively (session evidence: "A+B", "v1+v2", "1d8 / 1d10+2" were all answered in minutes).
3. If neither is possible, say plainly: "this is a taste call; here is my best guess and why; it is cheap/expensive to reverse." Do not dress a guess up as a derivation.

The owner values: root causes over patches, honest limitations stated up front, being asked real design questions (and NOT being asked trivial ones), and specs before big builds. Match that and sessions go well.

— A frontier-model session, 2026-07-03
