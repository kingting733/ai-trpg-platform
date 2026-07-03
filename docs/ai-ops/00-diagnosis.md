# 00 — Diagnosis: the three problems that waste the most effort in this repo

Written 2026-07-03 by a frontier-model session after ~30 fixes/features in one long run.
Later docs refer back to these as **P1 / P2 / P3**.

---

## P1 — Silent failure paths (things fail with no trace, and get misdiagnosed as logic bugs)

**Symptoms**
- "任務目標 seldom works", "the location system works sometimes" — intermittent, unreproducible reports.
- A feature is correct in code but "does nothing" in play.
- DB writes silently no-op.

**Root causes seen in this repo**
- AI helper calls swallowed every error and returned `""` (empty = "nothing happened"). The objective judge failed for weeks because its `max_tokens: 200` starved a reasoning model — invisible until logging was added.
- Supabase migrations are **manual**: code that reads/writes a column that was never created in the live DB fails silently (`supabase/migrations/*.sql` must be run by the USER in the SQL editor).
- Multi-step conditions that can never be satisfied per-turn (e.g. objective "在四個角落各放一撮米" judged one turn at a time).

**The fix (now partially in place)**
- `lib/ai/objectives.ts` logs `[objectives:check ...]` with action, narration, verdict, and error causes. Extend this pattern to any new AI-judged decision.
- Every new migration must be announced to the user with "run this in the Supabase SQL editor before testing".

**How a smaller model recognizes it**
- User says "sometimes works / never works / did nothing" about a feature that looks correct → suspect a silent path BEFORE editing logic.

**How to avoid it**
1. First check Vercel function logs for the relevant tag (`[objectives:check]`, GM parse errors).
2. Then check the DB row directly (SQL in Supabase editor) — does the column exist? did the write land?
3. Only then read code. Never "fix" logic you haven't proven wrong.
4. Any new `catch {}` or `?? ""` you write MUST log why it fired (copy the style in `lib/ai/objectives.ts` `callAI`).

---

## P2 — Two sources of truth: server state vs GM narration (desyncs)

**Symptoms**
- "GM says I moved but the panel says I didn't." / "NPC made peace in the story but keeps attacking."
- Player text triggers the wrong mechanical effect, or the right effect never triggers.

**Root cause**
The server owns all mechanical state (location, HP, hostility, evidence, objectives). The GM (an LLM) narrates from raw text and can contradict that state. Naive keyword/regex parsing of player text is either too loose (teleports on "去") or too strict ("attack" wasn't in the verb list; "go 門口" missed "1404 室門口").

**The architecture that works (follow it, don't reinvent)**
- **Server decides; GM narrates.** Pure code + dice make every mechanical decision.
- When natural-language understanding is needed, use the **structured-field pattern**: the GM emits a JSON field (`injury`, `items`, `move_to`, `npc_calmed`), and the **server validates it against authoritative state** before applying (e.g. `resolveMoveTarget` only accepts unlocked nodes). The GM expresses intent; it never gains authority.
- Deterministic parsers stay as the fast path, with **conservative fuzzy fallbacks + ambiguity guards** (decline rather than guess when two candidates are close) — see `resolveFuzzyNpcTarget`, `detectTravelTarget`.
- Feed authoritative state back to the GM every turn as directive blocks (LOCATION SYSTEM, NPC STATUS, CURRENT PARTY POSSESSIONS, OBJECTIVE TRACKER) so its narration can't drift.

**How a smaller model recognizes it**
- Any bug report of the form "the story says X but the game state says Y" is P2. The fix is never "make the narration match by prompt alone" and never "let the client parse keywords".

**How to avoid it**
- New mechanic → ask: who is the authority? If code can decide it deterministically, do that. If it needs language understanding, add a GM JSON field + server-side validation + a directive block. Never scan narration text client-side for keywords.

---

## P3 — Verification gap: `tsc` is the only automated check

**Symptoms**
- Changes ship type-clean but break in play; bugs are found by the user days later.
- No test runner exists (`package.json` scripts: dev/build/start/lint only).

**Root cause**
No test suite. The de-facto verification ladder is:
1. `npx tsc --noEmit` (must be clean before every commit — non-negotiable),
2. a throwaway Node script proving the pure-function logic (see pattern below),
3. user playtest + Vercel logs.

**The proven substitute for tests** (used successfully this session)
For any pure function in `lib/game/*` or `lib/ai/*`, write a small inline-mirror test script to the scratchpad and run it with `node`, asserting the exact cases the change is about (typos, ambiguity, locked rooms, damage ranges). Paste the PASS/FAIL table into the commit conversation. Do NOT claim verification you didn't run.

**How a smaller model recognizes it**
- You are about to commit logic that no test executed. That's the gap.

**How to avoid it**
- Every logic change to matching/combat/objectives/endings gets a scratchpad verification run before commit.
- Every commit: `npx tsc --noEmit` clean, then commit (prefix taxonomy and branch rule: see CLAUDE.md non-negotiables), then push.
- Tell the user exactly what to playtest ("attack an NPC, then pass a 說服 check — expect the 🕊 log").
