"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Scenario {
  id: string;
  title: string;
  genre: string;
  description: string;
  status: "draft" | "published";
  max_players: number;
  difficulty: string | null;
  estimated_play_time: number | null;
  created_at: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  async function load() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    const { data } = await supabase
      .from("scenarios")
      .select("id, title, genre, description, status, max_players, difficulty, estimated_play_time, created_at")
      .eq("creator_id", user.id)
      .order("created_at", { ascending: false });
    setScenarios(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [router]);

  async function togglePublish(scenario: Scenario) {
    setToggling(scenario.id);
    const supabase = createClient();
    const newStatus = scenario.status === "published" ? "draft" : "published";
    const { error } = await supabase
      .from("scenarios")
      .update({ status: newStatus })
      .eq("id", scenario.id);
    if (!error) {
      setScenarios((prev) => prev.map((s) => s.id === scenario.id ? { ...s, status: newStatus } : s));
    }
    setToggling(null);
  }

  const published = scenarios.filter((s) => s.status === "published").length;

  const playTime = (min: number | null) => {
    if (!min) return null;
    return min >= 60 ? `${Math.round(min / 60 * 10) / 10}h` : `${min}min`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">創作者後台</h1>
          <p className="text-slate-400 mt-1">管理你的劇本</p>
        </div>
        <Link href="/scenarios/new" className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg font-medium">
          + 新增劇本
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "劇本總數", value: scenarios.length },
          { label: "已發佈", value: published },
          { label: "草稿", value: scenarios.length - published },
        ].map((s) => (
          <div key={s.label} className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
            <div className="text-2xl font-bold text-white">{s.value}</div>
            <div className="text-slate-400 text-sm mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl">
        <div className="p-5 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">我的劇本</h2>
        </div>
        {loading ? (
          <div className="p-12 text-center text-slate-500">載入中...</div>
        ) : scenarios.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <div className="text-4xl mb-3">📖</div>
            <p>尚無劇本，建立你的第一個吧！</p>
            <Link href="/scenarios/new" className="text-zinc-100 hover:text-white text-sm mt-2 inline-block">
              建立劇本 →
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-700">
            {scenarios.map((s) => (
              <div key={s.id} className="p-5 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-medium text-white truncate">{s.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${
                      s.status === "published"
                        ? "bg-green-900/40 text-green-300 border-green-800"
                        : "bg-slate-700 text-slate-400 border-slate-600"
                    }`}>
                      {s.status === "published" ? "已發佈" : "草稿"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-slate-500 mb-1">
                    <span>{s.genre}</span>
                    {s.difficulty && <span>{{ Story: "故事", Normal: "普通", Hard: "困難", Nightmare: "噩夢" }[s.difficulty] ?? s.difficulty}</span>}
                    <span>最多 {s.max_players} 人</span>
                    {s.estimated_play_time && <span>{playTime(s.estimated_play_time)}</span>}
                  </div>
                  <p className="text-slate-400 text-sm line-clamp-1">{s.description}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={`/scenarios/${s.id}/edit`}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    編輯
                  </Link>
                  <button
                    onClick={() => togglePublish(s)}
                    disabled={toggling === s.id}
                    className={`text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                      s.status === "published"
                        ? "bg-slate-700 hover:bg-red-900/40 text-slate-300 hover:text-red-300"
                        : "bg-zinc-700 hover:bg-zinc-800 text-white"
                    }`}
                  >
                    {toggling === s.id ? "..." : s.status === "published" ? "取消發佈" : "發佈"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
