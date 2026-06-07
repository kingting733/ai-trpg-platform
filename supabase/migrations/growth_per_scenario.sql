-- === Growth: lock per SCENARIO (not per room) + mark cleared scenarios on card ===

-- 1. Record which scenario each growth claim belongs to, then enforce
--    "one growth per card per SCENARIO" so replaying the same story in a new
--    room can no longer grant a second growth.
ALTER TABLE public.card_growth
  ADD COLUMN IF NOT EXISTS scenario_id UUID REFERENCES public.scenarios(id) ON DELETE CASCADE;

-- Backfill scenario_id from the room each existing claim came from.
UPDATE public.card_growth cg
  SET scenario_id = r.scenario_id
  FROM public.rooms r
  WHERE cg.room_id = r.id AND cg.scenario_id IS NULL;

-- Replace the old per-room uniqueness with per-scenario uniqueness.
ALTER TABLE public.card_growth DROP CONSTRAINT IF EXISTS card_growth_card_id_room_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS card_growth_card_scenario_uniq
  ON public.card_growth(card_id, scenario_id);

CREATE INDEX IF NOT EXISTS idx_card_growth_scenario ON public.card_growth(scenario_id);

-- 2. Mark on the card itself which scenarios it has cleared (passed with a
--    good/normal ending). Array of scenario UUIDs.
ALTER TABLE public.character_cards
  ADD COLUMN IF NOT EXISTS cleared_scenarios UUID[] NOT NULL DEFAULT '{}';
