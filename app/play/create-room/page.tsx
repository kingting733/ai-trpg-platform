"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const PANEL = {
  background: "linear-gradient(150deg,#1c1813 0%,#13100b 55%,#0f0c08 100%)",
  border: "1px solid #2e2416",
  boxShadow: "0 4px 24px rgba(0,0,0,0.45)",
};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function CreateRoomInner() {
  const router = useRouter();
  const params = useSearchParams();
  const scenarioId    = params.get("scenario") ?? "";
  const scenarioTitle = params.get("title")    ?? "Unknown Scenario";
  const scenarioGenre = params.get("genre")    ?? "";

  const [name, setName]       = useState("");
  const [maxPlayers, setMax]  = useState(4);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

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
        name: name.trim(),
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

    await supabase.from("room_players").insert({ room_id: room.id, user_id: user.id });
    router.push(`/rooms/${room.id}/lobby`);
  }

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
          <span className="text-[10px] tracking-[0.25em] uppercase" style={{ color: "rgba(201,169,110,0.45)" }}>Session Setup</span>
        </div>
        <h1 className="font-serif text-3xl mb-1.5" style={{ color: "#e4d8be", letterSpacing: "0.04em" }}>建立房間</h1>
        <p className="text-zinc-500 text-sm">設定你的遊戲房間</p>
      </div>

      {/* Main panel */}
      <div className="relative rounded-xl p-6 flex flex-col gap-5" style={PANEL}>
        {/* Ornate inner frame */}
        <div className="absolute inset-[6px] rounded-lg pointer-events-none"
          style={{ border: "1px solid rgba(201,169,110,0.14)" }} />
        {/* Paperclip */}
        <div className="absolute -top-2 left-8 w-4 h-8 rounded-full pointer-events-none -rotate-12"
          style={{ border: "2px solid rgba(201,169,110,0.28)", borderBottom: "none" }} />

        <div className="relative flex flex-col gap-5">
          {/* Scenario info */}
          <div className="rounded-lg px-4 py-3" style={{ background: "rgba(14,12,8,0.7)", border: "1px solid #2a2010" }}>
            <div className="text-[10px] tracking-[0.2em] uppercase mb-1" style={{ color: "rgba(201,169,110,0.45)" }}>劇本</div>
            <div className="font-serif text-base" style={{ color: "#e4d8be" }}>{scenarioTitle}</div>
            {scenarioGenre && <div className="text-xs mt-0.5 text-zinc-600">{scenarioGenre}</div>}
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg px-4 py-3 text-sm"
              style={{ background: "rgba(127,29,29,0.2)", border: "1px solid rgba(185,28,28,0.4)", color: "#fca5a5" }}>
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleCreate} className="flex flex-col gap-5">
            <div>
              <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: "rgba(201,169,110,0.55)" }}>
                房間名稱
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：週五夜冒險"
                required
                className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none transition-colors"
                style={{ background: "rgba(14,12,8,0.8)", border: "1px solid #2e2416", color: "#e4d8be" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,169,110,0.5)")}
                onBlur={(e)  => (e.currentTarget.style.borderColor = "#2e2416")}
              />
            </div>

            <div>
              <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: "rgba(201,169,110,0.55)" }}>
                最多玩家
              </label>
              <div className="flex items-center gap-3">
                {[2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMax(n)}
                    className="w-10 h-10 rounded-lg text-sm font-medium transition-all"
                    style={maxPlayers === n
                      ? { background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 12px rgba(201,169,110,0.25)" }
                      : { background: "rgba(14,12,8,0.7)", border: "1px solid #2e2416", color: "#71717a" }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="w-full py-3 rounded-lg font-serif text-base transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed mt-1"
              style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 18px rgba(201,169,110,0.2)" }}
            >
              {loading ? "建立中..." : "建立房間"}
            </button>
          </form>
        </div>
      </div>

      {/* Shimmer line */}
      <div className="h-px mt-8" style={{ background: "linear-gradient(90deg,transparent,rgba(201,169,110,0.15),transparent)" }} />
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
