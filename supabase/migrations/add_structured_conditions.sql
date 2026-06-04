-- Split the single free-form ending_conditions box into structured, behavior-
-- mapped fields so creators no longer hand-type scope wording.
--   each_player_targets : objectives EVERY surviving player must complete (forced each_player scope)
--   failure_conditions  : events that auto-trigger a failure ending
-- ending_conditions is kept as a silent legacy fallback for old scenarios.
ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS each_player_targets TEXT,
  ADD COLUMN IF NOT EXISTS failure_conditions TEXT;
