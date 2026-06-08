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
  skills: Record<string, number> | null;
  occupation: string | null;
  cleared_scenarios: string[] | null;
  created_at: string;
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

// Rarity accents tuned to the occult / aged-parchment palette.
const RARITY_STYLES: Record<CharacterCard["rarity"], { frame: string; chip: string; glow: string }> = {
  Common:    { frame: "rgba(201,169,110,0.12)", chip: "border-zinc-600 text-zinc-400",      glow: "" },
  Rare:      { frame: "rgba(56,189,248,0.30)",  chip: "border-sky-600/70 text-sky-300",     glow: "0 0 24px rgba(56,189,248,0.08)" },
  Epic:      { frame: "rgba(192,132,252,0.30)", chip: "border-purple-500/70 text-purple-300", glow: "0 0 24px rgba(192,132,252,0.10)" },
  Legendary: { frame: "rgba(201,169,110,0.45)", chip: "border-amber-500/70 text-amber-300",  glow: "0 0 28px rgba(201,169,110,0.18)" },
};

const STAT_KEYS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"] as const;

const STAT_ZH: Record<string, string> = {
  HP:   "生命",
  SAN:  "理智",
  MP:   "魔力",
  STR:  "力量",
  CON:  "體質",
  SIZ:  "體型",
  DEX:  "敏捷",
  APP:  "外貌",
  INT:  "智力",
  POW:  "意志",
  EDU:  "教育",
  LUCK: "幸運",
};

