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
  current_choices: string[] | null;
  current_choices_for_player_id: string | null;
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
  const [gmThinking, setGmThinking] = useState(false);
  const [endingGame, setEndingGame] = useState(false);
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

    const myChar = (chars ?? []).find((c: Character) => c.user_id === user.id);
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
  }, [storyLog, gmThinking]);

  async function initializeTurns() {
    if (!room || initializing) return;
    setInitializing(true);
    const supabase = createClient();

    const sorted = [...characters].sort((a, b) => b.speed - a.speed);
    if (sorted.length === 0) { setInitializing(false); return; }

    for (let i = 0; i < sorted.length; i++) {
      await supabase
        .from("room_players")
        .update({ turn_order: i + 1 })
        .eq("room_id", room.id)
        .eq("user_id", sorted[i].user_id);
    }

    const firstPlayer = sorted[0];
    await supabase
      .from("rooms")
      .update({ current_turn_player_id: firstPlayer.user_id, current_round: 1 })
      .eq("id", room.id);

    await supabase.from("story_logs").insert({
      room_id: room.id,
      round_number: 1,
      entry_type: "system",
      content: `Turn order: ${sorted.map((c) => `${c.name} (SPD ${c.speed})`).join(" → ")}`,
    });

    await fetchAll();

    // GM generates the opening scene
    setGmThinking(true);
    try {
      const res = await fetch("/api/gm/opening", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.id }),
      });
    } catch {
      // non-blocking
    }
    setGmThinking(false);

    await fetchAll();
    setInitializing(false);
  }

  async function submitAction(text?: string) {
    const finalText = (text ?? actionText).trim();
    if (!finalText || !room || !myCharacter || !currentUserId) return;
    setSubmitting(true);
    setActionText("");

    // All game state changes (action save, turn advance, GM response) happen server-side
    setGmThinking(true);
    try {
      await fetch("/api/gm/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: room.id,
          actionText: finalText,
          actingUserId: currentUserId,
          characterId: myCharacter.id,
        }),
      });
    } catch {
      // non-blocking
    }
    setGmThinking(false);

    await fetchAll();
    setSubmitting(false);
  }

  async function endGame() {
    if (!room || !window.confirm("End this adventure? This cannot be undone.")) return;
    setEndingGame(true);
    const supabase = createClient();
    await supabase.from("rooms").update({ status: "completed" }).eq("id", room.id);
    await fetchAll();
    setEndingGame(false);
  }

  if (!room) return <div className="text-center text-slate-400 py-20">Loading room...</div>;

  // Game over screen
  if (room.status === "completed") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-6 text-center">
        <div className="text-5xl">⚔</div>
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Adventure Complete</h1>
          <p className="text-slate-400">The story of <span className="text-purple-400">{room.name}</span> has ended.</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 w-full max-w-lg text-left">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Story Summary</h3>
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
            {storyLog.filter(e => e.entry_type !== "system").map((entry) => (
              <div key={entry.id} className="text-sm">
                {entry.entry_type === "action" && (
                  <p className="text-slate-400"><span className="text-purple-400">{entry.characters?.name ?? "Player"}:</span> {entry.content}</p>
                )}
                {entry.entry_type === "gm_response" && (
                  <p className="text-slate-300 italic">{entry.content}</p>
                )}
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={() => router.push("/play/hub")}
          className="bg-purple-600 hover:bg-purple-500 text-white px-8 py-3 rounded-lg font-medium"
        >
          Back to Hub
        </button>
      </div>
    );
  }

  const isMyTurn = room.current_turn_player_id === currentUserId;
  // Choices must belong to the current turn player — guards against stale one-turn-lag choices
  const choicesAreForMe = room.current_choices_for_player_id === currentUserId;
  const sortedBySpeed = [...characters].sort((a, b) => b.speed - a.speed);
  const currentTurnChar = sortedBySpeed.find((c) => c.user_id === room.current_turn_player_id);
  const allHaveChars = roomPlayers.length > 0 && roomPlayers.every((p) => p.character_id);
  const needsInit = room.status === "in_progress" && room.current_round === 0 && allHaveChars;
  const hasStarted = room.current_round > 0;

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
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 font-mono">{room.room_code}</span>
            {room.host_id === currentUserId && hasStarted && (
              <button
                onClick={endGame}
                disabled={endingGame}
                className="text-xs text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 px-2 py-1 rounded transition-colors disabled:opacity-40"
              >
                End Game
              </button>
            )}
          </div>
        </div>

        {/* Story log */}
        <div className="flex-1 bg-slate-900/50 border border-slate-700 rounded-xl p-4 overflow-y-auto min-h-0 flex flex-col gap-3">
          {storyLog.length === 0 && (
            <p className="text-slate-500 text-sm italic text-center mt-8">
              {needsInit ? "Ready — click Begin Adventure below!" : "Waiting for all players to select their character cards..."}
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
          {gmThinking && (
            <div className="bg-slate-800 border border-amber-900/30 rounded-lg p-3">
              <span className="text-xs text-amber-500/60 font-medium uppercase tracking-wider block mb-1">GM</span>
              <span className="text-slate-500 text-sm italic">thinking...</span>
            </div>
          )}
          <div ref={logEndRef} />
        </div>

        {/* Suggested choices — only shown if they were generated FOR the current turn player */}
        {isMyTurn && choicesAreForMe && (room.current_choices?.length ?? 0) === 3 && hasStarted && (
          <div className="flex flex-col gap-2 shrink-0">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Suggested actions — or type your own below</p>
            <div className="grid grid-cols-1 gap-2">
              {room.current_choices!.map((c, i) => (
                <button
                  key={i}
                  onClick={() => submitAction(c)}
                  disabled={submitting}
                  className="text-left bg-slate-800 hover:bg-slate-700 border border-slate-600 hover:border-purple-500 text-slate-300 hover:text-white text-sm px-4 py-2.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  <span className="text-purple-400 font-bold mr-2">{i + 1}.</span>{c}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Action input */}
        {needsInit && room.host_id === currentUserId ? (
          <button
            onClick={initializeTurns}
            disabled={initializing}
            className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white py-3 rounded-xl font-medium shrink-0"
          >
            {initializing ? "Starting..." : "Begin Adventure"}
          </button>
        ) : hasStarted ? (
          <div className="flex gap-3 shrink-0">
            <input
              value={actionText}
              onChange={(e) => setActionText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && isMyTurn && !submitting) { e.preventDefault(); submitAction(); } }}
              placeholder={isMyTurn ? "Describe your action..." : `Waiting for ${currentTurnChar?.name ?? "..."} to act...`}
              disabled={!isMyTurn || submitting}
              className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 disabled:opacity-50"
            />
            <button
              onClick={() => submitAction()}
              disabled={!isMyTurn || !actionText.trim() || submitting}
              className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-medium shrink-0"
            >
              {submitting ? "..." : "Submit"}
            </button>
          </div>
        ) : (
          <div className="text-center text-slate-500 text-sm py-3 shrink-0">
            {allHaveChars ? "Waiting for host to begin..." : "Waiting for all players to select their character cards..."}
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="flex flex-col gap-3 overflow-y-auto">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 shrink-0">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Turn Order</h3>
          <div className="flex flex-col gap-1.5">
            {sortedBySpeed.length === 0 && <p className="text-slate-500 text-xs">No characters yet</p>}
            {sortedBySpeed.map((c, i) => {
              const isActive = c.user_id === room.current_turn_player_id && hasStarted;
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

        {sortedBySpeed.map((c) => {
          const isActive = c.user_id === room.current_turn_player_id && hasStarted;
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
