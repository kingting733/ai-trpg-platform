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

const DIFFICULTY_CHIP: Record<string, { border: string; color: string; bg: string }> = {
  Story:     { border: "rgba(74,222,128,0.4)",  color: "#86efac", bg: "rgba(20,83,45,0.25)"  },
  Normal:    { border: "rgba(56,189,248,0.4)",  color: "#7dd3fc", bg: "rgba(12,74,110,0.25)" },
  Hard:      { border: "rgba(201,169,110,0.5)", color: "#c9a96e", bg: "rgba(78,52,18,0.25)"  },
  Nightmare: { border: "rgba(248,113,113,0.4)", color: "#fca5a5", bg: "rgba(127,29,29,0.25)" },
};

const PANEL = {
  background: "linear-gradient(150deg,#1c1813 0%,#13100b 55%,#0f0c08 100%)",
  border: "1px solid #2e2416",
  boxShadow: "0 4px 24px rgba(0,0,0,0.45)",
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
        <p className="text-zinc-600 font-serif">載入劇本中...</p>
      </div>
    );
  }

  if (notFound || !scenario) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="font-serif text-lg" style={{ color: "#e4d8be" }}>找不到此劇本。</p>
        <Link href="/scenarios" className="text-sm transition-colors" style={{ color: "rgba(201,169,110,0.6)" }}>
          ← 返回劇本庫
        </Link>
      </div>
    );
  }

  const chip = DIFFICULTY_CHIP[scenario.difficulty ?? "Normal"] ?? DIFFICULTY_CHIP.Normal;
  const createRoomHref = `/play/create-room?scenario=${scenario.id}&title=${encodeURIComponent(scenario.title)}&genre=${encodeURIComponent(scenario.genre)}`;
  const playTime = scenario.estimated_play_time
    ? scenario.estimated_play_time >= 60
      ? `~${Math.round(scenario.estimated_play_time / 60 * 10) / 10}h`
      : `~${scenario.estimated_play_time}min`
    : null;

  return (
    <div className="max-w-3xl mx-auto py-4">
      {/* Back */}
      <Link href="/scenarios"
        className="inline-flex items-center gap-1.5 text-sm mb-8 transition-colors"
        style={{ color: "rgba(201,169,110,0.55)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#c9a96e")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(201,169,110,0.55)")}>
        ← 返回劇本庫
      </Link>

      {/* Main info panel */}
      <div className="relative rounded-xl p-8 mb-5" style={PANEL}>
        <div className="absolute inset-[6px] rounded-lg pointer-events-none"
          style={{ border: "1px solid rgba(201,169,110,0.14)" }} />
        {/* Paperclip */}
        <div className="absolute -top-2 left-8 w-4 h-8 rounded-full pointer-events-none -rotate-12"
          style={{ border: "2px solid rgba(201,169,110,0.28)", borderBottom: "none" }} />

        <div className="relative">
          {/* Tags row */}
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <span className="text-xs px-2.5 py-0.5 rounded"
              style={{ background: "rgba(201,169,110,0.1)", border: "1px solid rgba(201,169,110,0.3)", color: "#c9a96e" }}>
              {scenario.genre}
            </span>
            {scenario.difficulty && (
              <span className="text-xs px-2.5 py-0.5 rounded"
                style={{ background: chip.bg, border: `1px solid ${chip.border}`, color: chip.color }}>
                {scenario.difficulty}
              </span>
            )}
            <span className="text-xs text-zinc-600">最多 {scenario.max_players} 人</span>
            {playTime && <span className="text-xs text-zinc-600">{playTime}</span>}
          </div>

          {/* Title */}
          <div className="flex items-center gap-3 mb-2">
            <div className="h-px w-6" style={{ background: "rgba(201,169,110,0.3)" }} />
            <span className="text-[10px] tracking-[0.25em] uppercase" style={{ color: "rgba(201,169,110,0.45)" }}>Scenario</span>
          </div>
          <h1 className="font-serif text-3xl mb-4" style={{ color: "#e4d8be", letterSpacing: "0.04em" }}>
            {scenario.title}
          </h1>

          {/* Description */}
          <p className="text-sm leading-relaxed mb-5" style={{ color: "rgba(228,216,190,0.7)" }}>
            {scenario.description}
          </p>

          {/* Tags */}
          {scenario.tags && scenario.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {scenario.tags.map((tag) => (
                <span key={tag} className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(14,12,8,0.7)", border: "1px solid #2a2010", color: "rgba(201,169,110,0.5)" }}>
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Objective panel */}
      {scenario.objective && (
        <div className="relative rounded-xl p-5 mb-5" style={PANEL}>
          <div className="absolute inset-[6px] rounded-lg pointer-events-none"
            style={{ border: "1px solid rgba(201,169,110,0.14)" }} />
          <div className="relative">
            <div className="text-[10px] tracking-[0.2em] uppercase mb-3" style={{ color: "rgba(201,169,110,0.45)" }}>任務目標</div>
            <p className="text-sm leading-relaxed" style={{ color: "rgba(228,216,190,0.7)" }}>{scenario.objective}</p>
          </div>
        </div>
      )}

      {/* Fallback notice */}
      {isFallback && (
        <div className="rounded-xl p-4 mb-5 text-sm"
          style={{ background: "rgba(78,52,18,0.2)", border: "1px solid rgba(201,169,110,0.3)", color: "#c9a96e" }}>
          <span className="font-semibold">示範劇本</span> — 尚未儲存至資料庫。
          請在 Supabase 執行種子 SQL，或從{" "}
          <Link href="/dashboard" className="underline opacity-80 hover:opacity-100">創作者後台</Link>發佈真實劇本。
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-4">
        <Link
          href={isFallback ? "#" : createRoomHref}
          className={`flex-1 py-3 rounded-lg font-serif text-base text-center transition-all ${isFallback ? "opacity-40 pointer-events-none cursor-not-allowed" : "hover:brightness-110"}`}
          style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: isFallback ? "none" : "0 0 18px rgba(201,169,110,0.2)" }}
        >
          {isFallback ? "建立房間（請先執行種子 SQL）" : "建立房間"}
        </Link>
        <Link
          href="/play/hub"
          className="flex-1 py-3 rounded-lg font-serif text-base text-center transition-all hover:brightness-110"
          style={{ background: "rgba(14,12,8,0.7)", border: "1px solid rgba(201,169,110,0.3)", color: "#c9a96e" }}
        >
          加入現有房間
        </Link>
      </div>

      <div className="h-px mt-8" style={{ background: "linear-gradient(90deg,transparent,rgba(201,169,110,0.15),transparent)" }} />
    </div>
  );
}
