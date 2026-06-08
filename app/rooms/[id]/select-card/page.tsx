"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface CharacterCard {
  id: string;
  name: string;
  str: number; con: number; siz: number; dex: number; app: number;
  int: number; pow: number; edu: number; luck: number;
  hp: number; san: number; mp: number;
  total_stats: number;
  rarity: "Common" | "Rare" | "Epic" | "Legendary";
  skills: Record<string, number> | null;
  occupation: string | null;
}

const OCCUPATION_ICON: Record<string, string> = {
  "記者":     "📰",
  "警探":     "🔍",
  "大學生":   "📚",
  "醫生":     "🏥",
  "黑幫成員": "🔫",
  "風水師":   "☯️",
  "退役軍人": "🎖️",
  "YouTuber": "📱",
  "前邪教成員":"🕯️",
  "賭徒":     "🃏",
  "走私司機": "🚗",
};

const RARITY_ACCENT: Record<CharacterCard["rarity"], { frame: string; chip: string; selectedGlow: string }> = {
  Common:    { frame: "rgba(201,169,110,0.12)", chip: "border-zinc-600 text-zinc-400",       selectedGlow: "rgba(161,161,170,0.35)" },
  Rare:      { frame: "rgba(56,189,248,0.28)",  chip: "border-sky-600/70 text-sky-300",      selectedGlow: "rgba(56,189,248,0.35)"  },
  Epic:      { frame: "rgba(192,132,252,0.28)", chip: "border-purple-500/70 text-purple-300", selectedGlow: "rgba(192,132,252,0.35)" },
  Legendary: { frame: "rgba(201,169,110,0.45)", chip: "border-amber-500/70 text-amber-300",  selectedGlow: "rgba(201,169,110,0.50)" },
};

const STAT_ZH: Record<string, string> = {
  HP: "生命", SAN: "理智", MP: "魔力",
  STR: "力量", CON: "體質", SIZ: "體型",
  DEX: "敏捷", APP: "外貌", INT: "智力",
  POW: "意志", EDU: "教育", LUCK: "幸運",
};

const STAT_KEYS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"] as const;

const PANEL = {
  background: "linear-gradient(150deg,#1c1813 0%,#13100b 55%,#0f0c08 100%)",
  border: "1px solid #2e2416",
};

