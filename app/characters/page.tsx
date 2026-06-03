"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface CharacterCard {
  id: string;
  name: string;
  hp: number;
  san: number;
  str: number;
  agi: number;
  int: number;
  cha: number;
  luck: number;
  speed: number;
  total_stats: number;
  rarity: "Common" | "Rare" | "Epic" | "Legendary";
  created_at: string;
}

const RARITY_STYLES: Record<CharacterCard["rarity"], { border: string; chip: string; glow: string }> = {
  Common:    { border: "border-slate-600",  chip: "bg-slate-700 text-slate-300 border-slate-600",       glow: "" },
  Rare:      { border: "border-sky-600",    chip: "bg-sky-900/50 text-sky-300 border-sky-700",          glow: "shadow-lg shadow-sky-900/30" },
  Epic:      { border: "border-purple-600", chip: "bg-purple-900/50 text-purple-300 border-purple-700", glow: "shadow-lg shadow-purple-900/40" },
  Legendary: { border: "border-amber-500",  chip: "bg-amber-900/50 text-amber-300 border-amber-600",    glow: "shadow-xl shadow-amber-900/50" },
};

const STAT_KEYS = ["str", "agi", "int", "cha", "luck", "speed"] as const;

function isSameUtcDay(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

export default function CharactersPage() {
  const router = useRouter();
  const [cards, setCards] = useState<CharacterCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<CharacterCard | null>(null);

  async function loadCards() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/auth"); return; }
    const { data } = await supabase
      .from("character_cards")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setCards((data as CharacterCard[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openedToday = cards.some((c) => isSameUtcDay(c.created_at));

  async function openCard() {
    setOpening(true);
    setError(null);
    setRevealed(null);
    try {
      const res = await fetch("/api/characters/open", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not open a card right now.");
      } else {
        setRevealed(data.card as CharacterCard);
        await loadCards();
      }
    } catch {
      setError("Network error — please try again.");
    }
    setOpening(false);
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">My Character Cards</h1>
          <p className="text-slate-400 text-sm mt-1">Open one new card per day. Stats are rolled by dice and locked forever.</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={openCard}
            disabled={opening || openedToday}
            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium transition-colors"
          >
            {opening ? "Rolling dice..." : openedToday ? "Card opened today ✓" : "Open Today's Character Card"}
          </button>
          {openedToday && (
            <span className="text-xs text-slate-500">Come back tomorrow (UTC) for your next card.</span>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-6">{error}</div>
      )}

      {revealed && (
        <div className="mb-8">
          <p className="text-xs text-purple-400 uppercase tracking-wider mb-2">New card unlocked!</p>
          <CardView card={revealed} highlight />
        </div>
      )}

      {loading ? (
        <div className="text-slate-500 text-sm">Loading your collection...</div>
      ) : cards.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-slate-700 rounded-xl">
          <div className="text-4xl mb-3">🎴</div>
          <p className="text-slate-400">You have no character cards yet.</p>
          <p className="text-slate-500 text-sm mt-1">Open your first card to start your collection.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-500 mb-3">{cards.length} card{cards.length !== 1 ? "s" : ""} in your collection</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map((card) => (
              <CardView key={card.id} card={card} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CardView({ card, highlight }: { card: CharacterCard; highlight?: boolean }) {
  const style = RARITY_STYLES[card.rarity];
  return (
    <div className={`bg-slate-800/50 border ${style.border} ${style.glow} rounded-xl p-4 ${highlight ? "ring-2 ring-purple-500" : ""}`}>
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-white font-semibold">{card.name}</h3>
        <span className={`text-xs px-2 py-0.5 rounded border ${style.chip}`}>{card.rarity}</span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 mb-3">
        <StatBox label="HP" value={card.hp} />
        <StatBox label="SAN" value={card.san} />
      </div>

      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {STAT_KEYS.map((k) => (
          <StatBox key={k} label={k.toUpperCase()} value={card[k]} />
        ))}
      </div>

      <div className="flex items-center justify-between text-xs border-t border-slate-700 pt-2">
        <span className="text-slate-400">
          Total <span className="text-white font-bold">{card.total_stats}</span>
        </span>
        <span className="text-slate-600">
          {new Date(card.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
        </span>
      </div>

      <button
        disabled
        title="Playing with cards in rooms is coming soon"
        className="w-full mt-3 bg-slate-700/60 text-slate-400 text-sm py-2 rounded-lg cursor-not-allowed"
      >
        Play with this card (coming soon)
      </button>
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
