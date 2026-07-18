-- Mythos Skills v1 — 克蘇魯神話法術 (docs/design/mythos-skills-v1.md)
-- RUN MANUALLY in the Supabase SQL editor.
--
-- 克蘇魯知識: new single card stat. Fixed 0 at creation, never point-buyable;
-- grows ONLY from official-story ending rewards (scenarios.mythos_reward),
-- granted server-side in the growth route on first clear. Dies with the card.
-- mythos_skills: spell keys bound (銘刻) to the card — irreversible, and a
-- namespace deliberately separate from `skills` so growth/interlude never see
-- them.

alter table character_cards
  add column if not exists cthulhu_knowledge integer not null default 0,
  add column if not exists mythos_skills text[] not null default '{}';

-- In-room characters mirror the card at select-card time (like hp/mp/skills).
alter table characters
  add column if not exists cthulhu_knowledge integer not null default 0,
  add column if not exists mythos_skills text[] not null default '{}';

-- Author-only ending reward: e.g. {"knowledge": 10}. NULL = story grants none.
alter table scenarios
  add column if not exists mythos_reward jsonb;
