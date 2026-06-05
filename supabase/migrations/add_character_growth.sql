-- === Character Growth System ===
-- After a story completes, players may roll an experience check on a skill they
-- successfully used, permanently improving the SOURCE card (CoC-style).

-- 1. Link the in-room character snapshot back to the persistent card it came
--    from, so growth applies to the right card. NULL for legacy rows.
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS source_card_id UUID REFERENCES public.character_cards(id) ON DELETE SET NULL;

-- 2. Record each growth claim — enforces "one growth per card per story" and
--    serves as a permanent growth history.
CREATE TABLE IF NOT EXISTS public.card_growth (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id     UUID NOT NULL REFERENCES public.character_cards(id) ON DELETE CASCADE,
  room_id     UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  skill_key   TEXT NOT NULL,
  d100_roll   INTEGER NOT NULL,
  old_value   INTEGER NOT NULL,
  gain        INTEGER NOT NULL,         -- 0 if the check failed (roll <= old_value)
  new_value   INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A card may only claim growth ONCE per room.
  UNIQUE (card_id, room_id)
);

ALTER TABLE public.card_growth ENABLE ROW LEVEL SECURITY;

-- Owners can read their own growth history.
CREATE POLICY "card_growth_select_own" ON public.card_growth
  FOR SELECT USING (user_id = auth.uid());

-- Inserts go through the server (service role / authenticated owner). Players
-- may only insert rows for their own cards; the d100 roll & values are computed
-- server-side in the API route, never trusted from the client.
CREATE POLICY "card_growth_insert_own" ON public.card_growth
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_card_growth_card ON public.card_growth(card_id);
CREATE INDEX IF NOT EXISTS idx_card_growth_room ON public.card_growth(room_id);
