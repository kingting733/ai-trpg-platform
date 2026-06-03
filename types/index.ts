export type UserRole = "player" | "creator" | "admin";

export interface User {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  created_at: string;
}

export interface Scenario {
  id: string;
  creator_id: string;
  title: string;
  description: string;
  genre: string;
  background: string | null;
  objective: string | null;
  rules: string | null;
  max_players: number;
  status: "draft" | "published" | "archived";
  created_at: string;
  updated_at: string;
}

export interface ScenarioNPC {
  id: string;
  scenario_id: string;
  name: string;
  description: string | null;
  role: string | null;
}

export interface ScenarioLocation {
  id: string;
  scenario_id: string;
  name: string;
  description: string | null;
}

export type RoomStatus = "waiting" | "in_progress" | "completed";

export interface Room {
  id: string;
  scenario_id: string;
  host_id: string;
  name: string;
  room_code: string;
  status: RoomStatus;
  max_players: number;
  current_round: number;
  current_turn_player_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomPlayer {
  id: string;
  room_id: string;
  user_id: string;
  character_id: string | null;
  turn_order: number | null;
  joined_at: string;
}

export interface Character {
  id: string;
  user_id: string;
  room_id: string;
  name: string;
  background: string | null;
  hp: number;
  san: number;
  str: number;
  agi: number;
  int: number;
  cha: number;
  luck: number;
  speed: number;
  created_at: string;
}

export interface Turn {
  id: string;
  room_id: string;
  round_number: number;
  player_id: string;
  turn_order: number;
  status: "pending" | "completed" | "skipped";
  created_at: string;
}

export interface Action {
  id: string;
  turn_id: string;
  room_id: string;
  player_id: string;
  character_id: string;
  action_text: string;
  created_at: string;
}

export interface StoryLog {
  id: string;
  room_id: string;
  round_number: number;
  entry_type: "system" | "action" | "gm_response";
  player_id: string | null;
  character_id: string | null;
  content: string;
  created_at: string;
}
