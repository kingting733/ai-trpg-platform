-- === 關鍵地點 media reveal ===
-- Lets a scenario creator attach an image and/or a hidden text reveal to each
-- key location. When a player SUCCEEDS a search check on that location during
-- play, the reveal is pushed into the room's story log as a special entry.
--
-- The location media itself (reveal_image / reveal_text) lives inside the
-- existing scenarios.locations JSON — no schema change needed for that.
-- Images reuse the existing public `scenario-covers` storage bucket.
--
-- Run in the Supabase SQL Editor. Safe to run on an existing database.

-- 1) Allow a new story-log entry type that carries a revealed image.
ALTER TABLE public.story_logs
  ADD COLUMN IF NOT EXISTS media_url TEXT;

ALTER TABLE public.story_logs
  DROP CONSTRAINT IF EXISTS story_logs_entry_type_check;
ALTER TABLE public.story_logs
  ADD CONSTRAINT story_logs_entry_type_check
  CHECK (entry_type IN ('system', 'action', 'gm_response', 'location_media'));

-- 2) Track which locations have already revealed their media in each room, so a
--    given location's media is pushed at most once (no spam on repeat searches).
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS revealed_locations TEXT[] NOT NULL DEFAULT '{}';
