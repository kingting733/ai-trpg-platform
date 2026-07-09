-- === 幕間任務 / Interlude Missions ===
-- A character card can be dispatched on a 24h off-screen mission. While away it
-- cannot join a game room. On claim, the server rolls success (rate snapshotted
-- at dispatch from the card's skills): success → full points + one growth check
-- (+1 skill point, max 2 interlude growths per card per week); fail → 10% of
-- the points, no growth. No fatigue, no permanent loss. Design notes: the
-- growth result lives in card_missions.outcome (NOT card_growth, whose room_id
-- FK / per-scenario uniqueness are story-bound); the skill bump is applied to
-- character_cards.skills directly by the claim route.
--
-- RUN THIS MANUALLY in the Supabase SQL editor.

-- 1. Meta-currency wallet on the user.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 0;

-- 2. Missions.
CREATE TABLE IF NOT EXISTS public.card_missions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id           UUID NOT NULL REFERENCES public.character_cards(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  mission_type      TEXT NOT NULL,          -- key from lib/game/interlude.ts
  -- Snapshotted at dispatch (server-computed from the card's skills THEN, so
  -- later growth can't retroactively change an in-flight mission):
  success_rate      INTEGER NOT NULL,       -- 30..90 (%)
  points_on_success INTEGER NOT NULL,       -- full reward; fail pays ceil(10%)
  growth_skill      TEXT NOT NULL,          -- skill key the growth check rolls on
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimable_at      TIMESTAMPTZ NOT NULL,   -- server-set: started_at + 24h
  claimed_at        TIMESTAMPTZ,            -- NULL = active; set once on claim/cancel
  cancelled         BOOLEAN NOT NULL DEFAULT FALSE,
  -- Rolled ONCE by the claim route and stored (idempotent; no reroll by refresh):
  -- { roll, success, points, growth: { skill, d100, old, gain, new } | { capped: true } | null, narration }
  outcome           JSONB
);

-- One ACTIVE (unclaimed) mission per user — the concurrency cap.
CREATE UNIQUE INDEX IF NOT EXISTS card_missions_one_active_per_user
  ON public.card_missions(user_id) WHERE claimed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_card_missions_card ON public.card_missions(card_id);

ALTER TABLE public.card_missions ENABLE ROW LEVEL SECURITY;

-- Owners see their own missions. All writes go through the API routes (which
-- run as the authenticated owner), so owner-scoped write policies are enough;
-- every value is computed server-side and re-validated on claim.
CREATE POLICY "card_missions_select_own" ON public.card_missions
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "card_missions_insert_own" ON public.card_missions
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "card_missions_update_own" ON public.card_missions
  FOR UPDATE USING (user_id = auth.uid());

-- 3. HARD busy-card enforcement: a card on an active mission cannot enter a
--    room. Card→room selection inserts into public.characters directly from
--    the client, so the guarantee must live in the database, not a route.
CREATE OR REPLACE FUNCTION public.reject_busy_card()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source_card_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.card_missions m
    WHERE m.card_id = NEW.source_card_id AND m.claimed_at IS NULL
  ) THEN
    RAISE EXCEPTION '此調查員正在執行幕間任務，尚未歸來。';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_reject_busy_card ON public.characters;
CREATE TRIGGER trg_reject_busy_card
  BEFORE INSERT ON public.characters
  FOR EACH ROW EXECUTE FUNCTION public.reject_busy_card();
