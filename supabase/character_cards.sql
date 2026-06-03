-- ============================================================
-- CHARACTER CARDS — collectible cards with dice-generated stats
-- Run this in the Supabase SQL Editor.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.character_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hp INTEGER NOT NULL,
  san INTEGER NOT NULL,
  str INTEGER NOT NULL,
  agi INTEGER NOT NULL,
  int INTEGER NOT NULL,
  cha INTEGER NOT NULL,
  luck INTEGER NOT NULL,
  speed INTEGER NOT NULL,
  total_stats INTEGER NOT NULL,
  rarity TEXT NOT NULL CHECK (rarity IN ('Common', 'Rare', 'Epic', 'Legendary')),
  roll_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.character_cards ENABLE ROW LEVEL SECURITY;

-- Database-level daily limit: at most one card per user per UTC day.
-- (created_at AT TIME ZONE 'UTC')::date is immutable, so it can be indexed.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_character_card_per_user_per_utc_day
  ON public.character_cards (user_id, ((created_at AT TIME ZONE 'UTC')::date));

CREATE INDEX IF NOT EXISTS idx_character_cards_user ON public.character_cards(user_id);

-- RLS: players may only ever see and create their OWN cards.
CREATE POLICY "Users can view their own character cards" ON public.character_cards
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own character cards" ON public.character_cards
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- UPDATE allowed for name only (enforced by the /api/characters/[id]/rename route
-- which explicitly only writes the name field).
CREATE POLICY "Users can rename their own character cards" ON public.character_cards
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- No DELETE policy  -> cards cannot be deleted in the MVP.
