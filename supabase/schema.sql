-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS (extends Supabase auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'creator', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all profiles" ON public.users
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- ============================================================
-- SCENARIOS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.scenarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  genre TEXT NOT NULL,
  background TEXT,
  objective TEXT,
  rules TEXT,
  max_players INTEGER NOT NULL DEFAULT 4 CHECK (max_players BETWEEN 2 AND 8),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published scenarios" ON public.scenarios
  FOR SELECT USING (status = 'published' OR creator_id = auth.uid());

CREATE POLICY "Creators can insert their own scenarios" ON public.scenarios
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Creators can update their own scenarios" ON public.scenarios
  FOR UPDATE USING (auth.uid() = creator_id);

CREATE POLICY "Creators can delete their own scenarios" ON public.scenarios
  FOR DELETE USING (auth.uid() = creator_id);

-- ============================================================
-- SCENARIO NPCs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.scenario_npcs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scenario_id UUID NOT NULL REFERENCES public.scenarios(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  role TEXT
);

ALTER TABLE public.scenario_npcs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "NPCs inherit scenario visibility" ON public.scenario_npcs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.scenarios s
      WHERE s.id = scenario_id AND (s.status = 'published' OR s.creator_id = auth.uid())
    )
  );

CREATE POLICY "Creators can manage their scenario NPCs" ON public.scenario_npcs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.scenarios s WHERE s.id = scenario_id AND s.creator_id = auth.uid())
  );

-- ============================================================
-- SCENARIO LOCATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.scenario_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scenario_id UUID NOT NULL REFERENCES public.scenarios(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT
);

ALTER TABLE public.scenario_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Locations inherit scenario visibility" ON public.scenario_locations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.scenarios s
      WHERE s.id = scenario_id AND (s.status = 'published' OR s.creator_id = auth.uid())
    )
  );

CREATE POLICY "Creators can manage their scenario locations" ON public.scenario_locations
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.scenarios s WHERE s.id = scenario_id AND s.creator_id = auth.uid())
  );

-- ============================================================
-- ROOMS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scenario_id UUID NOT NULL REFERENCES public.scenarios(id),
  host_id UUID NOT NULL REFERENCES public.users(id),
  name TEXT NOT NULL,
  room_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_progress', 'completed')),
  max_players INTEGER NOT NULL DEFAULT 4,
  current_round INTEGER NOT NULL DEFAULT 0,
  current_turn_player_id UUID REFERENCES public.users(id),
  current_choices JSONB DEFAULT '[]'::jsonb,
  current_choices_for_player_id UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view rooms" ON public.rooms
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create rooms" ON public.rooms
  FOR INSERT WITH CHECK (auth.uid() = host_id);

-- Any room participant (not just host) can update room state so that
-- turn advancement works when a non-host player acts first.
CREATE POLICY "Room participants can update room state" ON public.rooms
  FOR UPDATE USING (
    auth.uid() = host_id
    OR EXISTS (
      SELECT 1 FROM public.room_players rp
      WHERE rp.room_id = rooms.id
        AND rp.user_id = auth.uid()
    )
  );

-- ============================================================
-- ROOM PLAYERS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.room_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id),
  character_id UUID,
  turn_order INTEGER,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);

ALTER TABLE public.room_players ENABLE ROW LEVEL SECURITY;

-- Simple policy: any authenticated user can read room_players.
-- The self-referencing EXISTS check caused infinite recursion and 0-row results.
CREATE POLICY "Authenticated users can view room players" ON public.room_players
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can join rooms" ON public.room_players
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Players can update their own room player record" ON public.room_players
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================
-- CHARACTERS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.characters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  background TEXT,
  hp INTEGER NOT NULL DEFAULT 10 CHECK (hp >= 0),
  san INTEGER NOT NULL DEFAULT 10 CHECK (san >= 0),
  str INTEGER NOT NULL DEFAULT 5 CHECK (str >= 1),
  agi INTEGER NOT NULL DEFAULT 5 CHECK (agi >= 1),
  int INTEGER NOT NULL DEFAULT 5 CHECK (int >= 1),
  cha INTEGER NOT NULL DEFAULT 5 CHECK (cha >= 1),
  luck INTEGER NOT NULL DEFAULT 5 CHECK (luck >= 1),
  speed INTEGER NOT NULL DEFAULT 5 CHECK (speed >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, room_id)
);

ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players can view characters in their room" ON public.characters
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Players can create their own character" ON public.characters
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_id
      AND r.status IN ('waiting', 'in_progress')
    )
  );

