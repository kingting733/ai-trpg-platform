-- Migration: Deterministic Objective Progress Tracker
-- Run in the Supabase SQL Editor. Safe to run on an existing database.
--
-- Problem this solves: ending detection previously relied on the AI re-reading
-- recent story logs every turn and "remembering" cumulative multi-player
-- progress. The AI forgets earlier moves, so endings never fired reliably.
--
-- Fix: store objective completion as STRUCTURED, PERMANENT FLAGS on the room.
-- Each objective is checked independently per turn; once completed it stays
-- completed forever. The ending is decided by deterministic code (all required
-- objectives done), not by AI memory.

ALTER TABLE public.rooms
  -- The decomposed ending-condition checklist for THIS room.
  -- Shape: [{ "id": "obj_1", "text": "...", "required": true }]
  ADD COLUMN IF NOT EXISTS objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Permanent per-objective completion flags.
  -- Shape: { "obj_1": { "done": true, "round": 3, "character": "Kara" } }
  ADD COLUMN IF NOT EXISTS objective_progress JSONB NOT NULL DEFAULT '{}'::jsonb;
