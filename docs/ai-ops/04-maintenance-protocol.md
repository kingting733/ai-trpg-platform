# 04 — Maintenance protocol for the ai-ops docs

## Who may change what
| File | Autonomous update allowed? |
|---|---|
| `06-lessons.md` | **Yes — append-only.** This is the default place to write. |
| `00-diagnosis.md` | Append a new pattern only if it recurred ≥2 sessions; never delete P1–P3 without user approval. |
| `01-model-routing.md` | Update the "what this environment provides" inventory when you *observe* a change (tool gone/new). Rule changes → ask user. |
| `02-judgment-rubric.md`, `03-delegation-prompts.md` | Fix factual rot (paths, names) autonomously; add/remove rules or templates → ask user. |
| `CLAUDE.md` | Fix broken paths autonomously. Anything that adds length → ask user first. Hard cap: ~80 lines; it is a router, not a manual. |
| `05-letter-to-future-sessions.md` | Do not edit history; append a dated postscript if something major changed. |

## After every solved non-trivial bug: write a lesson
Trigger: the fix taught something a future session could reuse (wrong assumption, silent failure, architecture rule). Routine typo fixes don't qualify.

Append to `docs/ai-ops/06-lessons.md` in exactly this format:
```
### YYYY-MM-DD — [one-line title]
- Context: [what was being done]
- Symptom: [what the user saw]
- Root cause: [the actual mechanism]
- Fix: [what changed, commit hash if known]
- Rule: [the reusable one-sentence rule]
- File updated: [which ai-ops doc absorbed the rule, or "lessons only"]
```

## Compression schedule
- When `06-lessons.md` exceeds ~40 lessons or ~600 lines: group by theme, promote recurring rules into 00/02 (one line each), collapse superseded lessons into a "compressed history" section keeping only date+title+rule. Ask the user before deleting anything outright.

## Keeping CLAUDE.md clean (anti-dumping-ground rules)
- New knowledge goes to `06-lessons.md` or the topical doc — never directly into CLAUDE.md.
- CLAUDE.md gains a line only when a rule has proven repeatedly load-bearing (≥2 sessions) AND is short enough to be one bullet with a pointer.
- One-in-one-out: if you add a bullet, look for one that's now redundant.

## Backups before major edits
- Before rewriting (not appending to) any file in this folder or CLAUDE.md: `cp <file> <file>.bak-YYYYMMDD` in the same directory, commit the backup together with the change, and mention it in the commit body. Git history exists, but the .bak makes the previous version visible to sessions that don't dig through history.
- Delete `.bak-*` files older than the last two backups of the same file when you notice them.

## Staleness check (cheap, do it when a doc misleads you)
If any ai-ops doc gave you wrong information: fix the doc in the same session as the discovery, and log a lesson. A misleading ops doc is worse than none.

## Persistence check (session end)
These docs only persist if committed and pushed. Before ending any session that touched them: `git ls-files docs/ai-ops CLAUDE.md` must list every file you changed; if not, commit and push.
