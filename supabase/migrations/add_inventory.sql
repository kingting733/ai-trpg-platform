-- Migration: Party-wide soft inventory
-- Run in the Supabase SQL Editor. Safe to run on an existing database.
--
-- Tracks the items the party currently holds so the AI GM stops forgetting
-- earned items or letting players conjure items they never picked up. This is a
-- SOFT, context-only layer: it is NEVER read by unlock/ending condition logic —
-- only the 證物 (evidence) system gates progression. An inventory item that is
-- also a 證物 carries that evidence id, so the two never become rival sources of
-- truth.
ALTER TABLE public.rooms
  -- Shape: [{ "name": "鐵撬", "note": "在地下室找到", "evidence_id": null, "round": 4 }]
  ADD COLUMN IF NOT EXISTS inventory JSONB NOT NULL DEFAULT '[]'::jsonb;
