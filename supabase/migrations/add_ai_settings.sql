-- Runtime AI settings (lib/ai/settings.ts) — per-call-site "thinking"
-- (reasoning) switches, editable from /admin without a redeploy.
-- RUN MANUALLY in the Supabase SQL editor.
--
-- Until this runs, lib/ai/settings.ts falls back to DEFAULT_THINKING
-- (reasoning disabled everywhere), which is exactly the previous hard-coded
-- behaviour — so applying it is safe at any time, and NOT applying it breaks
-- nothing.

create table if not exists public.ai_settings (
  id         smallint primary key default 1,
  -- { "gm": false, "scene_choices": false, ... } — true = allow reasoning.
  -- Unknown keys are ignored and missing keys default to false, so adding a
  -- new call site in code needs no migration.
  thinking   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  -- Single-row table.
  constraint ai_settings_singleton check (id = 1)
);

insert into public.ai_settings (id, thinking)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- Server-only: every read goes through the service-role client and every write
-- through the admin API route (which checks users.role = 'admin'). No client
-- policies, so with RLS enabled the browser cannot read or write this table.
alter table public.ai_settings enable row level security;
