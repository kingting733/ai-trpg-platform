-- Migration: dice-based action resolution.
-- Run in the Supabase SQL Editor. Safe to run on an existing database.

-- 1) Store the resolved dice result on each action's story log entry.
ALTER TABLE public.story_logs
  ADD COLUMN IF NOT EXISTS roll_result JSONB;

-- 2) Allow the acting player's own character HP/SAN to change during play so the
--    system can apply dice consequences. (Stats other than hp/san are written by
--    the server only; players still cannot pick their own stats after start.)
DROP POLICY IF EXISTS "Players can update own character during play" ON public.characters;
CREATE POLICY "Players can update own character during play" ON public.characters
  FOR UPDATE USING (
    auth.uid() = user_id AND
    EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_id AND r.status = 'in_progress')
  );
