"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Drama, Layers, Hourglass, Check, ArrowRight } from "lucide-react";
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
  cthulhu_knowledge?: number | null;
  mythos_skills?: string[] | null;
}

const OCCUPATION_ICON: Record<string, string> = {
  "記者":     "/reporter.png",
  "警探":     "/detective.png",
  "大學生":   "/student.png",
  "醫生":     "/doctor.png",
  "黑幫成員": "/gangster.png",
  "風水師":   "/fengshui.png",
  "退役軍人": "/veteran.png",
  "YouTuber": "/youtuber.png",
  "前邪教成員":"/cultist.png",
  "賭徒":     "/gambler.png",
  "走私司機": "/smuggler.png",
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
  const [busyCardIds, setBusyCardIds] = useState<Set<string>>(new Set());
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
      // Cards away on an interlude mission can't join a room (a DB trigger
      // also enforces this server-side; here we just grey them out).
      const { data: missions } = await supabase
        .from("card_missions")
        .select("card_id")
        .eq("user_id", user.id)
        .is("claimed_at", null);
      setBusyCardIds(new Set((missions ?? []).map((m: any) => m.card_id as string)));
      setLoading(false);
    }
    load();
  }, [params.id, router]);

  async function confirmCard() {
    if (!selectedId) return;
    setConfirming(true); setError(null);

    // SECURITY: the server derives every stat from the card row itself — the
    // client only names WHICH card (phase-2 hardening; direct `characters`
    // inserts are policy-blocked).
    try {
      const res = await fetch(`/api/rooms/${params.id}/select-card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: selectedId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Failed to select card.");
        setConfirming(false); return;
      }
    } catch {
      setError("網路錯誤，請再試一次。");
      setConfirming(false); return;
    }

    router.push(`/rooms/${params.id}`);
  }

  if (loading) return <div className="text-center text-zinc-600 py-20">載入調查員中...</div>;

  if (cards.length === 0) {
    return (
      <div className="max-w-lg mx-auto text-center py-24">
        <div className="mb-4 opacity-50 flex justify-center"><Layers size={48} strokeWidth={1.5} /></div>
        <h2 className="font-serif text-2xl mb-2" style={{ color: "#e4d8be" }}>尚無調查員</h2>
        <p className="text-zinc-500 mb-6">你需要至少一位調查員才能遊玩。請先抽取每日卡。</p>
        <Link href="/characters"
          className="inline-flex items-center gap-1 px-6 py-3 rounded-lg font-serif text-sm transition-all hover:brightness-110"
          style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07" }}>
          前往我的調查員 <ArrowRight size={16} strokeWidth={2} />
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
          const busy = busyCardIds.has(card.id);
          return (
            <button
              key={card.id}
              disabled={busy}
              onClick={() => setSelectedId(isSelected ? null : card.id)}
              className="text-left relative rounded-xl p-5 transition-all disabled:cursor-not-allowed"
              style={{
                ...PANEL,
                border: isSelected ? `1px solid ${accent.frame}` : "1px solid #2e2416",
                boxShadow: isSelected ? `0 0 24px ${accent.selectedGlow}, 0 4px 24px rgba(0,0,0,0.4)` : "0 4px 16px rgba(0,0,0,0.3)",
                transform: isSelected ? "translateY(-2px)" : undefined,
                opacity: busy ? 0.45 : undefined,
              }}
            >
              {/* Inner ornate frame */}
              <div className="absolute inset-[6px] rounded-lg pointer-events-none"
                style={{ border: `1px solid ${accent.frame}` }} />
              {busy && (
                <span className="absolute top-3 right-3 z-10 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(40,34,24,0.95)", border: "1px solid rgba(201,169,110,0.4)", color: "#c9a96e" }}>
                  <Hourglass size={11} strokeWidth={2} /> 出任務中
                </span>
              )}

              <div className="relative">
                {/* Name + rarity chip */}
                <div className="flex items-center gap-3 mb-4">
                  {card.occupation && OCCUPATION_ICON[card.occupation] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={OCCUPATION_ICON[card.occupation]} alt={card.occupation}
                      width={64} height={64} className="shrink-0 rounded-xl"
                      style={{ objectFit: "cover", border: "1px solid rgba(201,169,110,0.25)" }} />
                  ) : (
                    <div className="w-16 h-16 shrink-0 rounded-xl flex items-center justify-center"
                      style={{ background: "rgba(14,12,8,0.6)", border: "1px solid rgba(201,169,110,0.2)" }}>
                      <Drama size={22} strokeWidth={1.5} className="opacity-40" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-serif text-base truncate" style={{ color: "#e4d8be" }}>{card.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded border bg-black/30 shrink-0 ${accent.chip}`}>{card.rarity}</span>
                    </div>
                    {card.occupation && (
                      <p className="text-sm mt-0.5" style={{ color: "rgba(201,169,110,0.65)" }}>{card.occupation}</p>
                    )}
                  </div>
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
                  {isSelected && <span className="inline-flex items-center gap-1 font-medium" style={{ color: "#6ee7b7" }}>已選擇 <Check size={13} strokeWidth={2} /></span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Confirm bar — sticky to the bottom of the viewport so it's always
          reachable on phones without scrolling the full card list. */}
      <div
        className="sticky bottom-0 z-20 -mx-4 px-4 pt-4 pb-4 sm:pb-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-5"
        style={{ background: "linear-gradient(180deg, rgba(12,10,7,0) 0%, rgba(12,10,7,0.92) 30%, #0c0a07 100%)" }}
      >
        <button
          onClick={confirmCard}
          disabled={!selectedId || confirming}
          className="inline-flex items-center justify-center gap-1 w-full sm:w-auto px-8 py-3 rounded-lg font-serif text-base transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 18px rgba(201,169,110,0.2)" }}
        >
          {confirming ? "進入房間中..." : selected ? (<>出戰：{selected.name} <ArrowRight size={16} strokeWidth={2} /></>) : "選擇一位調查員以繼續"}
        </button>
        <Link href="/characters" className="text-center sm:text-left text-sm transition-colors text-zinc-600 hover:text-zinc-300">
          抽取更多調查員
        </Link>
      </div>
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