const SKILL_ZH: Record<string, string> = {
  spot_hidden:  "偵查",
  listen:       "聆聽",
  library_use:  "圖書館使用",
  psychology:   "心理學",
  persuade:     "說服",
  fast_talk:    "話術",
  charm:        "魅惑",
  intimidate:   "恐嚇",
  dodge:        "閃避",
  first_aid:    "急救",
  stealth:      "潛行",
  lockpick:     "開鎖",
  drive_auto:   "駕駛汽車",
  firearms:     "射擊",
  occult:       "神秘學",
  fighting:     "搏鬥",
};

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
  const [scenarioTitles, setScenarioTitles] = useState<Record<string, string>>({});

  async function loadCards() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    const { data } = await supabase
      .from("character_cards")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    const list = (data as CharacterCard[]) ?? [];
    setCards(list);
    setLoading(false);

    // Resolve titles for every cleared scenario referenced across the collection.
    const ids = Array.from(new Set(list.flatMap((c) => c.cleared_scenarios ?? [])));
    if (ids.length > 0) {
      const { data: scen } = await supabase
        .from("scenarios")
        .select("id, title")
        .in("id", ids);
      const map: Record<string, string> = {};
      for (const s of scen ?? []) map[s.id] = s.title;
      setScenarioTitles(map);
    }
  }

  useEffect(() => { loadCards(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const DAILY_LIMIT = 3;
  const todayCount = cards.filter((c) => isSameUtcDay(c.created_at)).length;
  const openedToday = todayCount >= DAILY_LIMIT;

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

  function handleDeleted(id: string) {
    setCards((prev) => prev.filter((c) => c.id !== id));
    if (revealed?.id === id) setRevealed(null);
  }

  return (
    <div className="max-w-6xl mx-auto">
      {rolling && (
        <CardRollReveal card={rolling as unknown as RevealCard} onDone={finishReveal} />
      )}

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap pt-2 pb-6">
        <div className="flex items-start gap-4">
          <div>
            <h1 className="font-serif text-gold leading-none mb-2"
              style={{ fontSize: "clamp(2rem,4vw,2.75rem)", letterSpacing: "0.08em" }}>
              我的調查員
            </h1>
            <p className="text-zinc-500 text-sm">
              每天最多可抽取 {DAILY_LIMIT} 張卡。屬性由骰子決定，永久鎖定。
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={openCard}
            disabled={opening || openedToday}
            className="group flex items-center gap-2.5 px-5 py-3 rounded-lg font-medium text-sm transition-all disabled:cursor-not-allowed"
            style={
              opening || openedToday
                ? { background: "#1a150e", border: "1px solid #2e2416", color: "#5a5248" }
                : { background: "rgba(26,21,14,0.9)", border: "1px solid rgba(201,169,110,0.35)", color: "#c9a96e", boxShadow: "0 0 18px rgba(201,169,110,0.12)" }
            }
          >
            <span className="text-base">🎲</span>
            {opening ? "擲骰中..." : openedToday ? `今日已達上限 (${todayCount}/${DAILY_LIMIT}) ✓` : `抽取調查員 (${todayCount}/${DAILY_LIMIT})`}
          </button>
          {openedToday && (
            <span className="text-xs text-zinc-600">明天（UTC）再來抽取。</span>
          )}
        </div>
      </div>

      <div className="h-px mb-6" style={{ background: "linear-gradient(90deg,transparent,rgba(201,169,110,0.2),transparent)" }} />

      {error && (
        <div className="border text-sm rounded-lg px-4 py-3 mb-6"
          style={{ background: "rgba(127,29,29,0.2)", borderColor: "rgba(185,28,28,0.5)", color: "#fca5a5" }}>
          {error}
        </div>
      )}

      {revealed && (
        <div className="mb-8">
          <p className="text-xs text-gold uppercase tracking-[0.2em] mb-3">✦ 獲得新調查員！</p>
          <div className="max-w-xs">
            <CardView card={revealed} highlight scenarioTitles={scenarioTitles} onNameSaved={handleNameSaved} onDeleted={handleDeleted} />
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-24 text-zinc-700 text-sm">載入收藏中...</div>
      ) : cards.length === 0 ? (
        <div className="text-center py-20 rounded-xl"
          style={{ border: "1px dashed #2e2416", background: "#0e0c08" }}>
          <div className="text-4xl mb-3 opacity-60">🎴</div>
          <p className="text-zinc-400">你還沒有任何調查員。</p>
          <p className="text-zinc-600 text-sm mt-1">抽取第一張卡開始你的收藏。</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-zinc-600 mb-4">共 {cards.length} 位調查員</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 pb-12">
            {cards.map((card) => (
              <CardView key={card.id} card={card} scenarioTitles={scenarioTitles} onNameSaved={handleNameSaved} onDeleted={handleDeleted} />
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
  scenarioTitles,
  onNameSaved,
  onDeleted,
}: {
  card: CharacterCard;
  highlight?: boolean;
  scenarioTitles?: Record<string, string>;
  onNameSaved?: (id: string, newName: string) => void;
  onDeleted?: (id: string) => void;
}) {
  const style = RARITY_STYLES[card.rarity];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.name);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [showSkills, setShowSkills] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function deleteCard() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/characters/${card.id}`, { method: "DELETE" });
      if (res.ok) { onDeleted?.(card.id); }
      else { setConfirmDelete(false); setDeleting(false); }
    } catch {
      setConfirmDelete(false);
      setDeleting(false);
    }
  }

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
    <div
      className="relative rounded-xl p-5 pt-6 flex flex-col"
      style={{
        background: "linear-gradient(150deg,#1c1813 0%,#13100b 55%,#0f0c08 100%)",
        border: "1px solid #2e2416",
        boxShadow: highlight
          ? "0 0 0 2px rgba(201,169,110,0.5), 0 4px 28px rgba(0,0,0,0.5)"
          : `0 4px 24px rgba(0,0,0,0.45)${style.glow ? `, ${style.glow}` : ""}`,
      }}
    >
      {/* Aged-paper speckle texture */}
      <div className="absolute inset-0 rounded-xl pointer-events-none opacity-[0.05]"
        style={{ backgroundImage: "radial-gradient(circle, #c9a96e 1px, transparent 1px)", backgroundSize: "16px 16px" }} />
      {/* Ornate inner frame */}
      <div className="absolute inset-[7px] rounded-lg pointer-events-none"
        style={{ border: `1px solid ${style.frame}` }} />
      {/* Paper clip */}
      <div className="absolute -top-1.5 left-5 w-3.5 h-7 rounded-full pointer-events-none -rotate-12"
        style={{ border: "2px solid rgba(201,169,110,0.35)", borderBottom: "none", background: "transparent" }} />

      <div className="relative flex flex-col">
        <div className="flex items-start justify-between mb-4 gap-2">
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
                  className="w-full rounded px-2 py-1 text-white text-sm focus:outline-none"
                  style={{ background: "#0e0c08", border: "1px solid rgba(201,169,110,0.4)" }}
                />
                {nameError && <span className="text-red-400 text-xs">{nameError}</span>}
                <div className="flex gap-2 mt-0.5">
                  <button
                    onClick={saveName}
                    disabled={saving}
                    className="text-xs px-2 py-0.5 rounded disabled:opacity-50"
                    style={{ background: "rgba(201,169,110,0.15)", border: "1px solid rgba(201,169,110,0.35)", color: "#c9a96e" }}
                  >
                    {saving ? "儲存中…" : "儲存"}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 min-w-0">
                {card.occupation && (
                  <span className="text-2xl leading-none mt-0.5 shrink-0">
                    {OCCUPATION_ICON[card.occupation] ?? "🎭"}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-serif text-lg truncate" style={{ color: "#e4d8be", letterSpacing: "0.02em" }}>{card.name}</h3>
                    <button
                      onClick={startEdit}
                      title="Rename card"
                      className="text-zinc-600 hover:text-gold shrink-0 text-xs leading-none"
                    >
                      ✎
                    </button>
                  </div>
                  {card.occupation && (
                    <p className="text-[11px] mt-0.5" style={{ color: "rgba(201,169,110,0.65)" }}>{card.occupation}</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <span className={`text-xs px-2 py-0.5 rounded border bg-black/30 shrink-0 ${style.chip}`}>{card.rarity}</span>
        </div>

        <div className="grid grid-cols-3 gap-x-4 gap-y-px">
          <StatBox label="HP" value={card.hp} />
          <StatBox label="SAN" value={card.san} />
          <StatBox label="MP" value={card.mp} />
          {STAT_KEYS.map((k) => (
            <StatBox key={k} label={k.toUpperCase()} value={card[k]} />
          ))}
        </div>

        <div className="flex items-center justify-between text-xs pt-3 mt-3"
          style={{ borderTop: "1px solid #2a2010" }}>
          <span className="text-zinc-500">
            合計 <span className="text-gold font-bold">{card.total_stats}</span>
          </span>
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setShowSkills((v) => !v)}
              className="text-xs text-gold/80 hover:text-gold underline underline-offset-2"
            >
              {showSkills ? "收起技能 ▲" : "查看技能 ▼"}
            </button>
            <span className="text-zinc-700">
              {new Date(card.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
            </span>
          </div>
        </div>

        {showSkills && (
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid #2a2010" }}>
            {card.skills && Object.keys(card.skills).filter((k) => (card.skills![k] ?? 0) > 0).length > 0 ? (
              <div className="grid grid-cols-2 gap-1">
                {Object.entries(card.skills)
                  .filter(([, v]) => (v ?? 0) > 0)
                  .sort(([, a], [, b]) => b - a)
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between rounded px-2 py-1" style={{ background: "rgba(0,0,0,0.3)" }}>
                      <span className="text-zinc-500 text-xs">{SKILL_ZH[k] ?? k.replace(/_/g, " ")}</span>
                      <span className="text-gold text-xs font-bold">{v}%</span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-zinc-600 text-xs text-center py-2">尚未分配技能點數</p>
            )}
          </div>
        )}

        {card.cleared_scenarios && card.cleared_scenarios.length > 0 && (
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid #2a2010" }}>
            <p className="text-[10px] text-emerald-500 uppercase tracking-wider mb-1.5">已通關劇本</p>
            <div className="flex flex-wrap gap-1">
              {card.cleared_scenarios.map((sid) => (
                <span
                  key={sid}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(6,78,59,0.4)", border: "1px solid rgba(6,95,70,0.6)", color: "#6ee7b7" }}
                >
                  🏆 {scenarioTitles?.[sid] ?? "劇本"}
                </span>
              ))}
            </div>
          </div>
        )}

        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="mt-3 w-full text-xs text-zinc-700 hover:text-red-400 transition-colors py-1"
          >
            🗑 刪除此卡
          </button>
        ) : (
          <div className="mt-3 flex gap-2">
            <button
              onClick={deleteCard}
              disabled={deleting}
              className="flex-1 text-xs rounded py-1.5 font-medium disabled:opacity-50"
              style={{ background: "rgba(127,29,29,0.6)", color: "#fecaca" }}
            >
              {deleting ? "刪除中…" : "確認刪除"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-1 text-xs rounded py-1.5"
              style={{ background: "#1a150e", border: "1px solid #2e2416", color: "#a1a1aa" }}
            >
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between items-center py-1.5" style={{ borderBottom: "1px solid rgba(42,32,16,0.6)" }}>
      <span className="text-zinc-600 text-[11px] tracking-wide">{STAT_ZH[label] ?? label}</span>
      <span className="text-zinc-200 text-xs font-semibold">{value}</span>
    </div>
  );
}
