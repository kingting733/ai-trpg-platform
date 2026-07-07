-- Migration: player-facing "who is in the scene" list
-- Run in the Supabase SQL Editor. Safe to run on an existing database.
--
-- Each turn the server computes which NPCs are present (placement NPCs at the
-- current location + any alive NPC tracked in npc_states) and stores them here
-- so the player UI can show a 在場人物 panel. Read-only for the client.
ALTER TABLE public.rooms
  -- Shape: [{ "name": "阿澤", "stance": "hostile" | "friendly" | "neutral" }]
  ADD COLUMN IF NOT EXISTS present_npcs JSONB NOT NULL DEFAULT '[]'::jsonb;
