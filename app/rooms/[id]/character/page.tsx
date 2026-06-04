"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const STAT_KEYS = ["hp", "san", "str", "agi", "int", "cha", "luck", "speed"] as const;
type StatKey = typeof STAT_KEYS[number];

const STAT_INFO: Record<StatKey, { label: string; desc: string; min: number; default: number }> = {
  hp:    { label: "HP",    desc: "生命值 — 可承受的傷害",          min: 1, default: 5 },
  san:   { label: "SAN",   desc: "理智值 — 精神抗壓能力",          min: 1, default: 5 },
  str:   { label: "STR",   desc: "力量 — 體能與攻擊力",            min: 1, default: 5 },
  agi:   { label: "AGI",   desc: "敏捷 — 閃避與反應速度",          min: 1, default: 5 },
  int:   { label: "INT",   desc: "智力 — 知識與魔法",              min: 1, default: 5 },
  cha:   { label: "CHA",   desc: "魅力 — 說服與交涉",              min: 1, default: 5 },
  luck:  { label: "LUCK",  desc: "幸運 — 機率與運氣",              min: 1, default: 5 },
  speed: { label: "SPEED", desc: "速度 — 越高越先行動",            min: 1, default: 5 },
};

const TOTAL_POINTS = 50;

type Stats = Record<StatKey, number>;

function sumStats(stats: Stats) {
  return STAT_KEYS.reduce((s, k) => s + stats[k], 0);
}

const DEFAULT_STATS: Stats = Object.fromEntries(
  STAT_KEYS.map((k) => [k, STAT_INFO[k].default])
) as Stats;

export default function CharacterCreationPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [charName, setCharName] = useState("");
  const [background, setBackground] = useState("");
  const [stats, setStats] = useState<Stats>({ ...DEFAULT_STATS });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function check() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      // If character already exists for this room, go straight to game
      const { data } = await supabase
        .from("characters")
        .select("id")
        .eq("user_id", user.id)
        .eq("room_id", params.id)
        .single();
      if (data) { router.push(`/rooms/${params.id}`); return; }
      setChecking(false);
    }
    check();
  }, [params.id, router]);

  const spent = sumStats(stats);
  const remaining = TOTAL_POINTS - spent;

  function adjust(key: StatKey, delta: number) {
    setStats((prev) => {
      const next = prev[key] + delta;
      const min = STAT_INFO[key].min;
      if (next < min) return prev;
      if (delta > 0 && remaining <= 0) return prev;
      return { ...prev, [key]: next };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!charName.trim()) return;
    if (remaining !== 0) { setError("必須精確分配 50 點。"); return; }
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const { error: insertError } = await supabase.from("characters").insert({
      user_id: user.id,
      room_id: params.id,
      name: charName.trim(),
      background: background.trim() || null,
      ...stats,
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    // Update room_players with character reference
    const { data: char } = await supabase
      .from("characters")
      .select("id")
      .eq("user_id", user.id)
      .eq("room_id", params.id)
      .single();

    if (char) {
      await supabase
        .from("room_players")
        .update({ character_id: char.id })
        .eq("room_id", params.id)
        .eq("user_id", user.id);
    }

    router.push(`/rooms/${params.id}`);
  }

  if (checking) return <div className="text-center text-slate-400 py-20">載入中...</div>;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-2">建立你的角色</h1>
      <p className="text-slate-400 mb-8">分配屬性點數，打造你的冒險者。</p>

      <form onSubmit={handleSubmit}>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-4 flex flex-col gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">角色名稱 *</label>
            <input
              value={charName}
              onChange={(e) => setCharName(e.target.value)}
              placeholder="例：木靈·凱拉"
              required
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">背景故事（選填）</label>
            <textarea
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              rows={2}
              placeholder="簡述你角色的過去..."
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none"
            />
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-4">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-white">屬性</h2>
            <span className={`text-sm font-medium px-3 py-1 rounded-full ${remaining === 0 ? "bg-green-900/50 text-green-300 border border-green-700" : remaining < 0 ? "bg-red-900/50 text-red-300 border border-red-700" : "bg-slate-700 text-slate-300"}`}>
              剩餘 {remaining} 點
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {STAT_KEYS.map((key) => (
              <div key={key} className="bg-slate-900/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold text-slate-200">{STAT_INFO[key].label}</span>
                </div>
                <p className="text-xs text-slate-500 mb-2">{STAT_INFO[key].desc}</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => adjust(key, -1)}
                    disabled={stats[key] <= STAT_INFO[key].min}
                    className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 text-white text-lg font-bold flex items-center justify-center"
                  >−</button>
                  <span className="w-10 text-center text-white font-bold text-xl">{stats[key]}</span>
                  <button
                    type="button"
                    onClick={() => adjust(key, 1)}
                    disabled={remaining <= 0}
                    className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 text-white text-lg font-bold flex items-center justify-center"
                  >+</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading || !charName.trim() || remaining !== 0}
          className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium"
        >
          {loading ? "建立中..." : remaining !== 0 ? `${remaining > 0 ? `待分配 ${remaining} 點` : `點數超出 ${Math.abs(remaining)} 點`}` : "確認角色並進入房間"}
        </button>
      </form>
    </div>
  );
}
