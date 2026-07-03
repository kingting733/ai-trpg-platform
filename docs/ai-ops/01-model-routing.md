# 01 — Model routing & delegation rules

## What this environment actually provides (inspected 2026-07-03 — re-verify if things look different)
- **Main model**: whatever the user selected (`/model`). Sessions here have run on Opus-class and Sonnet-class models.
- **Agent tool** with subagent types: `general-purpose` (full tools), `Explore` (read-only search; fast), `Plan` (architecture/planning, read-only), `claude` (catch-all), `claude-code-guide` (questions about Claude Code itself).
- **Agent model override**: `model: "sonnet" | "opus" | "haiku" | "fable"` per agent call. Do not invent other names.
- **Workflow tool** (multi-agent orchestration with `effort` controls) exists but **requires explicit user opt-in** ("ultracode" / "use a workflow"). Do not use it uninvited.
- **GitHub MCP** (`mcp__github__*`) for PR/issue work — it sometimes disconnects and reconnects; if tools vanish, wait/ToolSearch rather than declaring them gone. **No `gh` CLI.**
- **No test runner** in the repo. Verification = `tsc` + scratchpad node scripts + user playtest (see 00-diagnosis P3).
- Scratchpad dir for temp files is given in the system prompt — use it, not `/tmp`.
- No persistent memory between sessions **except files in this repo**. That is why these docs exist.

## Rule 1 — The main conversation is a commander, not a laborer
The main context is the scarcest resource. Do not burn it on bulk reading or broad scans.

| Task | Do it in main context? |
|---|---|
| Read a specific ~50-line region you already located | Yes |
| Find where X is defined / all callers of Y | No → `Explore` agent |
| Understand an unfamiliar subsystem before changing it | No → `Explore` (medium/very thorough), get a summary with `file:line` refs |
| Design a multi-file change | Consider a `Plan` agent; small changes: plan inline |
| Batch-edit many files mechanically | `general-purpose` agent (give exact pattern + acceptance check) |
| One targeted Grep/Read/Edit | Yes — delegating a single lookup is slower than doing it |

Practical threshold: if the job needs reading **more than ~3 files you can't name in advance**, delegate.

## Rule 2 — Every delegation is a three-part packet
1. **Goal & motivation** — what and why, one paragraph.
2. **Acceptance criteria** — how the agent knows it's done (explicit, checkable).
3. **Report format** — exactly what to return.
Templates: `docs/ai-ops/03-delegation-prompts.md`.

## Rule 3 — Model & effort selection (only names that exist here)
- `haiku` — mechanical, zero-judgment: apply a given diff pattern, count/list things, format.
- `sonnet` — default worker: searches, summaries, well-specified implementation.
- `opus` — judgment-heavy: root-cause debugging, cross-system design, prompt-engineering for the GM, anything touching `app/api/gm/respond/route.ts` control flow.
- `fable` — treat as strongest available; reserve for tasks where opus-level attempts failed or the design space is genuinely hard.
- Omit `model:` to inherit the session model — correct default when unsure.

## Rule 4 — Subagent reporting contract (include it in every prompt)
- Report **conclusions first**, then evidence as `path:line` references.
- Never paste whole files back; quote ≤10 lines per finding.
- If output must be long (a report, a generated doc), **write it to a file** (scratchpad or `docs/`) and return the path plus a 5-line summary.
- State explicitly what was NOT checked, so coverage gaps are visible.

## Rule 5 — Upgrade / downgrade paths
- Small model fails once on a **judgment** task → don't retry small; upgrade immediately (haiku→sonnet→opus).
- Mid model fails the **same subtask twice** → escalate one tier and include the full failure trace (what was tried, what happened) in the new prompt.
- Pattern solved by a strong model → apply it in batch with a cheaper model (give the solved example as the spec).
- **Max two retry rounds** of the same approach at any tier. Third attempt must change approach (different decomposition, more context, ask user) — see 02-judgment-rubric §4.

## Rule 6 — Verification must not self-verify
The author of a change is the worst judge of it. In this environment:
- **Files/docs**: read back from disk after writing (not from memory of what you wrote).
- **Pure logic** (`lib/game/*`, `lib/ai/*` helpers): scratchpad `node` script mirroring the function; assert the exact scenarios in question; show a PASS/FAIL table. This caught real bugs this session (regex boundaries, ambiguity guards, damage ranges).
- **Type safety**: `npx tsc --noEmit` — mandatory, every commit.
- **Cross-cutting or risky change**: spawn a fresh-context `general-purpose` reviewer with the diff (`git diff HEAD~1`) and the acceptance criteria; instruct it to try to REFUTE the change, not praise it.
- **Runtime behavior**: cannot be verified here (no running DB/AI keys assumed) — hand the user a concrete playtest script: exact input to type, exact log line/UI change to expect.
- Never claim "verified" for anything you did not actually run.
