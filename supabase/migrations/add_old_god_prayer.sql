-- === 舊神祈願 / Old God Prayer — meta item system ===
-- Players burn 調查點 (users.points) to pray; they receive a PERMANENT item
-- they don't yet own (no duplicates, no pity, no fragments — by design). Items
-- equip to ONE character card (one slot each) and only affect interlude
-- mission numbers. Item definitions live in code (lib/game/items.ts); the DB
-- stores ownership + equipment only.
--
-- RUN THIS MANUALLY in the Supabase SQL editor.

-- 1. Ownership — one row per (user, item); the unique constraint makes
--    duplicates structurally impossible.
CREATE TABLE IF NOT EXISTS public.user_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL,
  obtained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_items_user ON public.user_items(user_id);

ALTER TABLE public.user_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_items_select_own" ON public.user_items
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "user_items_insert_own" ON public.user_items
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- 2. Equipment — one slot per card; an item may be equipped to at most one of
--    the user's cards at a time (enforced by the equip route).
ALTER TABLE public.character_cards
  ADD COLUMN IF NOT EXISTS equipped_item TEXT;

-- 3. Snapshot the equipped item onto the mission at DISPATCH, so re-equipping
--    mid-mission can never change an in-flight mission's outcome.
ALTER TABLE public.card_missions
  ADD COLUMN IF NOT EXISTS equipped_item TEXT;
