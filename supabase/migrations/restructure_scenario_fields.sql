-- Add failure_turn_limit: if set, game auto-fails when current_round reaches this value
ALTER TABLE public.scenarios ADD COLUMN IF NOT EXISTS failure_turn_limit INTEGER DEFAULT NULL;
-- locations and npcs columns are already JSONB (from add_scenario_editor_v2.sql)
-- Their stored shape is changing from string[] to object[] — handled in application code