CREATE POLICY "Players can update character only when room is waiting" ON public.characters
  FOR UPDATE USING (
    auth.uid() = user_id AND
    EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_id AND r.status = 'waiting')
  );

-- ============================================================
-- TURNS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.turns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  player_id UUID NOT NULL REFERENCES public.users(id),
  turn_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Room players can view turns" ON public.turns
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Host can insert turns" ON public.turns
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_id AND r.host_id = auth.uid())
  );

-- ============================================================
-- ACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  turn_id UUID NOT NULL REFERENCES public.turns(id),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.users(id),
  character_id UUID NOT NULL REFERENCES public.characters(id),
  action_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Room players can view actions" ON public.actions
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Players can only submit action on their turn" ON public.actions
  FOR INSERT WITH CHECK (
    auth.uid() = player_id AND
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_id AND r.current_turn_player_id = auth.uid() AND r.status = 'in_progress'
    )
  );

-- ============================================================
-- STORY LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.story_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('system', 'action', 'gm_response')),
  player_id UUID REFERENCES public.users(id),
  character_id UUID REFERENCES public.characters(id),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.story_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Room players can view story logs" ON public.story_logs
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Room players can insert story logs" ON public.story_logs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_scenarios_creator ON public.scenarios(creator_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_status ON public.scenarios(status);
CREATE INDEX IF NOT EXISTS idx_rooms_code ON public.rooms(room_code);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON public.rooms(status);
CREATE INDEX IF NOT EXISTS idx_room_players_room ON public.room_players(room_id);
CREATE INDEX IF NOT EXISTS idx_room_players_user ON public.room_players(user_id);
CREATE INDEX IF NOT EXISTS idx_characters_room ON public.characters(room_id);
CREATE INDEX IF NOT EXISTS idx_turns_room ON public.turns(room_id);
CREATE INDEX IF NOT EXISTS idx_actions_room ON public.actions(room_id);
CREATE INDEX IF NOT EXISTS idx_story_logs_room ON public.story_logs(room_id);

-- ============================================================
-- FUNCTION: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_scenarios_updated_at
  BEFORE UPDATE ON public.scenarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_rooms_updated_at
  BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Allow users (including anonymous) to insert their own profile
CREATE POLICY "Users can insert own profile" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- ============================================================
-- CHARACTER CARDS — collectible cards with dice-generated stats
-- (also available standalone in supabase/character_cards.sql)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.character_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hp INTEGER NOT NULL,
  san INTEGER NOT NULL,
  str INTEGER NOT NULL,
  agi INTEGER NOT NULL,
  int INTEGER NOT NULL,
  cha INTEGER NOT NULL,
  luck INTEGER NOT NULL,
  speed INTEGER NOT NULL,
  total_stats INTEGER NOT NULL,
  rarity TEXT NOT NULL CHECK (rarity IN ('Common', 'Rare', 'Epic', 'Legendary')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.character_cards ENABLE ROW LEVEL SECURITY;

-- Database-level daily limit: at most one card per user per UTC day.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_character_card_per_user_per_utc_day
  ON public.character_cards (user_id, ((created_at AT TIME ZONE 'UTC')::date));

CREATE INDEX IF NOT EXISTS idx_character_cards_user ON public.character_cards(user_id);

CREATE POLICY "Users can view their own character cards" ON public.character_cards
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own character cards" ON public.character_cards
  FOR INSERT WITH CHECK (auth.uid() = user_id);
-- UPDATE: name editing is allowed; the rename API route only touches the name field.
CREATE POLICY "Users can rename their own character cards" ON public.character_cards
  FOR UPDATE USING (auth.uid() = user_id);
-- No DELETE policy in MVP.

