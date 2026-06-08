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
}

const RARITY_STYLES: Record<CharacterCard["rarity"], { border: string; chip: string; selected: string }> = {
  Common:    { border: "border-slate-600",  chip: "bg-slate-700 text-slate-300 border-slate-600",       selected: "border-slate-400 ring-2 ring-slate-400" },
  Rare:      { border: "border-sky-700",    chip: "bg-sky-900/50 text-sky-300 border-sky-700",          selected: "border-sky-400 ring-2 ring-sky-400" },
  Epic:      { border: "border-zinc-600", chip: "bg-zinc-800/70 text-white border-zinc-600", selected: "border-zinc-300 ring-2 ring-zinc-400" },
  Legendary: { border: "border-amber-600",  chip: "bg-amber-900/50 text-amber-300 border-amber-600",    selected: "border-amber-400 ring-2 ring-amber-400" },
};

const STAT_KEYS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"] as const;

export default function SelectCardPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [cards, setCards] = useState<CharacterCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      // If this player already has a character in this room, skip straight to game
      const { data: existing } = await supabase
        .from("characters")
        .select("id")
        .eq("user_id", user.id)
        .eq("room_id", params.id)
        .single();
      if (existing) { router.push(`/rooms/${params.id}`); return; }

      const { data } = await supabase
        .from("character_cards")
        .select("*")
        .eq("user_id", user.id)
        .order("total_stats", { ascending: false });
      setCards((data as CharacterCard[]) ?? []);
      setLoading(false);
    }
    load();
  }, [params.id, router]);

  async function confirmCard() {
    if (!selectedId) return;
    setConfirming(true);
    setError(null);

    const card = cards.find((c) => c.id === selectedId)!;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    // Insert the card's stats as a character in this room
    const { data: newChar, error: insertErr } = await supabase
      .from("characters")
      .insert({
        user_id: user.id,
        room_id: params.id,
        source_card_id: card.id,
        name: card.name,
        hp: card.hp,
        san: card.san,
        mp: card.mp,
        str: card.str,
        con: card.con,
        siz: card.siz,
        dex: card.dex,
        app: card.app,
        int: card.int,
        pow: card.pow,
        edu: card.edu,
        luck: card.luck,
        skills: card.skills ?? {},
      })
      .select("id")
      .single();

    if (insertErr || !newChar) {
      setError(insertErr?.message ?? "Failed to select card.");
      setConfirming(false);
      return;
    }

    // Link the character to room_players
    await supabase
      .from("room_players")
      .update({ character_id: newChar.id })
      .eq("room_id", params.id)
      .eq("user_id", user.id);

    router.push(`/rooms/${params.id}`);
  }

  if (loading) return <div className="text-center text-slate-400 py-20">載入調查員中...</div>;

  if (cards.length === 0) {
    return (
      <div className="max-w-lg mx-auto text-center py-20">
        <div className="text-5xl mb-4">🎴</div>
        <h2 className="text-2xl font-bold text-white mb-2">尚無調查員</h2>
        <p className="text-slate-400 mb-6">你需要至少一位調查員才能遊玩。請先抽取每日卡。</p>
        <Link
          href="/characters"
          className="inline-block bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-3 rounded-lg font-medium"
        >
          前往我的卡 →
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-1">選擇你的調查員</h1>
        <p className="text-slate-400 text-sm">選擇你要在本次冒險中使用的調查員。選定後屬性將永久鎖定。</p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {cards.map((card) => {
          const style = RARITY_STYLES[card.rarity];
          const isSelected = selectedId === card.id;
          return (
            <button
              key={card.id}
              onClick={() => setSelectedId(isSelected ? null : card.id)}
              className={`text-left bg-slate-800/50 border rounded-xl p-4 transition-all ${isSelected ? style.selected : `${style.border} hover:border-slate-500`}`}
            >
              <div className="flex items-start justify-between mb-3 gap-2">
                <h3 className="text-white font-semibold truncate">{card.name}</h3>
                <span className={`text-xs px-2 py-0.5 rounded border ${style.chip} shrink-0`}>{card.rarity}</span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 mb-2">
                <StatBox label="HP" value={card.hp} />
                <StatBox label="SAN" value={card.san} />
                <StatBox label="MP" value={card.mp} />
              </div>
              <div className="grid grid-cols-3 gap-1.5 mb-2">
                {STAT_KEYS.map((k) => <StatBox key={k} label={k.toUpperCase()} value={card[k]} />)}
              </div>

              <div className="flex items-center justify-between text-xs border-t border-slate-700 pt-2">
                <span className="text-slate-400">合計 <span className="text-white font-bold">{card.total_stats}</span></span>
                {isSelected && <span className="text-green-400 font-medium">已選擇 ✓</span>}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={confirmCard}
          disabled={!selectedId || confirming}
          className="bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-8 py-3 rounded-lg font-medium text-lg"
        >
          {confirming ? "進入房間中..." : selectedId ? "使用此卡出戰 →" : "選擇一張卡以繼續"}
        </button>
        <Link href="/characters" className="text-sm text-slate-400 hover:text-white">
          抽取更多卡
        </Link>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between bg-slate-900/50 rounded px-2 py-1">
      <span className="text-slate-500 text-xs">{label}</span>
      <span className="text-slate-200 text-xs font-medium">{value}</span>
    </div>
  );
}
