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
}

const FALLBACK_SCENARIOS: Scenario[] = [
  { id: "00000000-0000-0000-0000-000000000001", title: "The Lost Temple", genre: "Fantasy", description: "An ancient temple hides deadly secrets and forgotten treasures. Your party must navigate traps, solve puzzles, and face the guardian within.", max_players: 4 },
  { id: "00000000-0000-0000-0000-000000000002", title: "Neon Shadows", genre: "Cyberpunk", description: "Navigate a corrupt megacity where corporations rule everything. Hack, fight, and deceive your way to the truth.", max_players: 6 },
  { id: "00000000-0000-0000-0000-000000000003", title: "The Haunting", genre: "Horror", description: "Investigate strange occurrences in an abandoned mansion. Not everything that lurks in the dark is what it seems.", max_players: 4 },
];

const ALL_GENRE = "All";

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
        .select("id, title, genre, description, max_players")
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
    activeGenre === ALL_GENRE
      ? scenarios
      : scenarios.filter((s) => s.genre === activeGenre);

  return (
    <div>
      <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Scenario Library</h1>
          <p className="text-slate-400 mt-1">Choose your adventure</p>
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
            All
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
        <div className="text-slate-500 text-sm">Loading scenarios...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-slate-500 py-20">No scenarios found for this genre.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((s) => (
            <Link key={s.id} href={`/scenarios/${s.id}`} className="group">
              <div className="bg-slate-800/50 border border-slate-700 group-hover:border-purple-500 rounded-xl p-6 transition-colors h-full flex flex-col">
                <div className="flex items-start justify-between mb-3">
                  <span className="text-xs bg-purple-900/50 text-purple-300 border border-purple-800 px-2 py-0.5 rounded">
                    {s.genre}
                  </span>
                  <span className="text-xs text-slate-500">up to {s.max_players} players</span>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{s.title}</h3>
                <p className="text-slate-400 text-sm flex-1">{s.description}</p>
                <div className="mt-4 text-purple-400 text-sm font-medium group-hover:text-purple-300">
                  View Details →
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
