-- === In-game OOC chat ===
-- A lightweight out-of-character chat room for the players in a game room.
-- Messages are NEVER seen by the AI GM (separate from story_logs) — this is
-- pure table-talk between players. Delivered live via Supabase Realtime.
--
-- Run in the Supabase SQL Editor. Safe to run on an existing database.

CREATE TABLE IF NOT EXISTS public.room_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,          -- display-name snapshot at send time
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;

-- Follows the same loose auth pattern used by story_logs in this project.
DROP POLICY IF EXISTS "Authenticated can view room messages" ON public.room_messages;
CREATE POLICY "Authenticated can view room messages" ON public.room_messages
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- A user may only post AS themselves.
DROP POLICY IF EXISTS "Authenticated can insert own room messages" ON public.room_messages;
CREATE POLICY "Authenticated can insert own room messages" ON public.room_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_room_messages_room ON public.room_messages(room_id, created_at);

-- Enable Realtime delivery for this table (idempotent — ignore if already added).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.room_messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;  -- publication missing (non-Supabase) — skip
END $$;
