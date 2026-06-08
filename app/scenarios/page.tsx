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
  {
    icon: "🤖",
    title: "AI GM 智能主持",
    desc: "智能生成劇情與場景，讓每次跑團都獨一無二。",
  },
  {
    icon: "👥",
    title: "多人協作跑團",
    desc: "與好友即時協作，共創精彩故事。",
  },
  {
    icon: "🎲",
    title: "自動擲骰系統",
    desc: "內建擲骰與判定，公平公正更流暢。",
  },
  {
    icon: "📖",
    title: "動態劇情分支",
    desc: "你的選擇將改變故事，解鎖多重結局。",
  },
];

const ALL = "全部";

function HeroSection() {
  return (
    <div className="-mx-4 -mt-8 border-b border-surface-border">
      <div className="relative overflow-hidden bg-gradient-to-br from-[#120f09] via-[#0e0c08] to-[#0c0a07]">
        <div className="absolute top-0 left-1/3 w-96 h-96 bg-gold/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-amber-900/10 rounded-full blur-2xl pointer-events-none" />
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: "linear-gradient(#c9a96e 1px, transparent 1px), linear-gradient(90deg, #c9a96e 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
        <div className="relative max-w-6xl mx-auto px-4 py-14">
          <div className="flex items-center gap-12">
            <div className="flex-1 min-w-0">
              <h1 className="font-serif text-7xl font-bold text-gold tracking-widest leading-none mb-4">
                劇本庫
              </h1>
              <p className="text-zinc-400 text-lg mb-6 leading-relaxed">
                解封都市怪談檔案，選擇你的下一場冒險。
              </p>
              <div className="flex items-center gap-2 text-gold/50 text-sm">
                <span className="w-5 h-5 border border-gold/30 rounded-full flex items-center justify-center text-[10px] shrink-0">✦</span>
                AI GM 驅動的沉浸式劇本體驗
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 w-[460px] shrink-0">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="bg-surface-card/60 border border-surface-border hover:border-gold/25 rounded-xl p-4 transition-colors group"
                >
                  <div className="text-2xl mb-2">{f.icon}</div>
                  <div className="text-gold text-sm font-semibold mb-1">{f.title}</div>
                  <div className="text-zinc-600 text-xs leading-relaxed">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent" />
      </div>
    </div>
  );
}

