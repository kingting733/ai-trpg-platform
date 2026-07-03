# CLAUDE.md — ai-trpg-platform

Multiplayer AI-GM TRPG (Call of Cthulhu-style, zh-TW UI). Next.js 14 app router + Supabase (Postgres/RLS) + AI GM via DeepSeek/OpenAI/Anthropic-compatible APIs. Deployed on Vercel.

## The one architectural law
**Server decides; GM narrates.** All mechanical state (HP, dice, location, hostility, evidence, objectives, endings) is decided by pure code in `lib/game/*` and `app/api/gm/respond/route.ts`. The AI GM only narrates outcomes and may *propose* intent via validated JSON fields (`injury`, `items`, `move_to`, `npc_calmed`). Never let narration or client-side keyword scanning become an authority. Details: `docs/ai-ops/00-diagnosis.md` (P2).

## Before you code — 3 checks that prevent most wasted work
1. **"Sometimes works / does nothing" bug?** → Check Vercel logs (`[objectives:check]` etc.) and query the DB row FIRST. Silent-failure playbook: `docs/ai-ops/00-diagnosis.md` (P1).
2. **New DB column?** → Add a `supabase/migrations/*.sql` file AND tell the user to run it in the Supabase SQL editor. Migrations are never auto-applied.
3. **Changing matching/combat/objectives logic?** → No test suite exists. Verify pure functions with a scratchpad `node` script before commit (P3).

## Non-negotiables (every change)
- `npx tsc --noEmit` clean before every commit.
- Commit style: `fix:`/`feat:`/`tweak:`/`ui:`/`style:`/`observability:`/`docs:` prefix (this list is authoritative) + body explaining the root cause. Push with `git push -u origin <branch>` where branch = the one the session started on (`git branch --show-current`). Never push to `main` or switch branches without explicit user instruction.
- Player-facing text is zh-TW. Never leak GM-internal info to players: 證物 render as neutral `📦 物品`, no clue counts, no objective checklists in player UI.
- Fuzzy matching must be conservative: prefer declining over guessing; use ambiguity guards (see `resolveFuzzyNpcTarget`, `detectTravelTarget`).
- Any `catch {}` / empty-string fallback in an AI call path must log its cause (copy `callAI` in `lib/ai/objectives.ts`).
- UI theme tokens: gold `#c9a96e`, surfaces in `tailwind.config.ts` — match existing panels; don't invent colors.

## Map (where things live)
| Area | Files |
|---|---|
| Per-turn game engine (BIG, ~1400 lines — search, don't read whole) | `app/api/gm/respond/route.ts` |
| GM prompt + JSON contract | `lib/ai/gm.ts` |
| Dice/combat/fuzzy NPC targeting | `lib/game/resolution.ts` |
| Locations, travel, evidence | `lib/game/locations.ts` |
| Objectives (defs + AI judge) | `lib/game/objectives-def.ts`, `lib/ai/objectives.ts` |
| Endings (sole game-ending authority) | `lib/game/endings.ts` |
| NPC identity / combat stance | `lib/game/npc.ts`, `lib/game/npc-combat.ts` |
| Inventory (soft, party-wide) | `lib/game/inventory.ts` |
| Player room UI (GmText effects, panels) | `app/rooms/[id]/page.tsx` |
| Scenario editors | `app/scenarios/new/page.tsx`, `app/scenarios/[id]/edit/page.tsx`, `components/*Editor*.tsx` |
| DB migrations (run manually!) | `supabase/migrations/` |

## AI-ops docs (read when relevant, not all upfront)
- `docs/ai-ops/00-diagnosis.md` — top 3 failure patterns + playbooks (**read first when debugging**)
- `docs/ai-ops/01-model-routing.md` — when/how to delegate to subagents; verification rules
- `docs/ai-ops/02-judgment-rubric.md` — decision checklists (upgrade, stop, ask user, done-ness)
- `docs/ai-ops/03-delegation-prompts.md` — copy-paste subagent prompt templates
- `docs/ai-ops/04-maintenance-protocol.md` — how to update these docs + lessons log format
- `docs/ai-ops/05-letter-to-future-sessions.md` — context, decay risks, harness limits
- `docs/ai-ops/06-lessons.md` — append-only log of solved bugs and the rules they taught
