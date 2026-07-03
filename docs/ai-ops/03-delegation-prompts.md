# 03 — Delegation prompt templates (copy, fill placeholders, send)

All templates obey the reporting contract (01 §4): conclusions first, `path:line` evidence, ≤10 quoted lines per finding, long output to a file, state what was NOT checked. Agent types/models: see 01 §"What this environment provides".

---

## 1. Search / repo scan — agent: `Explore`
```
Search breadth: [quick | medium | very thorough]
GOAL: Find [what] in this repo so I can [why].
Look for: [symbols/patterns/behaviors, e.g. "every caller of matchEvidence", "where npc_states is written"].
ACCEPTANCE: every match found (say which naming variants you tried); each reported as path:line + 1-line role description.
REPORT: bullet list "path:line — role"; then 3-line synthesis; then "NOT checked: [dirs/patterns]".
Do not paste file bodies.
```

## 2. Implementation — agent: `general-purpose`
```
GOAL: Implement [feature] because [motivation]. 
CONTEXT: Read CLAUDE.md first. Relevant files: [paths]. Follow the pattern in [existing similar file:line].
CONSTRAINTS: server-decides/GM-narrates law; player-facing text zh-TW; no new DB column without a supabase/migrations/*.sql file; conservative fuzzy matching (decline over guess).
ACCEPTANCE: (1) npx tsc --noEmit clean; (2) [specific behavior], e.g. "input X produces log line Y"; (3) pure logic verified by a scratchpad node script with a PASS/FAIL table; (4) no other caller of changed functions broken (grep and list them).
REPORT: files changed as path:line ranges; the PASS/FAIL table; any migration added; limitations; do NOT commit — return for review.
```

## 3. Refactor — agent: `general-purpose` (model: sonnet; opus if control flow changes)
```
GOAL: Refactor [what] to [shape] WITHOUT behavior change.
SCOPE: only [paths]. Out of scope: [paths].
ACCEPTANCE: tsc clean; grep proves no remaining references to the old form; public signatures unchanged (or every caller updated — list them); a scratchpad script shows identical outputs on [3+ concrete inputs] before/after.
REPORT: mapping old→new; caller list path:line; the before/after output table; anything you chose NOT to touch and why.
```

## 4. Research (external) — agent: `general-purpose`
```
GOAL: Answer [question] with sources, so I can [decision it feeds].
METHOD: check official docs/package source first; WebSearch/WebFetch if needed (load via ToolSearch).
ACCEPTANCE: every claim has a source (URL or node_modules path); uncertain points marked "UNVERIFIED"; contradictions between sources surfaced, not smoothed over.
REPORT: direct answer in ≤5 lines; then claims-with-sources; then "what I could not verify". If >40 lines, write to [scratchpad path]/research-[topic].md and return the path + summary.
```

## 5. Review / audit — agent: `general-purpose`, fresh context (model: opus for risky diffs)
```
GOAL: Adversarially review [diff / files] for defects. Try to REFUTE it, do not summarize it.
INPUT: run `git diff [range]`. Acceptance criteria of the original change: [paste].
CHECK: (1) broken callers of changed signatures; (2) violations of server-authority law (narration/keywords becoming authority); (3) silent failure paths added (catch{} or ??"" without logging); (4) player-visible leaks (證物 wording, clue counts, GM-internal info); (5) zh-TW wording in player-facing strings; (6) missing migration for new columns.
ACCEPTANCE: all 6 CHECK items executed, each explicitly marked finding/clean/not-checked.
REPORT: findings ranked by severity, each: path:line, defect, concrete failure scenario, suggested fix. End with "checked / not checked" lists. Zero findings is an acceptable answer — do not invent nitpicks.
```

## 6. Test / verification — agent: `general-purpose` (model: haiku/sonnet)
```
GOAL: Verify [function/behavior] against these cases.
METHOD: write a node script in the scratchpad that mirrors or imports the logic from [path]; run it.
CASES: [input → expected, one per line — include the edge cases the change was about].
ACCEPTANCE: every case runs; output is a PASS/FAIL table; any FAIL includes actual vs expected.
REPORT: the table + script path. If a case fails, STOP and report — do not fix.
```

## 7. Debugging a failing behavior — agent: `general-purpose` (model: opus)
```
GOAL: Find the root cause of: [exact user-visible symptom]. Do NOT fix yet.
EVIDENCE: [logs / repro input / DB row contents].
METHOD: follow docs/ai-ops/00-diagnosis.md — P1 first (logs, DB state, silent paths), then P2 (state vs narration desync), then logic. Trace the actual code path with path:line stops.
ACCEPTANCE: a causal chain "input → code path → wrong output" where each link cites code; a disproof of at least one plausible alternative cause; the minimal fix location identified.
REPORT: root cause (≤5 lines); the chain; alternatives ruled out; proposed fix + blast radius; confidence (high/medium/low) and what evidence would raise it.
```

## 8. Documentation update — agent: `general-purpose` (model: sonnet)
```
GOAL: Update [doc path] to reflect [change/lesson].
RULES: follow docs/ai-ops/04-maintenance-protocol.md (backups, which files need user approval, lesson format).
ACCEPTANCE: doc still ≤ its current length + 20% (compress if over); no contradiction with CLAUDE.md or 00–05 (grep key terms); paths/commands in the doc actually exist (verify each).
REPORT: diff summary; the compression you applied; any contradiction found and how resolved.
```