function FilterBar({
  genres, activeGenre, onGenre,
  difficulty, onDifficulty,
  maxPlayers, onMaxPlayers,
  duration, onDuration,
}: {
  genres: string[]; activeGenre: string; onGenre: (g: string) => void;
  difficulty: string; onDifficulty: (v: string) => void;
  maxPlayers: string; onMaxPlayers: (v: string) => void;
  duration: string; onDuration: (v: string) => void;
}) {
  const sel = "bg-surface-card border border-surface-border text-zinc-400 text-sm rounded-lg px-3 py-2 pr-7 appearance-none cursor-pointer hover:border-zinc-600 focus:outline-none focus:border-gold/40 transition-colors";
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap py-5">
      <div className="flex items-center gap-2 flex-wrap">
        {[ALL, ...genres].map((g) => (
          <button
            key={g}
            onClick={() => onGenre(g)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeGenre === g
                ? "bg-gold text-[#0c0a07] shadow-lg shadow-gold/20"
                : "bg-surface-card border border-surface-border text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            }`}
          >
            {g}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <select value={difficulty} onChange={(e) => onDifficulty(e.target.value)} className={sel}>
            <option value="">所有難度</option>
            <option value="Story">Story</option>
            <option value="Normal">Normal</option>
            <option value="Hard">Hard</option>
            <option value="Nightmare">Nightmare</option>
          </select>
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none text-xs">▾</span>
        </div>
        <div className="relative">
          <select value={maxPlayers} onChange={(e) => onMaxPlayers(e.target.value)} className={sel}>
            <option value="">所有人數</option>
            <option value="2">≤ 2人</option>
            <option value="4">≤ 4人</option>
            <option value="6">≤ 6人</option>
          </select>
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none text-xs">▾</span>
        </div>
        <div className="relative">
          <select value={duration} onChange={(e) => onDuration(e.target.value)} className={sel}>
            <option value="">所有時長</option>
            <option value="60">≤ 1小時</option>
            <option value="120">≤ 2小時</option>
            <option value="999">2小時以上</option>
          </select>
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none text-xs">▾</span>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, valueCls = "text-zinc-300" }: { label: string; value: string; valueCls?: string }) {
  return (
    <div>
      <div className="text-[9px] text-zinc-700 uppercase tracking-wider mb-0.5">{label}</div>
      <div className={`text-xs font-medium leading-tight ${valueCls}`}>{value}</div>
    </div>
  );
}

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const caseId = toCaseId(scenario.id, scenario.genre);
  const diffCls = DIFFICULTY_STYLE[scenario.difficulty ?? ""] ?? "text-zinc-400";
  const playTime = scenario.estimated_play_time
    ? scenario.estimated_play_time >= 60
      ? `~${Math.round((scenario.estimated_play_time / 60) * 10) / 10}h`
      : `~${scenario.estimated_play_time}min`
    : "—";

  return (
    <Link href={`/scenarios/${scenario.id}`} className="group block">
      <div className="bg-surface border border-surface-border rounded-xl overflow-hidden hover:border-gold/30 transition-all duration-300 h-full flex flex-col">
        {/* Cover */}
        <div className="relative h-44 bg-gradient-to-br from-surface-hover to-surface-dark overflow-hidden shrink-0">
          {scenario.cover_image_url ? (
            <img
              src={scenario.cover_image_url}
              alt={scenario.title}
              className="w-full h-full object-cover opacity-75 group-hover:opacity-90 group-hover:scale-105 transition-all duration-500"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="absolute inset-0 opacity-[0.04]"
                style={{ backgroundImage: "radial-gradient(circle, #c9a96e 1px, transparent 1px)", backgroundSize: "24px 24px" }}
              />
              <span className="font-serif text-8xl font-bold text-gold/10 select-none">{scenario.title.slice(0, 1)}</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-transparent" />
          <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-sm border border-surface-border text-gold/60 text-[9px] font-mono tracking-widest px-2 py-1 rounded">
            CASE FILE&nbsp;&nbsp;{caseId}
          </div>
          <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm border border-surface-border px-2 py-1 rounded text-[10px] text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            可遊玩
          </div>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col flex-1">
          <div className="mb-3">
            <span className="text-[10px] bg-surface-hover border border-surface-border text-zinc-500 px-2 py-0.5 rounded tracking-wide">
              {scenario.genre}
            </span>
          </div>

          <div className="flex gap-4 flex-1">
            <div className="flex-1 min-w-0 flex flex-col">
              <h3 className="text-white font-bold text-base mb-2 group-hover:text-gold transition-colors line-clamp-1">
                {scenario.title}
              </h3>
              <p className="text-zinc-600 text-xs leading-relaxed line-clamp-3 flex-1">{scenario.description}</p>
            </div>
            <div className="w-[100px] shrink-0 border-l border-surface-border pl-3 space-y-2.5">
              <InfoRow label="危險等級" value={scenario.difficulty ?? "—"} valueCls={diffCls} />
              <InfoRow label="建議人數" value={`${scenario.max_players} 人`} />
              <InfoRow label="預計時長" value={playTime} />
              <InfoRow label="狀態" value="可遊玩" valueCls="text-emerald-400" />
            </div>
          </div>

          {scenario.tags && scenario.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {scenario.tags.slice(0, 4).map((tag) => (
                <span key={tag} className="text-[10px] bg-surface-dark border border-surface-border text-zinc-600 px-1.5 py-0.5 rounded">
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 w-full bg-surface-hover border border-surface-border group-hover:border-gold/40 group-hover:bg-[#1e1a0f] text-zinc-500 group-hover:text-gold py-2.5 rounded-lg text-sm text-center transition-all duration-200 font-medium">
            查看詳情 →
          </div>
        </div>
      </div>
    </Link>
  );
}

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
      <FilterBar
        genres={genres} activeGenre={activeGenre} onGenre={setActiveGenre}
        difficulty={difficulty} onDifficulty={setDifficulty}
        maxPlayers={maxPlayers} onMaxPlayers={setMaxPlayers}
        duration={duration} onDuration={setDuration}
      />
      {loading ? (
        <div className="text-center text-zinc-700 text-sm py-24">載入劇本中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-zinc-600 py-24">找不到符合條件的劇本。</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 pb-12">
          {filtered.map((s) => <ScenarioCard key={s.id} scenario={s} />)}
        </div>
      )}
      <div className="border-t border-surface-border pt-6 pb-8 text-center">
        <div className="h-px bg-gradient-to-r from-transparent via-gold/20 to-transparent mb-5" />
        <p className="text-zinc-700 text-sm">更多精彩劇本持續更新中，敬請期待你的下一段冒險。</p>
      </div>
    </div>
  );
}
