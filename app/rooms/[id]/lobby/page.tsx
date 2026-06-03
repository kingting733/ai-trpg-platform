"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Player {
  user_id: string;
  username: string;
}

interface Room {
  id: string;
  name: string;
  room_code: string;
  host_id: string;
  status: string;
  max_players: number;
}

export default function LobbyPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/play"); return; }
    setCurrentUserId(user.id);

    const { data: roomData } = await supabase
      .from("rooms")
      .select("*")
      .eq("id", params.id)
      .single();
    if (!roomData) { router.push("/play/hub"); return; }
    setRoom(roomData);

    if (roomData.status === "in_progress") {
      router.push(`/rooms/${params.id}/character`);
      return;
    }

    // Step 1: get room_players without any join (avoids RLS issues on users table)
    const { data: rpData } = await supabase
      .from("room_players")
      .select("user_id")
      .eq("room_id", params.id);

    const userIds = (rpData ?? []).map((r: { user_id: string }) => r.user_id);
    if (userIds.length === 0) { setPlayers([]); return; }

    // Step 2: try to fetch usernames separately; fall back gracefully if it fails
    const { data: usersData } = await supabase
      .from("users")
      .select("id, username")
      .in("id", userIds);

    const usernameMap: Record<string, string> = {};
    (usersData ?? []).forEach((u: { id: string; username: string }) => {
      usernameMap[u.id] = u.username;
    });

    setPlayers(
      userIds.map((id, i) => ({
        user_id: id,
        username: usernameMap[id] ?? `Player ${i + 1}`,
      }))
    );
  }, [params.id, router]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [fetchData]);

  async function handleStartGame() {
    if (!room) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const { error: updateError } = await supabase
      .from("rooms")
      .update({ status: "in_progress" })
      .eq("id", room.id);

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    router.push(`/rooms/${room.id}/character`);
  }

  const isHost = room?.host_id === currentUserId;

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-3xl font-bold text-white mb-1">{room?.name ?? "Loading..."}</h1>
      <p className="text-slate-400 mb-2 text-sm">
        {isHost ? "Share the room code and start when ready." : "Waiting for the host to start..."}
      </p>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 mb-4 text-center">
        <div className="text-xs text-slate-500 mb-1">Room Code — share with friends</div>
        <div className="text-4xl font-mono font-bold text-purple-400 tracking-[0.3em]">{room?.room_code}</div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>
      )}

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Players ({players.length}/{room?.max_players ?? "?"})
        </h2>
        <div className="flex flex-col gap-2">
          {players.map((p) => (
            <div key={p.user_id} className="flex items-center justify-between py-2 px-3 bg-slate-900/50 rounded-lg">
              <span className="text-white font-medium">{p.username}</span>
              {p.user_id === room?.host_id && (
                <span className="text-xs bg-amber-900/50 text-amber-300 border border-amber-800 px-2 py-0.5 rounded">Host</span>
              )}
            </div>
          ))}
          {players.length === 0 && <p className="text-slate-500 text-sm">Loading players...</p>}
        </div>
      </div>

      {isHost ? (
        <button
          onClick={handleStartGame}
          disabled={loading || players.length < 1}
          className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white py-3 rounded-lg font-medium text-lg"
        >
          {loading ? "Starting..." : `Start Game${players.length === 1 ? " (Solo)" : ""}`}
        </button>
      ) : (
        <div className="text-center text-slate-400 text-sm py-3">
          Waiting for the host to start the game...
        </div>
      )}
    </div>
  );
}
