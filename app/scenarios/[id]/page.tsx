"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface Scenario {
  id: string;
  title: string;
  genre: string;
  description: string;
  background: string | null;
  objective: string | null;
  rules: string | null;
  max_players: number;
  status: string;
}

// Used only when the scenario is not found in Supabase
const FALLBACK_SCENARIOS: Record<string, Scenario> = {
  "00000000-0000-0000-0000-000000000001": {
    id: "00000000-0000-0000-0000-000000000001",
    title: "The Lost Temple",
    genre: "Fantasy",
    description: "An ancient temple hides deadly secrets and forgotten treasures. Your party must navigate traps, solve puzzles, and face the guardian within.",
    background: "Deep in the jungle, a long-forgotten temple has been rediscovered. Legends say it holds the Shard of Eternity — but countless adventurers who sought it were never seen again.",
    objective: "Reach the inner sanctum and retrieve the Shard of Eternity before the temple collapses at dawn.",
    rules: "Build tension gradually. Reward clever thinking and teamwork. Traps should be avoidable if players are cautious.",
    max_players: 4,
    status: "published",
  },
  "00000000-0000-0000-0000-000000000002": {
    id: "00000000-0000-0000-0000-000000000002",
    title: "Neon Shadows",
    genre: "Cyberpunk",
    description: "Navigate a corrupt megacity where corporations rule everything. Hack, fight, and deceive your way to the truth.",
    background: "Neo-Kyoto, 2087. The megacorp Axiom Corp controls water, food, and information. A whistleblower has gone missing — and they left a data chip with your name on it.",
    objective: "Find the missing whistleblower and expose Axiom Corp's secret before the corporation silences you.",
    rules: "Players with high INT can attempt hacking. High CHA allows social manipulation. Combat is dangerous — encourage creative solutions.",
    max_players: 6,
    status: "published",
  },
  "00000000-0000-0000-0000-000000000003": {
    id: "00000000-0000-0000-0000-000000000003",
    title: "The Haunting",
    genre: "Horror",
    description: "Investigate strange occurrences in an abandoned mansion. Not everything that lurks in the dark is what it seems.",
    background: "The Ashford Mansion has been empty for 30 years, ever since the entire family disappeared overnight. You were hired to appraise the estate — but something inside does not want you to leave.",
    objective: "Uncover what happened to the Ashford family and escape the mansion before midnight.",
    rules: "This is survival horror. Build dread slowly. High SAN protects against mental breaks. Players who lose all SAN may act irrationally.",
    max_players: 4,
    status: "published",
  },
};

export default function ScenarioDetailPage({ params }: { params: { id: string } }) {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isFallback, setIsFallback] = useState(false);

  useEffect(() => {
    async function load() {
      // Always check Supabase first — seeds may have added these IDs to the DB
      const supabase = createClient();
      const { data } = await supabase
        .from("scenarios")
        .select("id, title, genre, description, background, objective, rules, max_players, status")
        .eq("id", params.id)
        .single();

      if (data) {
        setScenario(data);
        setIsFallback(false);
        setLoading(false);
        return;
      }

      // Not in DB — try hardcoded fallback
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
        <p className="text-slate-500">Loading scenario...</p>
      </div>
    );
  }

  if (notFound || !scenario) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-400 text-lg">Scenario not found.</p>
        <Link href="/scenarios" className="text-purple-400 hover:text-purple-300 text-sm">
          ← Back to Library
        </Link>
      </div>
    );
  }

  const createRoomHref = `/play/create-room?scenario=${scenario.id}&title=${encodeURIComponent(scenario.title)}&genre=${encodeURIComponent(scenario.genre)}`;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/scenarios" className="text-slate-400 hover:text-white text-sm">
          ← Back to Library
        </Link>
      </div>

      {/* Header */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs bg-purple-900/50 text-purple-300 border border-purple-800 px-2 py-0.5 rounded">
            {scenario.genre}
          </span>
          <span className="text-xs text-slate-500">up to {scenario.max_players} players</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-3">{scenario.title}</h1>
        <p className="text-slate-300 leading-relaxed">{scenario.description}</p>
      </div>

      {/* Objective */}
      {scenario.objective && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 mb-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Objective</h3>
          <p className="text-slate-300 text-sm leading-relaxed">{scenario.objective}</p>
        </div>
      )}

      {/* Background */}
      {scenario.background && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 mb-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Background</h3>
          <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-line">{scenario.background}</p>
        </div>
      )}

      {/* Rules */}
      {scenario.rules && (
        <div className="bg-slate-800/50 border border-amber-900/30 rounded-xl p-5 mb-6">
          <h3 className="text-xs font-semibold text-amber-500/80 uppercase tracking-wider mb-2">GM Notes & Rules</h3>
          <p className="text-slate-400 text-sm leading-relaxed whitespace-pre-line">{scenario.rules}</p>
        </div>
      )}

      {/* Warning only shown if NOT in DB */}
      {isFallback && (
        <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl p-4 mb-4 text-sm text-amber-300">
          <span className="font-semibold">Demo scenario</span> — not yet saved to the database.
          Run the seed SQL in Supabase or publish a real scenario from the{" "}
          <Link href="/dashboard" className="underline hover:text-amber-200">Creator Dashboard</Link>.
        </div>
      )}

      {/* CTA */}
      <div className="flex gap-4">
        <Link
          href={isFallback ? "#" : createRoomHref}
          className={`flex-1 py-3 rounded-lg font-medium text-center transition-colors ${
            isFallback
              ? "bg-slate-700 text-slate-400 cursor-not-allowed pointer-events-none"
              : "bg-purple-600 hover:bg-purple-500 text-white"
          }`}
        >
          {isFallback ? "Create Room (seed DB first)" : "Create Room"}
        </Link>
        <Link
          href="/play/hub"
          className="flex-1 border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white py-3 rounded-lg font-medium text-center transition-colors"
        >
          Join Existing Room
        </Link>
      </div>
    </div>
  );
}
