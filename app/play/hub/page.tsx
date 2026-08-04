"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowRight, KeyRound } from "lucide-react";
import { JoinRoomModal } from "@/components/JoinRoomModal";

interface Scenario {
  id: string;
  title: string;
  genre: string;
  description: string;
  max_players: number;
}

interface ActiveRoom {
  id: string;
  name: string;
  room_code: string;
  status: string;
  scenarios: { title: string; genre: string } | null;
}

const FALLBACK_SCENARIOS: Scenario[] = [
  { id: "00000000-0000-0000-0000-000000000001", title: "The Lost Temple", genre: "Fantasy", description: "An ancient temple hides deadly secrets and forgotten treasures.", max_players: 4 },
  { id: "00000000-0000-0000-0000-000000000002", title: "Neon Shadows", genre: "Cyberpunk", description: "Navigate a corrupt megacity where corporations rule everything.", max_players: 6 },
  { id: "00000000-0000-0000-0000-000000000003", title: "The Haunting", genre: "Horror", description: "Investigate strange occurrences in an abandoned mansion.", max_players: 4 },
];

export default function HubPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [joinOpen, setJoinOpen] = useState(false);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loadingScenarios, setLoadingScenarios] = useState(true);
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);

  useEffect(() => {
    async function loadData() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      // Middleware handles redirect, but belt-and-suspenders:
      if (!user) { router.push("/login?next=/play/hub"); return; }

      // Get username from public.users (no localStorage dependency)
      const { data: profile } = await supabase
        .from("users")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();
      setUsername(profile?.username ?? user.email?.split("@")[0] ?? "Adventurer");

      // Load published scenarios
      const { data: scenarioData } = await supabase
        .from("scenarios")
        .select("id, title, genre, description, max_players")
        .eq("status", "published")
        .order("created_at", { ascending: false });
      setScenarios(scenarioData && scenarioData.length > 0 ? scenarioData : FALLBACK_SCENARIOS);
      setLoadingScenarios(false);

      // Load active rooms the user is in
      const { data: rpData } = await supabase
        .from("room_players")
        .select("room_id")
        .eq("user_id", user.id);

      const roomIds = (rpData ?? []).map((r: { room_id: string }) => r.room_id);
      if (roomIds.length > 0) {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: roomData } = await supabase
          .from("rooms")
          .select("id, name, room_code, status, scenarios(title, genre)")
          .in("id", roomIds)
          .in("status", ["waiting", "in_progress"])
          .gte("created_at", cutoff)
          .order("created_at", { ascending: false });
        setActiveRooms((roomData as unknown as ActiveRoom[]) ?? []);
      }
    }
    loadData();
  }, [router]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <p className="text-slate-400 text-sm mb-1">目前角色</p>
        <h1 className="text-3xl font-bold text-white">{username || "..."}</h1>
      </div>

      {/* Active rooms */}
      {activeRooms.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
            返回進行中的遊戲
          </h2>
          <div className="flex flex-col gap-3">
            {activeRooms.map((r) => (
              <Link key={r.id} href={r.status === "waiting" ? `/rooms/${r.id}/lobby` : `/rooms/${r.id}`}>
                <div className="bg-zinc-800/50 border border-zinc-600/60 hover:border-zinc-400 rounded-xl p-4 flex items-center justify-between transition-colors cursor-pointer">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-white font-semibold">{r.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded border ${
                        r.status === "in_progress"
                          ? "bg-green-900/40 text-green-300 border-green-800"
                          : "bg-slate-700 text-slate-400 border-slate-600"
                      }`}>
                        {r.status === "in_progress" ? "進行中" : "等待中"}
                      </span>
                    </div>
                    <p className="text-slate-400 text-sm">
                      {r.scenarios?.title ?? "未知劇本"}
                      <span className="text-slate-600 mx-1">·</span>
                      <span className="font-mono text-slate-500">{r.room_code}</span>
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-zinc-100 font-medium text-sm shrink-0">
                    {r.status === "in_progress" ? "返回遊戲" : "返回大廳"} <ArrowRight size={14} strokeWidth={2} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">選擇劇本</h2>
          <p className="text-slate-400 text-sm mt-1">選一個劇本建立房間，開始你的冒險。</p>
        </div>
        <button
          type="button"
          onClick={() => setJoinOpen(true)}
          className="shrink-0 inline-flex items-center gap-1.5 text-sm text-gold hover:text-gold-light border border-gold-dim hover:border-gold-muted rounded-lg px-3 py-1.5 transition-colors"
        >
          <KeyRound size={14} strokeWidth={2} /> 用代碼加入房間
        </button>
      </div>
      <JoinRoomModal open={joinOpen} onClose={() => setJoinOpen(false)} />
      {loadingScenarios ? (
        <div className="text-slate-500 text-sm">載入劇本中...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {scenarios.map((s) => (
            <Link key={s.id} href={`/play/create-room?scenario=${s.id}&title=${encodeURIComponent(s.title)}&genre=${encodeURIComponent(s.genre)}`}>
              <div className="bg-slate-800/50 border border-slate-700 hover:border-zinc-400 rounded-xl p-5 cursor-pointer transition-colors h-full">
                <span className="text-xs bg-zinc-800/70 text-white border border-zinc-700 px-2 py-0.5 rounded">{s.genre}</span>
                <h3 className="text-white font-semibold mt-3 mb-2">{s.title}</h3>
                <p className="text-slate-400 text-sm">{s.description}</p>
                <div className="text-xs text-slate-500 mt-3">最多 {s.max_players} 人</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
