-- Structured objective tracker.
--
-- Objectives move from two free-text boxes (winning_targets / each_player_targets,
-- whose ids were positional and shifted on reorder) to a structured list with
-- STABLE ids, so location-unlock and multi-ending conditions that reference
-- objective:<id> never break when goals are renamed or reordered.
--
-- Shape: jsonb array of { id, text, scope: "party"|"each_player", required }.
-- The legacy text columns are kept and mirrored on save for backward compat.
ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS objectives JSONB NOT NULL DEFAULT '[]'::jsonb;
