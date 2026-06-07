"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function CreateRoomInner() {
  const router = useRouter();
  const params = useSearchParams();
  const scenarioId = params.get("scenario") ?? "";
  const scenarioTitle = params.get("title") ?? "Unknown Scenario";
  const scenarioGenre = params.get("genre") ?? "";

  const [roomName, setRoomName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!roomName.trim()) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    // Validate scenario exists in DB (catches both missing seeds and invalid IDs)
    const { data: scenarioCheck } = await supabase
      .from("scenarios")
      .select("id")
      .eq("id", scenarioId)
      .eq("status", "published")
      .single();

    if (!scenarioCheck) {
      setError("找不到劇本或劇本尚未發佈，請返回選擇其他劇本。");
      setLoading(false);
      return;
    }

    const roomCode = generateRoomCode();
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .insert({
        scenario_id: scenarioId,
        host_id: user.id,
        name: roomName.trim(),
        room_code: roomCode,
        max_players: maxPlayers,
        status: "waiting",
        current_round: 0,
      })
      .select()
      .single();

    if (roomError || !room) {
      setError(roomError?.message ?? "Failed to create room");
      setLoading(false);
      return;
    }

    // Add host as first room player
    await supabase.from("room_players").insert({
      room_id: room.id,
      user_id: user.id,
    });

    router.push(`/rooms/${room.id}/lobby`);
  }

  return (
    <div className="max-w-lg mx-auto">
      <button onClick={() => router.back()} className="text-slate-400 hover:text-white text-sm mb-6 block">← 返回</button>
      <h1 className="text-3xl font-bold text-white mb-2">建立房間</h1>
      <p className="text-slate-400 mb-8">設定你的遊戲房間</p>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 flex flex-col gap-5">
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
          <div className="text-xs text-slate-500 mb-1">劇本</div>
          <div className="text-white font-medium">{scenarioTitle}</div>
          <div className="text-xs text-slate-400 mt-0.5">{scenarioGenre}</div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3">{error}</div>
        )}

        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">房間名稱</label>
            <input
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="例：週五夜冒險"
              required
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">最多玩家</label>
            <input
              type="number"
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
              min={2}
              max={8}
              className="w-32 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !roomName.trim()}
            className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white py-3 rounded-lg font-medium"
          >
            {loading ? "建立中..." : "建立房間"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function CreateRoomPage() {
  return (
    <Suspense>
      <CreateRoomInner />
    </Suspense>
  );
}
