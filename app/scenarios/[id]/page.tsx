"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface Scenario {
  id: string;
  title: string;
  genre: string;
  description: string;
  objective: string | null;
  max_players: number;
  status: string;
  difficulty: string | null;
  estimated_play_time: number | null;
  tags: string[] | null;
}

const FALLBACK_SCENARIOS: Record<string, Scenario> = {
  "00000000-0000-0000-0000-000000000001": {
    id: "00000000-0000-0000-0000-000000000001",
    title: "The Lost Temple",
    genre: "Fantasy",
    description: "An ancient temple hides deadly secrets and forgotten treasures. Your party must navigate traps, solve puzzles, and face the guardian within.",
    objective: "Reach the inner sanctum and retrieve the Shard of Eternity before the temple collapses at dawn.",
    max_players: 4,
    status: "published",
    difficulty: "Normal",
    estimated_play_time: 60,
    tags: ["dungeon", "traps", "fantasy"],
  },
  "00000000-0000-0000-0000-000000000002": {
    id: "00000000-0000-0000-0000-000000000002",
    title: "Neon Shadows",
    genre: "Cyberpunk",
    description: "Navigate a corrupt megacity where corporations rule everything. Hack, fight, and deceive your way to the truth.",
    objective: "Find the missing whistleblower and expose Axiom Corp's secret before the corporation silences you.",
    max_players: 6,
    status: "published",
    difficulty: "Hard",
    estimated_play_time: 90,
    tags: ["cyberpunk", "investigation", "hacking"],
  },
  "00000000-0000-0000-0000-000000000003": {
    id: "00000000-0000-0000-0000-000000000003",
    title: "The Haunting",
    genre: "Horror",
    description: "Investigate strange occurrences in an abandoned mansion. Not everything that lurks in the dark is what it seems.",
    objective: "Uncover what happened to the Ashford family and escape the mansion before midnight.",
    max_players: 4,
    status: "published",
    difficulty: "Hard",
    estimated_play_time: 75,
    tags: ["horror", "investigation", "sanity"],
  },
};

const DIFFICULTY_COLOR: Record<string, string> = {
  Story: "text-green-400 border-green-800 bg-green-900/30",
  Normal: "text-blue-400 border-blue-800 bg-blue-900/30",
  Hard: "text-amber-400 border-amber-800 bg-amber-900/30",
  Nightmare: "text-red-400 border-red-800 bg-red-900/30",
};

export default function ScenarioDetailPage({ params }: { params: { id: string } }) {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isFallback, setIsFallback] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("scenarios")
        .select("id, title, genre, description, objective, max_players, status, difficulty, estimated_play_time, tags")
        .eq("id", params.id)
        .single();

      if (data) {
        setScenario(data);
        setIsFallback(false);
        setLoading(false);
        return;
      }

      const fallback = FALLBACK_SCENARIOS[params.id];
      if (fallback) {
        setScenario(fallback);
        setIsFallback(true);
        setLoading(false);
        return;
      }

      setNotFound(true);
      setLoading(false);
    }
    load();
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-slate-500">載入劇本中...</p>
      </div>
    );
  }

  if (notFound || !scenario) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-400 text-lg">找不到此劇本。</p>
        <Link href="/scenarios" className="text-zinc-100 hover:text-white text-sm">
          ← 返回劇本庫
        </Link>
      </div>
    );
  }

  const diffColor = DIFFICULTY_COLOR[scenario.difficulty ?? "Normal"] ?? DIFFICULTY_COLOR.Normal;
  const createRoomHref = `/play/create-room?scenario=${scenario.id}&title=${encodeURIComponent(scenario.title)}&genre=${encodeURIComponent(scenario.genre)}`;
  const playTime = scenario.estimated_play_time
    ? scenario.estimated_play_time >= 60
      ? `~${Math.round(scenario.estimated_play_time / 60 * 10) / 10}h`
      : `~${scenario.estimated_play_time}min`
    : null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/scenarios" className="text-slate-400 hover:text-white text-sm">
          ← 返回劇本庫
        </Link>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs bg-zinc-800/70 text-white border border-zinc-700 px-2 py-0.5 rounded">
            {scenario.genre}
          </span>
          {scenario.difficulty && (
            <span className={`text-xs px-2 py-0.5 rounded border ${diffColor}`}>
              {scenario.difficulty}
            </span>
          )}
          <span className="text-xs text-slate-500">最多 {scenario.max_players} 人</span>
          {playTime && <span className="text-xs text-slate-500">{playTime}</span>}
        </div>
        <h1 className="text-3xl font-bold text-white mb-3">{scenario.title}</h1>
        <p className="text-slate-300 leading-relaxed">{scenario.description}</p>

        {scenario.tags && scenario.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {scenario.tags.map((tag) => (
              <span key={tag} className="text-xs bg-slate-700/60 text-slate-400 border border-slate-600/50 px-2 py-0.5 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {scenario.objective && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 mb-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">目標</h3>
          <p className="text-slate-300 text-sm leading-relaxed">{scenario.objective}</p>
        </div>
      )}

      {isFallback && (
        <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl p-4 mb-4 text-sm text-amber-300">
          <span className="font-semibold">示範劇本</span> — 尚未儲存至資料庫。
          請在 Supabase 執行種子 SQL，或從{" "}
          <Link href="/dashboard" className="underline hover:text-amber-200">創作者後台</Link>發佈真實劇本。
        </div>
      )}

      <div className="flex gap-4">
        <Link
          href={isFallback ? "#" : createRoomHref}
          className={`flex-1 py-3 rounded-lg font-medium text-center transition-colors ${
            isFallback
              ? "bg-slate-700 text-slate-400 cursor-not-allowed pointer-events-none"
              : "bg-zinc-800 hover:bg-zinc-700 text-white"
          }`}
        >
          {isFallback ? "建立房間（請先執行種子 SQL）" : "建立房間"}
        </Link>
        <Link
          href="/play/hub"
          className="flex-1 border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white py-3 rounded-lg font-medium text-center transition-colors"
        >
          加入現有房間
        </Link>
      </div>
    </div>
  );
}
