"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CardRollReveal, RevealCard } from "@/components/CardRollReveal";

interface CharacterCard {
  id: string;
  name: string;
  str: number; con: number; siz: number; dex: number; app: number;
  int: number; pow: number; edu: number; luck: number;
  hp: number; san: number; mp: number;
  total_stats: number;
  rarity: "Common" | "Rare" | "Epic" | "Legendary";
  roll_details: RevealCard["roll_details"];
  skill_points: number;
  skills: Record<string, number> | null;
  created_at: string;
}

const RARITY_STYLES: Record<CharacterCard["rarity"], { border: string; chip: string; glow: string }> = {
  Common:    { border: "border-slate-600",  chip: "bg-slate-700 text-slate-300 border-slate-600",       glow: "" },
  Rare:      { border: "border-sky-600",    chip: "bg-sky-900/50 text-sky-300 border-sky-700",          glow: "shadow-lg shadow-sky-900/30" },
  Epic:      { border: "border-purple-600", chip: "bg-purple-900/50 text-purple-300 border-purple-700", glow: "shadow-lg shadow-purple-900/40" },
  Legendary: { border: "border-amber-500",  chip: "bg-amber-900/50 text-amber-300 border-amber-600",    glow: "shadow-xl shadow-amber-900/50" },
};

const STAT_KEYS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"] as const;

function isSameUtcDay(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear()
    && d.getUTCMonth() === now.getUTCMonth()
    && d.getUTCDate() === now.getUTCDate();
}

export default function CharactersPage() {
  const router = useRouter();
  const [cards, setCards] = useState<CharacterCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<CharacterCard | null>(null);
  const [rolling, setRolling] = useState<CharacterCard | null>(null);

  async function loadCards() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    const { data } = await supabase
      .from("character_cards")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setCards((data as CharacterCard[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { loadCards(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        // Show the step-by-step dice reveal first; card is persisted server-side already.
        setRolling(data.card as CharacterCard);
      }
    } catch {
      setError("網路錯誤，請再試一次。");
    }
    setOpening(false);
  }

  async function finishReveal() {
    const card = rolling;
    setRolling(null);
    if (card) setRevealed(card);
    await loadCards();
  }

  function handleNameSaved(id: string, newName: string) {
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, name: newName } : c));
    if (revealed?.id === id) setRevealed((r) => r ? { ...r, name: newName } : r);
  }

  return (
    <div className="max-w-5xl mx-auto">
      {rolling && (
        <CardRollReveal card={rolling as unknown as RevealCard} onDone={finishReveal} />
      )}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">我的角色卡</h1>
          <p className="text-slate-400 text-sm mt-1">每天可抽取一張新卡。屬性由骰子決定，永久鎖定。</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={openCard}
            disabled={opening || openedToday}
            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium transition-colors"
          >
            {opening ? "擲骰中..." : openedToday ? "今日已抽卡 ✓" : "抽取今日角色卡"}
          </button>
          {openedToday && (
            <span className="text-xs text-slate-500">明天（UTC）再來抽取下一張卡。</span>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-6">{error}</div>
      )}

      {revealed && (
        <div className="mb-8">
          <p className="text-xs text-purple-400 uppercase tracking-wider mb-2">獲得新角色卡！</p>
          <div className="max-w-xs">
            <CardView card={revealed} highlight onNameSaved={handleNameSaved} />
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-slate-500 text-sm">載入收藏中...</div>
      ) : cards.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-slate-700 rounded-xl">
          <div className="text-4xl mb-3">🎴</div>
          <p className="text-slate-400">你還沒有任何角色卡。</p>
          <p className="text-slate-500 text-sm mt-1">抽取第一張卡開始你的收藏。</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-500 mb-3">共 {cards.length} 張角色卡</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map((card) => (
              <CardView key={card.id} card={card} onNameSaved={handleNameSaved} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CardView({
  card,
  highlight,
  onNameSaved,
}: {
  card: CharacterCard;
  highlight?: boolean;
  onNameSaved?: (id: string, newName: string) => void;
}) {
  const style = RARITY_STYLES[card.rarity];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.name);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(card.name);
    setNameError(null);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  async function saveName() {
    const trimmed = draft.trim();
    if (!trimmed) { setNameError("名稱不可為空。"); return; }
    if (trimmed === card.name) { setEditing(false); return; }
    setSaving(true);
    setNameError(null);
    try {
      const res = await fetch(`/api/characters/${card.id}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNameError(data.error ?? "儲存失敗。");
      } else {
        setEditing(false);
        onNameSaved?.(card.id, data.card.name);
      }
    } catch {
      setNameError("網路錯誤。");
    }
    setSaving(false);
  }

  return (
    <div className={`bg-slate-800/50 border ${style.border} ${style.glow} rounded-xl p-4 flex flex-col gap-0 ${highlight ? "ring-2 ring-purple-500" : ""}`}>
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex flex-col gap-1">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") setEditing(false);
                }}
                maxLength={40}
                className="w-full bg-slate-900 border border-purple-500 rounded px-2 py-1 text-white text-sm focus:outline-none"
              />
              {nameError && <span className="text-red-400 text-xs">{nameError}</span>}
              <div className="flex gap-2 mt-0.5">
                <button
                  onClick={saveName}
                  disabled={saving}
                  className="text-xs bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-2 py-0.5 rounded"
                >
                  {saving ? "儲存中…" : "儲存"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="text-white font-semibold truncate">{card.name}</h3>
              <button
                onClick={startEdit}
                title="Rename card"
                className="text-slate-500 hover:text-slate-300 shrink-0 text-xs leading-none"
              >
                ✎
              </button>
            </div>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded border ${style.chip} shrink-0`}>{card.rarity}</span>
      </div>

      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <StatBox label="HP" value={card.hp} />
        <StatBox label="SAN" value={card.san} />
        <StatBox label="MP" value={card.mp} />
      </div>

      <div className="grid grid-cols-3 gap-1.5 mb-2">
        {STAT_KEYS.map((k) => (
          <StatBox key={k} label={k.toUpperCase()} value={card[k]} />
        ))}
      </div>

      {card.skills && Object.keys(card.skills).length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {Object.entries(card.skills)
            .filter(([, v]) => v > 0)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([k, v]) => (
              <span key={k} className="text-[10px] bg-slate-900/80 border border-slate-700 rounded px-1.5 py-0.5 text-slate-400">
                {k.replace(/_/g, " ")} {v}%
              </span>
            ))}
        </div>
      )}

      <div className="flex items-center justify-between text-xs border-t border-slate-700 pt-2">
        <span className="text-slate-400">
          合計 <span className="text-white font-bold">{card.total_stats}</span>
        </span>
        <span className="text-slate-600">
          {new Date(card.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
        </span>
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
