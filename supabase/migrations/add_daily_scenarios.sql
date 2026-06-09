-- === Daily AI Scenario system ===
-- A scheduled job generates ONE scenario per day. It is NOT auto-published —
-- it lands as a `draft` owned by a dedicated system user and waits for an admin
-- to review (in the normal 建立劇本 editor) and approve it. Approval just flips
-- status to 'published'. The generated row uses the exact same columns as a
-- hand-made scenario, so the editor / GM engine / room flow all work unchanged.
--
-- Run in the Supabase SQL editor. Safe to re-run.

-- 1. Flag + date stamp on scenarios -------------------------------------------
ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS is_daily   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_date DATE;

-- At most ONE daily scenario per calendar day (idempotency safety net so a
-- double-fired cron can't create duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_daily_date
  ON public.scenarios(daily_date) WHERE is_daily;

CREATE INDEX IF NOT EXISTS idx_scenarios_is_daily ON public.scenarios(is_daily);

-- 2. System user that owns generated daily scenarios --------------------------
-- Fixed UUID so the cron can always reference it. role 'creator' satisfies the
-- users.role CHECK constraint. It has no auth.users login (never signs in); the
-- cron writes on its behalf via the service-role key (bypasses RLS).
INSERT INTO public.users (id, email, username, role)
VALUES (
  '00000000-0000-0000-0000-00000000da11',
  'daily-oracle@system.local',
  '每日神諭',
  'creator'
)
ON CONFLICT (id) DO NOTHING;

-- 3. Seed-configuration singleton ---------------------------------------------
-- One editable row driving how the generator is prompted. Admins tune the pools
-- and can drop in a one-off "today_idea" (e.g. inspired by today's news), which
-- overrides the rotation for the next generation and is then auto-cleared.
CREATE TABLE IF NOT EXISTS public.daily_seed_config (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- enforce single row
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.daily_seed_config (id, config)
VALUES (
  1,
  '{
    "genre_rotation": ["Horror", "Mystery", "Fantasy", "Sci-Fi", "Cyberpunk", "Historical", "Other"],
    "tone_pool": ["懸疑驚悚", "冷硬偵探", "詭譎超自然", "黑色幽默", "史詩悲劇", "荒誕怪奇"],
    "setting_pool": ["雪封山中小鎮", "廢棄精神病院", "濱海漁村", "山中古剎", "軌道太空站", "霓虹貧民窟", "百年大宅", "末班地鐵"],
    "hook_pool": ["一名訪客離奇失蹤", "一封沒有署名的信", "一具查不出死因的屍體", "一場無法解釋的停電", "一個反覆出現的夢", "一件被詛咒的古董"],
    "min_players": 2,
    "max_players": 4,
    "play_time_min": 60,
    "play_time_max": 120,
    "today_idea": ""
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.daily_seed_config ENABLE ROW LEVEL SECURITY;

-- Only admins may read/write the seed config from the browser. (The cron uses
-- the service-role key, which bypasses RLS entirely.)
DROP POLICY IF EXISTS "Admins can view daily seed config" ON public.daily_seed_config;
CREATE POLICY "Admins can view daily seed config" ON public.daily_seed_config
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

DROP POLICY IF EXISTS "Admins can update daily seed config" ON public.daily_seed_config;
CREATE POLICY "Admins can update daily seed config" ON public.daily_seed_config
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );
