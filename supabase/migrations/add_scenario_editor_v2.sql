-- Migration: Creator Scenario Editor 2.0
-- Run in the Supabase SQL Editor. Safe to run on an existing database.

-- Player-facing fields
ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'Normal',
  ADD COLUMN IF NOT EXISTS estimated_play_time INT,
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]';

-- Enforce valid difficulty values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scenarios_difficulty_check'
  ) THEN
    ALTER TABLE public.scenarios
      ADD CONSTRAINT scenarios_difficulty_check
        CHECK (difficulty IN ('Story', 'Normal', 'Hard', 'Nightmare'));
  END IF;
END$$;

-- GM-only fields (never exposed to players via browse/detail pages)
ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS opening_scene TEXT,
  ADD COLUMN IF NOT EXISTS secret_rules TEXT,
  ADD COLUMN IF NOT EXISTS locations JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS npcs JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS threats JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS traps JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS key_items JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS ending_conditions TEXT,
  ADD COLUMN IF NOT EXISTS gm_notes TEXT;