export default function SelectCardPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [cards, setCards]         = useState<CharacterCard[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data: existing } = await supabase
        .from("characters").select("id")
        .eq("user_id", user.id).eq("room_id", params.id).single();
      if (existing) { router.push(`/rooms/${params.id}`); return; }

      const { data } = await supabase
        .from("character_cards").select("*")
        .eq("user_id", user.id)
        .order("total_stats", { ascending: false });
      setCards((data as CharacterCard[]) ?? []);
      setLoading(false);
    }
    load();
  }, [params.id, router]);

  async function confirmCard() {
    if (!selectedId) return;
    setConfirming(true); setError(null);
    const card = cards.find((c) => c.id === selectedId)!;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const { data: newChar, error: insertErr } = await supabase
      .from("characters")
      .insert({
        user_id: user.id, room_id: params.id, source_card_id: card.id,
        name: card.name, hp: card.hp, san: card.san, mp: card.mp,
        str: card.str, con: card.con, siz: card.siz, dex: card.dex,
        app: card.app, int: card.int, pow: card.pow, edu: card.edu,
        luck: card.luck, skills: card.skills ?? {}, occupation: card.occupation ?? null,
      })
      .select("id").single();

    if (insertErr || !newChar) {
      setError(insertErr?.message ?? "Failed to select card.");
      setConfirming(false); return;
    }

    await supabase.from("room_players")
      .update({ character_id: newChar.id })
      .eq("room_id", params.id).eq("user_id", user.id);

    router.push(`/rooms/${params.id}`);
  }

  if (loading) return <div className="text-center text-zinc-600 py-20">載入調查員中...</div>;

  if (cards.length === 0) {
    return (
      <div className="max-w-lg mx-auto text-center py-24">
        <div className="text-5xl mb-4 opacity-50">🎴</div>
        <h2 className="font-serif text-2xl mb-2" style={{ color: "#e4d8be" }}>尚無調查員</h2>
        <p className="text-zinc-500 mb-6">你需要至少一位調查員才能遊玩。請先抽取每日卡。</p>
        <Link href="/characters"
          className="inline-block px-6 py-3 rounded-lg font-serif text-sm transition-all hover:brightness-110"
          style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07" }}>
          前往我的調查員 →
        </Link>
      </div>
    );
  }

  const selected = cards.find((c) => c.id === selectedId);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-px w-6" style={{ background: "rgba(201,169,110,0.3)" }} />
          <span className="text-[10px] tracking-[0.25em] uppercase" style={{ color: "rgba(201,169,110,0.45)" }}>Investigator Select</span>
        </div>
        <h1 className="font-serif text-3xl mb-1.5" style={{ color: "#e4d8be", letterSpacing: "0.04em" }}>選擇你的調查員</h1>
        <p className="text-zinc-500 text-sm">選擇你要在本次冒險中使用的調查員。選定後屬性將永久鎖定。</p>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm mb-6"
          style={{ background: "rgba(127,29,29,0.2)", border: "1px solid rgba(185,28,28,0.4)", color: "#fca5a5" }}>
          {error}
        </div>
      )}

      {/* Card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {cards.map((card) => {
          const accent = RARITY_ACCENT[card.rarity];
          const isSelected = selectedId === card.id;
          return (
            <button
              key={card.id}
              onClick={() => setSelectedId(isSelected ? null : card.id)}
              className="text-left relative rounded-xl p-5 transition-all"
              style={{
                ...PANEL,
                border: isSelected ? `1px solid ${accent.frame}` : "1px solid #2e2416",
                boxShadow: isSelected ? `0 0 24px ${accent.selectedGlow}, 0 4px 24px rgba(0,0,0,0.4)` : "0 4px 16px rgba(0,0,0,0.3)",
                transform: isSelected ? "translateY(-2px)" : undefined,
              }}
            >
              {/* Inner ornate frame */}
              <div className="absolute inset-[6px] rounded-lg pointer-events-none"
                style={{ border: `1px solid ${accent.frame}` }} />

              <div className="relative">
                {/* Name + rarity chip */}
                <div className="flex items-start justify-between mb-4 gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {card.occupation && (
                      <span className="text-2xl leading-none mt-0.5 shrink-0">
                        {OCCUPATION_ICON[card.occupation] ?? "🎭"}
                      </span>
                    )}
                    <div className="min-w-0">
                      <h3 className="font-serif text-base truncate" style={{ color: "#e4d8be" }}>{card.name}</h3>
                      {card.occupation && (
                        <p className="text-[10px] mt-0.5" style={{ color: "rgba(201,169,110,0.65)" }}>{card.occupation}</p>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded border bg-black/30 shrink-0 ${accent.chip}`}>{card.rarity}</span>
                </div>

                {/* HP / SAN / MP */}
                <div className="grid grid-cols-3 gap-x-4 gap-y-px mb-1">
                  {[["HP","生命",card.hp],["SAN","理智",card.san],["MP","魔力",card.mp]].map(([k, zh, v]) => (
                    <StatRow key={k as string} label={zh as string} value={v as number} />
                  ))}
                </div>

                {/* Core stats */}
                <div className="grid grid-cols-3 gap-x-4 gap-y-px mb-3">
                  {STAT_KEYS.map((k) => (
                    <StatRow key={k} label={STAT_ZH[k.toUpperCase()] ?? k.toUpperCase()} value={card[k]} />
                  ))}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between text-xs pt-2"
                  style={{ borderTop: "1px solid #2a2010" }}>
                  <span className="text-zinc-500">合計 <span className="font-bold" style={{ color: "#c9a96e" }}>{card.total_stats}</span></span>
                  {isSelected && <span className="font-medium" style={{ color: "#6ee7b7" }}>已選擇 ✓</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Confirm bar */}
      <div className="flex items-center gap-5">
        <button
          onClick={confirmCard}
          disabled={!selectedId || confirming}
          className="px-8 py-3 rounded-lg font-serif text-base transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 18px rgba(201,169,110,0.2)" }}
        >
          {confirming ? "進入房間中..." : selected ? `出戰：${selected.name} →` : "選擇一位調查員以繼續"}
        </button>
        <Link href="/characters" className="text-sm transition-colors text-zinc-600 hover:text-zinc-300">
          抽取更多調查員
        </Link>
      </div>

      <div className="h-px mt-10" style={{ background: "linear-gradient(90deg,transparent,rgba(201,169,110,0.15),transparent)" }} />
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between items-center py-1" style={{ borderBottom: "1px solid rgba(42,32,16,0.5)" }}>
      <span className="text-[11px]" style={{ color: "rgba(201,169,110,0.45)" }}>{label}</span>
      <span className="text-xs font-semibold" style={{ color: "#e4d8be" }}>{value}</span>
    </div>
  );
}
