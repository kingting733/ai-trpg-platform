-- Migration: Preserve playable context from imported modules
-- Run in the Supabase SQL Editor. Safe to run on an existing database.
--
-- Problem this solves: the scenario importer flattened a full TRPG module into
-- one-line summaries, so the AI GM lost the scene-by-scene flow and the
-- investigation clue chains needed to actually run the adventure. There was no
-- column to hold either of these, so they were discarded entirely.
--
-- Fix: add two GM-only fields.
--   scene_flow — the adventure's act/scene progression, transitions, and the
--                trigger/branch logic that drives the story forward (the spine
--                the GM follows). Free text.
--   clues      — discoverable information: what each clue is, where/how it is
--                found, and what it reveals or unlocks. JSONB array of strings.

ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS scene_flow TEXT,
  ADD COLUMN IF NOT EXISTS clues JSONB NOT NULL DEFAULT '[]'::jsonb;
