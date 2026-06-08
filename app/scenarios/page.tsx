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
  cover_image_url: string | null;
}

function toCaseId(id: string, genre: string): string {
  const prefix = genre.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "XX";
  const hash = parseInt(id.replace(/-/g, "").slice(0, 8), 16);
  return `${prefix}-${String(hash % 9999).padStart(3, "0")}`;
}

const DIFFICULTY_STYLE: Record<string, string> = {
  Story:     "text-emerald-400",
  Normal:    "text-sky-400",
  Hard:      "text-amber-400",
  Nightmare: "text-red-400",
};

const FEATURES = [
  { icon: "🤖", title: "AI GM 智能主持",  desc: "智能生成劇情與場景，讓每次跑團都獨一無二。" },
  { icon: "👥", title: "多人協作跑團",    desc: "與好友即時協作，共創精彩故事。" },
  { icon: "🎲", title: "自動擲骰系統",    desc: "內建擲骰與判定，公平公正更流暢。" },
  { icon: "📖", title: "動態劇情分支",    desc: "你的選擇將改變故事，解鎖多重結局。" },
];

const ALL = "全部";

// ─── Hero ─────────────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <div className="-mx-4 -mt-8">
      <div className="relative overflow-hidden" style={{ background: "#0c0a07" }}>
        {/* Hand-built SVG atmosphere: occult circle + city silhouette + fog */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: "url('/hero-bg.svg')", backgroundSize: "cover", backgroundPosition: "center" }} />

        {/* Subtle grid texture on top */}
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none"
          style={{ backgroundImage: "linear-gradient(#c9a96e 1px,transparent 1px),linear-gradient(90deg,#c9a96e 1px,transparent 1px)", backgroundSize: "48px 48px" }} />

        <div className="relative max-w-6xl mx-auto px-4 py-16">
          <div className="flex items-start gap-10">
            {/* Left */}
            <div className="flex-1 min-w-0">
              {/* Decorative top line */}
              <div className="flex items-center gap-3 mb-5">
                <div className="h-px w-8 bg-gold/40" />
                <span className="text-gold/50 text-xs tracking-[0.2em] uppercase font-medium">Scenario Library</span>
              </div>

              <h1 className="font-serif text-gold leading-none mb-5" style={{ fontSize: "clamp(3.5rem,7vw,5.5rem)", letterSpacing: "0.15em" }}>
                劇本庫
              </h1>
              <p className="text-zinc-400 text-base mb-7 leading-relaxed max-w-md">
                解封都市怪談檔案，選擇你的下一場冒險。
              </p>
              <div className="flex items-center gap-2 text-gold/40 text-sm">
                <span className="w-4 h-4 border border-gold/30 rounded-full flex items-center justify-center text-[9px]">✦</span>
                AI GM 驅動的沉浸式劇本體驗
              </div>
            </div>

            {/* Right: feature boxes */}
            <div className="grid grid-cols-2 gap-3 w-[460px] shrink-0">
              {FEATURES.map((f) => (
                <div key={f.title}
                  className="rounded-xl p-4 transition-colors group cursor-default"
                  style={{ background: "rgba(26,21,14,0.8)", border: "1px solid rgba(201,169,110,0.12)" }}
                >
                  <div className="text-2xl mb-2.5">{f.icon}</div>
                  <div className="text-gold text-sm font-semibold mb-1">{f.title}</div>
                  <div className="text-zinc-600 text-xs leading-relaxed">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom shimmer line */}
        <div className="h-px" style={{ background: "linear-gradient(90deg,transparent,rgba(201,169,110,0.35),transparent)" }} />
      </div>
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function FilterBar({ genres, activeGenre, onGenre, difficulty, onDifficulty, maxPlayers, onMaxPlayers, duration, onDuration }: {
  genres: string[]; activeGenre: string; onGenre: (g: string) => void;
  difficulty: string; onDifficulty: (v: string) => void;
  maxPlayers: string; onMaxPlayers: (v: string) => void;
  duration: string; onDuration: (v: string) => void;
}) {
  const selCls = "text-sm rounded-lg px-3 py-2 pr-8 appearance-none cursor-pointer focus:outline-none transition-colors"
    + " bg-[#1a150e] border border-[#3a2e1e] text-zinc-400 hover:border-[#5a4a30] hover:text-zinc-200";
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap py-5 border-b border-[#2a2010]">
      {/* Genre tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {[ALL, ...genres].map((g) => (
          <button key={g} onClick={() => onGenre(g)}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={activeGenre === g
              ? { background: "#c9a96e", color: "#0c0a07", boxShadow: "0 0 16px rgba(201,169,110,0.25)" }
              : { background: "#1a150e", border: "1px solid #3a2e1e", color: "#a1a1aa" }
            }
          >
            {g}
          </button>
        ))}
      </div>

      {/* Dropdowns */}
      <div className="flex items-center gap-2">
        {[
          { val: difficulty, set: onDifficulty, label: "所有難度", opts: [["","所有難度"],["Story","Story"],["Normal","Normal"],["Hard","Hard"],["Nightmare","Nightmare"]] },
          { val: maxPlayers, set: onMaxPlayers, label: "所有人數", opts: [["","所有人數"],["2","≤ 2人"],["4","≤ 4人"],["6","≤ 6人"]] },
          { val: duration,   set: onDuration,   label: "所有時長", opts: [["","所有時長"],["60","≤ 1小時"],["120","≤ 2小時"],["999","2小時以上"]] },
        ].map(({ val, set, opts }) => (
          <div key={opts[0][1]} className="relative">
            <select value={val} onChange={(e) => set(e.target.value)} className={selCls}>
              {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none text-[10px]">▾</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Scenario card ────────────────────────────────────────────────────────────

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const caseId = toCaseId(scenario.id, scenario.genre);
  const diffCls = DIFFICULTY_STYLE[scenario.difficulty ?? ""] ?? "text-zinc-500";
  const playTime = scenario.estimated_play_time
    ? scenario.estimated_play_time >= 60
      ? `~${Math.round((scenario.estimated_play_time / 60) * 10) / 10}h`
      : `~${scenario.estimated_play_time}min`
    : "—";

  return (
    <Link href={`/scenarios/${scenario.id}`} className="group block">
      <div className="rounded-xl overflow-hidden h-full flex flex-col transition-all duration-300 group-hover:translate-y-[-2px]"
        style={{
          background: "#13100b",
          border: "1px solid #2e2416",
          boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        }}
      >
        {/* ── Cover image ── */}
        <div className="relative overflow-hidden shrink-0" style={{ height: "200px" }}>
          {scenario.cover_image_url ? (
            <img
              src={scenario.cover_image_url}
              alt={scenario.title}
              className="w-full h-full object-cover opacity-80 group-hover:opacity-95 group-hover:scale-105 transition-all duration-500"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #1a1510 0%, #0e0b08 100%)" }}>
              <div className="absolute inset-0 opacity-[0.06]"
                style={{ backgroundImage: "radial-gradient(circle, #c9a96e 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
              <span className="font-serif font-bold select-none" style={{ fontSize: "6rem", color: "rgba(201,169,110,0.07)" }}>
                {scenario.title.slice(0, 1)}
              </span>
            </div>
          )}
          {/* Gradient overlay bottom */}
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, #13100b 0%, rgba(19,16,11,0.3) 55%, transparent 100%)" }} />

          {/* CASE FILE badge */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-mono tracking-widest"
            style={{ background: "rgba(0,0,0,0.75)", border: "1px solid rgba(201,169,110,0.2)", color: "rgba(201,169,110,0.65)", backdropFilter: "blur(4px)" }}>
            CASE FILE&nbsp;&nbsp;{caseId}
          </div>

          {/* Status */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded text-[10px]"
            style={{ background: "rgba(0,0,0,0.75)", border: "1px solid rgba(52,211,153,0.2)", color: "#6ee7b7", backdropFilter: "blur(4px)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            可遊玩
          </div>
        </div>

        {/* ── Body ── */}
        <div className="p-4 flex flex-col flex-1">
          {/* Genre */}
          <span className="inline-block mb-3 text-[10px] px-2 py-0.5 rounded tracking-wide"
            style={{ background: "#1e1912", border: "1px solid #2e2416", color: "#71717a" }}>
            {scenario.genre}
          </span>

          <div className="flex gap-3 flex-1">
            {/* Left: title + description */}
            <div className="flex-1 min-w-0 flex flex-col">
              <h3 className="font-display text-xl mb-2 leading-snug line-clamp-1 group-hover:text-gold transition-colors duration-200"
                style={{ color: "#e4e0d8", fontWeight: 700 }}>
                {scenario.title}
              </h3>
              <p className="text-xs leading-relaxed line-clamp-4 flex-1" style={{ color: "#525046" }}>
                {scenario.description}
              </p>
            </div>

            {/* Right: info panel — case-file style */}
            <div className="w-[96px] shrink-0 pl-3 space-y-2.5" style={{ borderLeft: "1px solid #2a2010" }}>
              {[
                { label: "危險等級", value: scenario.difficulty ?? "—", cls: diffCls },
                { label: "建議人數", value: `${scenario.max_players} 人`, cls: "text-zinc-300" },
                { label: "預計時長", value: playTime, cls: "text-zinc-300" },
                { label: "狀態",     value: "可遊玩", cls: "text-emerald-400" },
              ].map(({ label, value, cls }) => (
                <div key={label}>
                  <div className="text-[8px] uppercase tracking-widest mb-0.5" style={{ color: "#3a3428" }}>{label}</div>
                  <div className={`text-[11px] font-medium leading-tight ${cls}`}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Tags */}
          {scenario.tags && scenario.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {scenario.tags.slice(0, 4).map((tag) => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: "#0e0c08", border: "1px solid #2a2010", color: "#52504a" }}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* CTA */}
          <div className="mt-4 w-full py-2.5 rounded-lg text-sm text-center font-medium transition-all duration-200"
            style={{
              background: "#1a1510",
              border: "1px solid #2e2416",
              color: "#5a5248",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(201,169,110,0.45)";
              (e.currentTarget as HTMLDivElement).style.color = "#c9a96e";
              (e.currentTarget as HTMLDivElement).style.background = "#1e1a0e";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "#2e2416";
              (e.currentTarget as HTMLDivElement).style.color = "#5a5248";
              (e.currentTarget as HTMLDivElement).style.background = "#1a1510";
            }}
          >
            查看詳情 →
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [activeGenre, setActiveGenre] = useState(ALL);
  const [difficulty, setDifficulty] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("");
  const [duration, setDuration] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("scenarios")
        .select("id, title, genre, description, max_players, difficulty, estimated_play_time, tags, cover_image_url")
        .eq("status", "published")
        .order("created_at", { ascending: false });
      const list = (data ?? []) as Scenario[];
      setScenarios(list);
      setGenres(Array.from(new Set(list.map((s) => s.genre))));
      setLoading(false);
    }
    load();
  }, []);

  let filtered = activeGenre === ALL ? scenarios : scenarios.filter((s) => s.genre === activeGenre);
  if (difficulty) filtered = filtered.filter((s) => s.difficulty === difficulty);
  if (maxPlayers) filtered = filtered.filter((s) => s.max_players <= parseInt(maxPlayers));
  if (duration) {
    const max = parseInt(duration);
    filtered = filtered.filter((s) =>
      max === 999 ? (s.estimated_play_time ?? 0) > 120 : (s.estimated_play_time ?? 0) <= max
    );
  }

  return (
    <div>
      <HeroSection />
      <FilterBar genres={genres} activeGenre={activeGenre} onGenre={setActiveGenre}
        difficulty={difficulty} onDifficulty={setDifficulty}
        maxPlayers={maxPlayers} onMaxPlayers={setMaxPlayers}
        duration={duration} onDuration={setDuration} />

      {loading ? (
        <div className="text-center py-24 text-zinc-700 text-sm">載入劇本中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24 text-zinc-700">找不到符合條件的劇本。</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 pt-6 pb-12">
          {filtered.map((s) => <ScenarioCard key={s.id} scenario={s} />)}
        </div>
      )}

      <div className="pt-4 pb-10 text-center">
        <div className="h-px mb-5" style={{ background: "linear-gradient(90deg,transparent,rgba(201,169,110,0.2),transparent)" }} />
        <p className="text-xs" style={{ color: "#3a3428" }}>更多精彩劇本持續更新中，敬請期待你的下一段冒險。</p>
      </div>
    </div>
  );
}
