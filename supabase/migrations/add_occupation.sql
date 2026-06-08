-- Migration: Occupation system
--
-- Each newly rolled character card is assigned ONE random occupation that grants
-- two +10 starting-skill buffs (baked into character_cards.skills at creation).
--
--   character_cards.occupation        text    — display name of the occupation
--   character_cards.skills_allocated  boolean — true once the player has spent
--                                               skill points (replaces the old
--                                               "skills is non-empty" guard, which
--                                               no longer works now that skills is
--                                               pre-seeded with occupation buffs)
--   characters.occupation             text    — copied from the card at select time
--
-- RUN ONCE against your Supabase project. Safe to re-run (IF NOT EXISTS).

ALTER TABLE public.character_cards
  ADD COLUMN IF NOT EXISTS occupation       TEXT,
  ADD COLUMN IF NOT EXISTS skills_allocated BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing cards that already had skills allocated keep their lock.
UPDATE public.character_cards
  SET skills_allocated = TRUE
  WHERE skills IS NOT NULL
    AND skills::text <> '{}'
    AND skills_allocated = FALSE;

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS occupation TEXT;
