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

const PANEL = {
  background: "linear-gradient(150deg,#1c1813 0%,#13100b 55%,#0f0c08 100%)",
  border: "1px solid #2e2416",
  boxShadow: "0 4px 24px rgba(0,0,0,0.45)",
};

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
    if (!user) { router.push("/login"); return; }
    setCurrentUserId(user.id);

    const { data: roomData } = await supabase
      .from("rooms")
      .select("*")
      .eq("id", params.id)
      .single();
    if (!roomData) { router.push("/play/hub"); return; }
    setRoom(roomData);

    if (roomData.status === "in_progress") {
      router.push(`/rooms/${params.id}/select-card`);
      return;
    }

    const { data: rpData } = await supabase
      .from("room_players")
      .select("user_id")
      .eq("room_id", params.id);

    const userIds = (rpData ?? []).map((r: { user_id: string }) => r.user_id);
    if (userIds.length === 0) { setPlayers([]); return; }

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

    router.push(`/rooms/${room.id}/select-card`);
  }

  const isHost = room?.host_id === currentUserId;

  return (
    <div className="max-w-lg mx-auto py-4">
      {/* Back */}
      <button onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm mb-8 transition-colors"
        style={{ color: "rgba(201,169,110,0.55)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#c9a96e")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(201,169,110,0.55)")}>
        ← 返回
      </button>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-px w-6" style={{ background: "rgba(201,169,110,0.3)" }} />
          <span className="text-[10px] tracking-[0.25em] uppercase" style={{ color: "rgba(201,169,110,0.45)" }}>Waiting Room</span>
        </div>
        <h1 className="font-serif text-3xl mb-1.5" style={{ color: "#e4d8be", letterSpacing: "0.04em" }}>
          {room?.name ?? "載入中..."}
        </h1>
        <p className="text-zinc-500 text-sm">
          {isHost ? "分享房間代碼，準備好後即可開始。" : "等待主持人開始..."}
        </p>
      </div>

      {/* Room code */}
      <div className="relative rounded-xl p-6 mb-5 text-center" style={PANEL}>
        <div className="absolute inset-[6px] rounded-lg pointer-events-none"
          style={{ border: "1px solid rgba(201,169,110,0.14)" }} />
        {/* Paperclip */}
        <div className="absolute -top-2 left-8 w-4 h-8 rounded-full pointer-events-none -rotate-12"
          style={{ border: "2px solid rgba(201,169,110,0.28)", borderBottom: "none" }} />
        <div className="relative">
          <div className="text-[10px] tracking-[0.2em] uppercase mb-3" style={{ color: "rgba(201,169,110,0.45)" }}>
            房間代碼 — 分享給朋友
          </div>
          <div className="font-mono text-4xl font-bold tracking-[0.35em]" style={{ color: "#e4d8be" }}>
            {room?.room_code}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm mb-4"
          style={{ background: "rgba(127,29,29,0.2)", border: "1px solid rgba(185,28,28,0.4)", color: "#fca5a5" }}>
          {error}
        </div>
      )}

      {/* Players panel */}
      <div className="relative rounded-xl p-5 mb-6" style={PANEL}>
        <div className="absolute inset-[6px] rounded-lg pointer-events-none"
          style={{ border: "1px solid rgba(201,169,110,0.14)" }} />
        <div className="relative">
          <div className="text-[10px] tracking-[0.2em] uppercase mb-4" style={{ color: "rgba(201,169,110,0.45)" }}>
            玩家（{players.length}/{room?.max_players ?? "?"}）
          </div>
          <div className="flex flex-col gap-2">
            {players.map((p) => (
              <div key={p.user_id}
                className="flex items-center justify-between py-2.5 px-4 rounded-lg"
                style={{ background: "rgba(14,12,8,0.6)", border: "1px solid #2a2010" }}>
                <span className="font-serif text-sm" style={{ color: "#e4d8be" }}>{p.username}</span>
                {p.user_id === room?.host_id && (
                  <span className="text-[10px] tracking-[0.15em] uppercase px-2 py-0.5 rounded"
                    style={{ background: "rgba(201,169,110,0.12)", border: "1px solid rgba(201,169,110,0.35)", color: "#c9a96e" }}>
                    房主
                  </span>
                )}
              </div>
            ))}
            {players.length === 0 && (
              <p className="text-zinc-600 text-sm text-center py-2">載入玩家中...</p>
            )}
          </div>
        </div>
      </div>

      {/* Start / waiting */}
      {isHost ? (
        <button
          onClick={handleStartGame}
          disabled={loading || players.length < 1}
          className="w-full py-3 rounded-lg font-serif text-base transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 18px rgba(201,169,110,0.2)" }}
        >
          {loading ? "開始中..." : `開始遊戲${players.length === 1 ? "（單人）" : ""}`}
        </button>
      ) : (
        <div className="text-center text-zinc-600 text-sm py-3 font-serif tracking-wide">
          等待主持人開始遊戲...
        </div>
      )}

      <div className="h-px mt-8" style={{ background: "linear-gradient(90deg,transparent,rgba(201,169,110,0.15),transparent)" }} />
    </div>
  );
}
