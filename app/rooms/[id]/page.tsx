"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Character {
  id: string;
  user_id: string;
  name: string;
  hp: number; san: number; str: number; agi: number;
  int: number; cha: number; luck: number; speed: number;
}

interface StoryLogEntry {
  id: string;
  entry_type: "system" | "action" | "gm_response";
  content: string;
  character_id: string | null;
  player_id: string | null;
  created_at: string;
  characters?: { name: string } | null;
}

interface Room {
  id: string;
  name: string;
  room_code: string;
  status: string;
  current_round: number;
  current_turn_player_id: string | null;
  host_id: string;
}

interface RoomPlayer {
  user_id: string;
  character_id: string | null;
  turn_order: number | null;
}

export default function RoomPlayPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [roomPlayers, setRoomPlayers] = useState<RoomPlayer[]>([]);
  const [storyLog, setStoryLog] = useState<StoryLogEntry[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [myCharacter, setMyCharacter] = useState<Character | null>(null);
  const [actionText, setActionText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/play"); return; }
    setCurrentUserId(user.id);

    const { data: roomData } = await supabase.from("rooms").select("*").eq("id", params.id).single();
    if (!roomData) { router.push("/play/hub"); return; }
    setRoom(roomData);

    const { data: rp } = await supabase.from("room_players").select("user_id, character_id, turn_order").eq("room_id", params.id);
    setRoomPlayers(rp ?? []);

    const { data: chars } = await supabase.from("characters").select("*").eq("room_id", params.id);
    const sortedChars = (chars ?? []).sort((a, b) => b.speed - a.speed);
    setCharacters(sortedChars);

    const myChar = (chars ?? []).find((c) => c.user_id === user.id);
    setMyCharacter(myChar ?? null);

    const { data: logs } = await supabase
      .from("story_logs")
      .select("*, characters(name)")
      .eq("room_id", params.id)
      .order("created_at", { ascending: true });
    setStoryLog((logs as unknown as StoryLogEntry[]) ?? []);
  }, [params.id, router]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 3000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [storyLog]);

  // Initialize turn order when room starts and all players have characters
  async function initializeTurns() {
    if (!room || initializing) return;
    setInitializing(true);
    const supabase = createClient();

    // Sort players by speed
    const sorted = [...characters].sort((a, b) => b.speed - a.speed);
    if (sorted.length === 0) { setInitializing(false); return; }

    // Update room_players with turn_order
    for (let i = 0; i < sorted.length; i++) {
      await supabase
        .from("room_players")
        .update({ turn_order: i + 1 })
        .eq("room_id", room.id)
        .eq("user_id", sorted[i].user_id);
    }

    // Set first player's turn and round 1
    const firstPlayer = sorted[0];
    await supabase
      .from("rooms")
      .update({ current_turn_player_id: firstPlayer.user_id, current_round: 1 })
      .eq("id", room.id);

    // Insert opening story log
    await supabase.from("story_logs").insert({
      room_id: room.id,
      round_number: 1,
      entry_type: "system",
      content: `The adventure begins! Turn order determined by SPEED: ${sorted.map((c) => c.name).join(" → ")}`,
    });

    await fetchAll();
    setInitializing(false);
  }

  async function submitAction() {
    if (!actionText.trim() || !room || !myCharacter || !currentUserId) return;
    setSubmitting(true);
    const supabase = createClient();

    // Get current turn info
    const sortedBySpeed = [...characters].sort((a, b) => b.speed - a.speed);
    const currentIndex = sortedBySpeed.findIndex((c) => c.user_id === room.current_turn_player_id);

    // Insert action into story log
    await supabase.from("story_logs").insert({
      room_id: room.id,
      round_number: room.current_round,
      entry_type: "action",
      player_id: currentUserId,
      character_id: myCharacter.id,
      content: actionText.trim(),
    });

    // Also save to actions table — first get/create a turn record
    const { data: turnData } = await supabase
      .from("turns")
      .select("id")
      .eq("room_id", room.id)
      .eq("round_number", room.current_round)
      .eq("player_id", currentUserId)
      .eq("status", "pending")
      .single();

    let turnId = turnData?.id;
    if (!turnId) {
      const { data: newTurn } = await supabase.from("turns").insert({
        room_id: room.id,
        round_number: room.current_round,
        player_id: currentUserId,
        turn_order: currentIndex + 1,
        status: "pending",
      }).select("id").single();
      turnId = newTurn?.id;
    }

    if (turnId) {
      await supabase.from("actions").insert({
        turn_id: turnId,
        room_id: room.id,
        player_id: currentUserId,
        character_id: myCharacter.id,
        action_text: actionText.trim(),
      });
      await supabase.from("turns").update({ status: "completed" }).eq("id", turnId);
    }

    // Call AI GM
    try {
      await fetch("/api/gm/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.id, actionText: actionText.trim() }),
      });
    } catch {
      // GM response failure is non-blocking
    }

    // Advance to next player
    const nextIndex = currentIndex + 1;
    if (nextIndex < sortedBySpeed.length) {
      // Next player in this round
      await supabase
        .from("rooms")
        .update({ current_turn_player_id: sortedBySpeed[nextIndex].user_id })
        .eq("id", room.id);
    } else {
      // New round
      const newRound = room.current_round + 1;
      await supabase
        .from("rooms")
        .update({ current_turn_player_id: sortedBySpeed[0].user_id, current_round: newRound })
        .eq("id", room.id);
      await supabase.from("story_logs").insert({
        room_id: room.id,
        round_number: newRound,
        entry_type: "system",
        content: `--- Round ${newRound} begins ---`,
      });
    }

    setActionText("");
    await fetchAll();
    setSubmitting(false);
  }

  if (!room) return <div className="text-center text-slate-400 py-20">Loading room...</div>;

  const isMyTurn = room.current_turn_player_id === currentUserId;
  const sortedBySpeed = [...characters].sort((a, b) => b.speed - a.speed);
  const currentTurnChar = sortedBySpeed.find((c) => c.user_id === room.current_turn_player_id);
  const allHaveChars = roomPlayers.length > 0 && roomPlayers.every((p) => p.character_id);
  const needsInit = room.status === "in_progress" && room.current_round === 0 && allHaveChars;

  return (
    <div className="grid grid-cols-[1fr_280px] gap-4 h-[calc(100vh-7rem)]">
      {/* Main area */}
      <div className="flex flex-col gap-3 min-h-0">
        {/* Header */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-400">Round <span className="text-white font-bold">{room.current_round || "—"}</span></span>
            <span className="text-slate-600">·</span>
            {currentTurnChar ? (
              <span className="text-slate-400">
                Turn: <span className={`font-bold ${isMyTurn ? "text-green-400" : "text-purple-400"}`}>
                  {isMyTurn ? "Your Turn!" : currentTurnChar.name}
                </span>
              </span>
            ) : (
              <span className="text-slate-500">Waiting to start...</span>
            )}
          </div>
          <span className="text-xs text-slate-500 font-mono">{room.room_code}</span>
        </div>

        {/* Story log */}
        <div className="flex-1 bg-slate-900/50 border border-slate-700 rounded-xl p-4 overflow-y-auto min-h-0 flex flex-col gap-3">
          {storyLog.length === 0 && (
            <p className="text-slate-500 text-sm italic text-center mt-8">
              {needsInit ? "Ready to start — click the button below!" : "Waiting for all players to create characters..."}
            </p>
          )}
          {storyLog.map((entry) => (
            <div key={entry.id}>
              {entry.entry_type === "system" && (
                <p className="text-slate-500 italic text-xs text-center">{entry.content}</p>
              )}
              {entry.entry_type === "action" && (
                <div className="flex gap-2">
                  <span className="text-purple-400 font-medium text-sm shrink-0">{entry.characters?.name ?? "Player"}:</span>
                  <span className="text-slate-300 text-sm">{entry.content}</span>
                </div>
              )}
              {entry.entry_type === "gm_response" && (
                <div className="bg-slate-800 border border-amber-900/50 rounded-lg p-3">
                  <span className="text-xs text-amber-500 font-medium uppercase tracking-wider block mb-1">GM</span>
                  <p className="text-slate-200 text-sm leading-relaxed">{entry.content}</p>
                </div>
              )}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>

        {/* Initialize button or action input */}
        {needsInit && room.host_id === currentUserId ? (
          <button
            onClick={initializeTurns}
            disabled={initializing}
            className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white py-3 rounded-xl font-medium shrink-0"
          >
            {initializing ? "Starting..." : "Begin Adventure (set turn order by SPEED)"}
          </button>
        ) : room.current_round > 0 ? (
          <div className="flex gap-3 shrink-0">
            <input
              value={actionText}
              onChange={(e) => setActionText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && isMyTurn) { e.preventDefault(); submitAction(); } }}
              placeholder={isMyTurn ? "Describe your action..." : `Waiting for ${currentTurnChar?.name ?? "..."} to act...`}
              disabled={!isMyTurn || submitting}
              className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 disabled:opacity-50"
            />
            <button
              onClick={submitAction}
              disabled={!isMyTurn || !actionText.trim() || submitting}
              className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-medium shrink-0"
            >
              {submitting ? "..." : "Submit"}
            </button>
          </div>
        ) : (
          <div className="text-center text-slate-500 text-sm py-3 shrink-0">
            {allHaveChars ? (needsInit ? "" : "Waiting for host to start...") : "Waiting for all players to create characters..."}
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="flex flex-col gap-3 overflow-y-auto">
        {/* Turn order */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 shrink-0">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Turn Order</h3>
          <div className="flex flex-col gap-1.5">
            {sortedBySpeed.length === 0 && <p className="text-slate-500 text-xs">No characters yet</p>}
            {sortedBySpeed.map((c, i) => {
              const isActive = c.user_id === room.current_turn_player_id && room.current_round > 0;
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${isActive ? "bg-purple-900/40 border border-purple-700" : ""}`}
                >
                  <span className="text-slate-600 w-3">{i + 1}.</span>
                  <span className={`flex-1 font-medium truncate ${isActive ? "text-purple-300" : "text-slate-300"}`}>{c.name}</span>
                  <span className="text-slate-500">SPD {c.speed}</span>
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Character cards */}
        {sortedBySpeed.map((c) => {
          const isActive = c.user_id === room.current_turn_player_id && room.current_round > 0;
          return (
            <div key={c.id} className={`bg-slate-800/50 border rounded-xl p-4 shrink-0 ${isActive ? "border-purple-700" : "border-slate-700"}`}>
              <h4 className="font-medium text-white text-sm mb-2 truncate">{c.name}</h4>
              <div className="grid grid-cols-2 gap-1">
                {(["hp","san","str","agi","int","cha","luck","speed"] as const).map((k) => (
                  <div key={k} className="flex justify-between bg-slate-900/50 rounded px-2 py-0.5">
                    <span className="text-slate-500 text-xs">{k.toUpperCase()}</span>
                    <span className="text-slate-300 text-xs font-medium">{c[k]}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
