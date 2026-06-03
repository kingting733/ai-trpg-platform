"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
  { id: "00000000-0000-0000-0000-000000000001", title: "The Lost Temple", genre: "Fantasy", description: "An ancient temple hides deadly secrets and forgotten treasures.", max_players: 4 },
  { id: "00000000-0000-0000-0000-000000000002", title: "Neon Shadows", genre: "Cyberpunk", description: "Navigate a corrupt megacity where corporations rule everything.", max_players: 6 },
  { id: "00000000-0000-0000-0000-000000000003", title: "The Haunting", genre: "Horror", description: "Investigate strange occurrences in an abandoned mansion.", max_players: 4 },
];

export default function HubPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loadingScenarios, setLoadingScenarios] = useState(true);

  useEffect(() => {
    const name = localStorage.getItem("trpg_username");
    if (!name) { router.push("/play"); return; }
    setUsername(name);

    async function loadScenarios() {
      const supabase = createClient();
      const { data } = await supabase
        .from("scenarios")
        .select("id, title, genre, description, max_players")
        .eq("status", "published")
        .order("created_at", { ascending: false });
      if (data && data.length > 0) {
        setScenarios(data);
      } else {
        setScenarios(FALLBACK_SCENARIOS);
      }
      setLoadingScenarios(false);
    }
    loadScenarios();
  }, [router]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <p className="text-slate-400 text-sm mb-1">Playing as</p>
        <h1 className="text-3xl font-bold text-white">{username || "..."}</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Join a Room</h2>
          <p className="text-slate-400 text-sm mb-4">Enter a room code from your friend</p>
          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="XXXXX"
              maxLength={6}
              className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 font-mono text-lg tracking-widest uppercase focus:outline-none focus:border-purple-500"
            />
            <button
              onClick={() => joinCode.trim() && router.push(`/play/join/${joinCode.trim()}`)}
              disabled={joinCode.length < 4}
              className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg font-medium"
            >
              Join
            </button>
          </div>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 flex flex-col justify-center">
          <h2 className="text-lg font-semibold text-white mb-3">Create a Room</h2>
          <p className="text-slate-400 text-sm">Pick a scenario below to start your own adventure.</p>
        </div>
      </div>

      <h2 className="text-xl font-semibold text-white mb-4">Choose a Scenario</h2>
      {loadingScenarios ? (
        <div className="text-slate-500 text-sm">Loading scenarios...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {scenarios.map((s) => (
            <Link key={s.id} href={`/play/create-room?scenario=${s.id}&title=${encodeURIComponent(s.title)}&genre=${encodeURIComponent(s.genre)}`}>
              <div className="bg-slate-800/50 border border-slate-700 hover:border-purple-500 rounded-xl p-5 cursor-pointer transition-colors h-full">
                <span className="text-xs bg-purple-900/50 text-purple-300 border border-purple-800 px-2 py-0.5 rounded">{s.genre}</span>
                <h3 className="text-white font-semibold mt-3 mb-2">{s.title}</h3>
                <p className="text-slate-400 text-sm">{s.description}</p>
                <div className="text-xs text-slate-500 mt-3">Up to {s.max_players} players</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
