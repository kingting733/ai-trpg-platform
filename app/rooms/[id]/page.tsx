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

interface RollResult {
  requires_check: boolean;
  stat_used: string | null;
  stat_value: number | null;
  modifier: number | null;
  d20_roll: number | null;
  dc: number | null;
  total: number | null;
  outcome: string | null;
  hp_change: number;
  san_change: number;
  consequence_summary: string;
}

interface StoryLogEntry {
  id: string;
  entry_type: "system" | "action" | "gm_response";
  content: string;
  character_id: string | null;
  player_id: string | null;
  created_at: string;
  characters?: { name: string } | null;
  roll_result?: RollResult | null;
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
  ending_type: string | null;
  ending_title: string | null;
  ending_summary: string | null;
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

  // Ending screen
  if (room.status === "completed") {
    return <EndingScreen room={room} storyLog={storyLog} onHub={() => router.push("/play/hub")} onScenarios={() => router.push("/scenarios")} onDashboard={() => router.push("/dashboard")} />;
  }

  const iAmDown = (myCharacter?.hp ?? 1) <= 0;
  const iAmBroken = (myCharacter?.san ?? 1) <= 0;
  // A downed character cannot act; the turn flow skips them server-side.
  const isMyTurn = room.current_turn_player_id === currentUserId && !iAmDown;
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
                <div className="flex flex-col gap-1">
                  <div className="flex gap-2">
                    <span className="text-purple-400 font-medium text-sm shrink-0">{entry.characters?.name ?? "Player"}:</span>
                    <span className="text-slate-300 text-sm">{entry.content}</span>
                  </div>
                  {entry.roll_result?.requires_check && <DiceResult roll={entry.roll_result} />}
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
        ) : hasStarted && iAmDown ? (
          <div className="text-center text-red-300 text-sm py-3 shrink-0 border border-red-900/50 bg-red-900/20 rounded-xl">
            {myCharacter?.name ?? "Your character"} has fallen in this room and can no longer act.
          </div>
        ) : hasStarted ? (
          <div className="flex flex-col gap-2 shrink-0">
            {iAmBroken && (
              <div className="text-center text-fuchsia-300 text-xs py-1.5 border border-fuchsia-900/50 bg-fuchsia-900/20 rounded-lg">
                {myCharacter?.name ?? "Your character"}'s mind has broken — actions may be erratic.
              </div>
            )}
          <div className="flex gap-3">
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
          const down = c.hp <= 0;
          const broken = c.san <= 0;
          return (
            <div key={c.id} className={`bg-slate-800/50 border rounded-xl p-4 shrink-0 ${down ? "border-red-900/70 opacity-60" : isActive ? "border-purple-700" : "border-slate-700"}`}>
              <div className="flex items-center justify-between mb-2 gap-2">
                <h4 className="font-medium text-white text-sm truncate">{c.name}</h4>
                {down && <span className="text-[10px] bg-red-900/60 text-red-300 border border-red-800 px-1.5 py-0.5 rounded shrink-0">DEAD</span>}
                {!down && broken && <span className="text-[10px] bg-fuchsia-900/60 text-fuchsia-300 border border-fuchsia-800 px-1.5 py-0.5 rounded shrink-0">BROKEN</span>}
              </div>
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

// ─── Ending Screen ────────────────────────────────────────────────────────────

const ENDING_META: Record<string, { icon: string; badge: string; badgeCls: string; borderCls: string }> = {
  best:    { icon: "✦", badge: "Best Ending",    badgeCls: "bg-amber-900/60 text-amber-300 border-amber-700",    borderCls: "border-amber-700/60" },
  normal:  { icon: "✔", badge: "Victory",        badgeCls: "bg-green-900/60 text-green-300 border-green-700",    borderCls: "border-green-700/60" },
  bad:     { icon: "↗", badge: "Bittersweet End", badgeCls: "bg-orange-900/60 text-orange-300 border-orange-700", borderCls: "border-orange-700/60" },
  failure: { icon: "✕", badge: "Defeat",         badgeCls: "bg-red-900/60 text-red-300 border-red-700",         borderCls: "border-red-700/60" },
};

function EndingScreen({
  room, storyLog, onHub, onScenarios, onDashboard,
}: {
  room: Room;
  storyLog: StoryLogEntry[];
  onHub: () => void;
  onScenarios: () => void;
  onDashboard: () => void;
}) {
  const hasEnding = !!room.ending_title;
  const meta = ENDING_META[room.ending_type ?? ""] ?? ENDING_META.normal;

  return (
    <div className="flex flex-col items-center justify-start min-h-[70vh] gap-6 py-10 max-w-2xl mx-auto">
      {/* Icon + type badge */}
      <div className="flex flex-col items-center gap-3">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-3xl border-2 ${hasEnding ? meta.borderCls : "border-slate-600"} bg-slate-800`}>
          {hasEnding ? meta.icon : "⚔"}
        </div>
        {hasEnding && (
          <span className={`text-xs px-3 py-1 rounded-full border font-semibold uppercase tracking-wider ${meta.badgeCls}`}>
            {meta.badge}
          </span>
        )}
      </div>

      {/* Title + room name */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white mb-1">
          {hasEnding ? room.ending_title : "Adventure Complete"}
        </h1>
        <p className="text-slate-400 text-sm">
          The story of <span className="text-purple-400">{room.name}</span> has ended.
        </p>
      </div>

      {/* Ending summary */}
      {room.ending_summary && (
        <div className={`w-full bg-slate-800/60 border rounded-xl p-5 ${meta.borderCls}`}>
          <p className="text-slate-200 leading-relaxed text-sm">{room.ending_summary}</p>
        </div>
      )}

      {/* Story log (last 10 non-system entries) */}
      <div className="w-full bg-slate-900/50 border border-slate-700 rounded-xl p-5">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Story Recap</h3>
        <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
          {storyLog
            .filter((e) => e.entry_type !== "system")
            .slice(-10)
            .map((entry) => (
              <div key={entry.id} className="text-sm">
                {entry.entry_type === "action" && (
                  <p className="text-slate-400">
                    <span className="text-purple-400">{entry.characters?.name ?? "Player"}:</span>{" "}
                    {entry.content}
                  </p>
                )}
                {entry.entry_type === "gm_response" && (
                  <p className="text-slate-300 italic">{entry.content}</p>
                )}
              </div>
            ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 w-full">
        <button
          onClick={onScenarios}
          className="flex-1 bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-lg font-medium transition-colors"
        >
          Browse Scenarios
        </button>
        <button
          onClick={onHub}
          className="flex-1 border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white py-3 rounded-lg font-medium transition-colors"
        >
          Play Hub
        </button>
        <button
          onClick={onDashboard}
          className="flex-1 border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white py-3 rounded-lg font-medium transition-colors"
        >
          Dashboard
        </button>
      </div>
    </div>
  );
}

// ─── Dice Result ─────────────────────────────────────────────────────────────

const OUTCOME_STYLES: Record<string, { label: string; cls: string }> = {
  critical_success: { label: "Critical Success", cls: "text-emerald-300 border-emerald-700 bg-emerald-900/30" },
  success:          { label: "Success",          cls: "text-green-300 border-green-700 bg-green-900/30" },
  partial_success:  { label: "Partial Success",  cls: "text-yellow-300 border-yellow-700 bg-yellow-900/30" },
  failure:          { label: "Failure",          cls: "text-orange-300 border-orange-700 bg-orange-900/30" },
  critical_failure: { label: "Critical Failure", cls: "text-red-300 border-red-700 bg-red-900/30" },
};

function DiceResult({ roll }: { roll: RollResult }) {
  const style = roll.outcome ? OUTCOME_STYLES[roll.outcome] : null;
  const mod = roll.modifier ?? 0;
  return (
    <div className={`ml-6 rounded-lg border px-3 py-2 text-xs ${style?.cls ?? "border-slate-700 bg-slate-900/40"}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-bold uppercase tracking-wider">🎲 {roll.stat_used?.toUpperCase()} Check</span>
        <span className="opacity-90">
          d20({roll.d20_roll}) {mod >= 0 ? "+" : "−"} {Math.abs(mod)} = <b>{roll.total}</b> vs DC {roll.dc}
        </span>
        <span className="font-bold">→ {style?.label ?? roll.outcome}</span>
      </div>
      {(roll.hp_change !== 0 || roll.san_change !== 0 || roll.consequence_summary) && (
        <div className="mt-1 opacity-90">
          {roll.consequence_summary}
          {roll.hp_change !== 0 && <span className="ml-1 font-semibold">HP {roll.hp_change}</span>}
          {roll.san_change !== 0 && <span className="ml-1 font-semibold">SAN {roll.san_change}</span>}
        </div>
      )}
    </div>
  );
}
