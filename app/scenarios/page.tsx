"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface Scenario {
  id: string;
  title: string;
  genre: string;
  description: string;
  max_players: number;
  difficulty: string | null;
  estimated_play_time: number | null;
  tags: string[] | null;
}

const FALLBACK_SCENARIOS: Scenario[] = [
  { id: "00000000-0000-0000-0000-000000000001", title: "The Lost Temple", genre: "Fantasy", description: "An ancient temple hides deadly secrets and forgotten treasures. Your party must navigate traps, solve puzzles, and face the guardian within.", max_players: 4, difficulty: "Normal", estimated_play_time: 60, tags: ["dungeon", "traps"] },
  { id: "00000000-0000-0000-0000-000000000002", title: "Neon Shadows", genre: "Cyberpunk", description: "Navigate a corrupt megacity where corporations rule everything. Hack, fight, and deceive your way to the truth.", max_players: 6, difficulty: "Hard", estimated_play_time: 90, tags: ["investigation", "hacking"] },
  { id: "00000000-0000-0000-0000-000000000003", title: "The Haunting", genre: "Horror", description: "Investigate strange occurrences in an abandoned mansion. Not everything that lurks in the dark is what it seems.", max_players: 4, difficulty: "Hard", estimated_play_time: 75, tags: ["horror", "sanity"] },
];

const ALL_GENRE = "All";

const DIFFICULTY_COLOR: Record<string, string> = {
  Story: "text-green-400 border-green-800 bg-green-900/30",
  Normal: "text-blue-400 border-blue-800 bg-blue-900/30",
  Hard: "text-amber-400 border-amber-800 bg-amber-900/30",
  Nightmare: "text-red-400 border-red-800 bg-red-900/30",
};

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [activeGenre, setActiveGenre] = useState(ALL_GENRE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("scenarios")
        .select("id, title, genre, description, max_players, difficulty, estimated_play_time, tags")
        .eq("status", "published")
        .order("created_at", { ascending: false });

      const list = data && data.length > 0 ? data : FALLBACK_SCENARIOS;
      setScenarios(list);
      const uniqueGenres = Array.from(new Set(list.map((s) => s.genre)));
      setGenres(uniqueGenres);
      setLoading(false);
    }
    load();
  }, []);

  const filtered =
    activeGenre === ALL_GENRE ? scenarios : scenarios.filter((s) => s.genre === activeGenre);

  const playTime = (min: number | null) => {
    if (!min) return null;
    return min >= 60 ? `~${Math.round(min / 60 * 10) / 10}h` : `~${min}min`;
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">劇本庫</h1>
          <p className="text-slate-400 mt-1">選擇你的冒險</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveGenre(ALL_GENRE)}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
              activeGenre === ALL_GENRE
                ? "bg-purple-600 border-purple-600 text-white"
                : "border-slate-600 text-slate-300 hover:border-purple-500 hover:text-white"
            }`}
          >
            全部
          </button>
          {genres.map((g) => (
            <button
              key={g}
              onClick={() => setActiveGenre(g)}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                activeGenre === g
                  ? "bg-purple-600 border-purple-600 text-white"
                  : "border-slate-600 text-slate-300 hover:border-purple-500 hover:text-white"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-slate-500 text-sm">載入劇本中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-slate-500 py-20">找不到此類型的劇本。</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((s) => {
            const diffColor = DIFFICULTY_COLOR[s.difficulty ?? "Normal"] ?? DIFFICULTY_COLOR.Normal;
            return (
              <Link key={s.id} href={`/scenarios/${s.id}`} className="group">
                <div className="bg-slate-800/50 border border-slate-700 group-hover:border-purple-500 rounded-xl p-6 transition-colors h-full flex flex-col">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="text-xs bg-purple-900/50 text-purple-300 border border-purple-800 px-2 py-0.5 rounded">
                      {s.genre}
                    </span>
                    {s.difficulty && (
                      <span className={`text-xs px-2 py-0.5 rounded border ${diffColor}`}>
                        {s.difficulty}
                      </span>
                    )}
                    <span className="text-xs text-slate-500 ml-auto">最多 {s.max_players} 人</span>
                    {s.estimated_play_time && (
                      <span className="text-xs text-slate-500">{playTime(s.estimated_play_time)}</span>
                    )}
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">{s.title}</h3>
                  <p className="text-slate-400 text-sm flex-1">{s.description}</p>
                  {s.tags && s.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {s.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-xs bg-slate-700/50 text-slate-500 px-1.5 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 text-purple-400 text-sm font-medium group-hover:text-purple-300">
                    查看詳情 →
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
