"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ItemCard, RARITY_ACCENT } from "@/components/ItemCard";
import { MYTHOS_ZH_BY_KEY } from "@/lib/game/mythos";
import {
  ITEM_POOL,
  PRAY_COST,
  RARITY_ZH,
  itemById,
  type ItemDef,
  type ItemRarity,
} from "@/lib/game/items";

// Optional altar art — drop /public/pray/altar.png and it lights up; a CSS
// candle-lit fallback stands in otherwise.
const ALTAR_SRC = "/pray/altar.png";

const RARITY_ORDER: ItemRarity[] = ["legendary", "epic", "rare", "common"];

// Selects sit INSIDE the card's action row, so they carry no border of their
// own — the row already draws one.
const selectCls =
  "w-full bg-transparent rounded-md px-1.5 py-1 text-xs text-zinc-200 focus:outline-none disabled:opacity-50 [&>option]:bg-zinc-900";

interface CardLite { id: string; name: string; equipped_item: string | null; mythos_skills: string[] | null }

export default function PrayPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState(0);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [cards, setCards] = useState<CardLite[]>([]);
  const [praying, setPraying] = useState(false);       // smoke ceremony running
  const [revealed, setRevealed] = useState<ItemDef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [altarError, setAltarError] = useState(false);

  async function load() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    const [{ data: u }, { data: items }, { data: cardRows }] = await Promise.all([
      supabase.from("users").select("points").eq("id", user.id).single(),
      supabase.from("user_items").select("item_id").eq("user_id", user.id),
      supabase.from("character_cards").select("id,name,equipped_item,mythos_skills").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);
    setPoints(u?.points ?? 0);
    setOwned(new Set((items ?? []).map((r: any) => r.item_id as string)));
    setCards((cardRows as CardLite[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const allOwned = owned.size >= ITEM_POOL.length;
  const canPray = !praying && !working && points >= PRAY_COST && !allOwned;

  async function pray() {
    if (!canPray) return;
    setWorking(true); setError(null); setRevealed(null); setPraying(true);
    const started = Date.now();
    try {
      const res = await fetch("/api/pray", { method: "POST" });
      const data = await res.json();
      // Let the smoke breathe for at least ~1.8s before the reveal.
      const wait = Math.max(0, 1800 - (Date.now() - started));
      await new Promise((r) => setTimeout(r, wait));
      if (!res.ok) setError(data.error ?? "祈願失敗。");
      else {
        setRevealed(itemById(data.item?.id) ?? null);
        await load();
      }
    } catch { setError("網路錯誤，請再試一次。"); }
    setPraying(false);
    setWorking(false);
  }

  async function equip(itemId: string, cardId: string | null) {
    if (working) return;
    setWorking(true); setError(null);
    try {
      const res = await fetch("/api/items/equip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, cardId }),
      });
      if (!res.ok) setError((await res.json()).error ?? "裝備失敗。");
      else await load();
    } catch { setError("網路錯誤，請再試一次。"); }
    setWorking(false);
  }

  // 銘刻 a Mythos tome's spell to one card — IRREVERSIBLE (no unbind exists).
  async function bindSpell(itemId: string, cardId: string, cardName: string, spellZh: string) {
    if (working) return;
    if (!window.confirm(`將禁咒「${spellZh}」銘刻至 ${cardName}？\n\n此舉不可更改——禁咒將永久屬於這名調查員（即使在故事中身亡，卡片與禁咒依然保留）。`)) return;
    setWorking(true); setError(null);
    try {
      const res = await fetch("/api/mythos/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, cardId }),
      });
      if (!res.ok) setError((await res.json()).error ?? "銘刻失敗。");
      else await load();
    } catch { setError("網路錯誤，請再試一次。"); }
    setWorking(false);
  }

  if (loading) return <div className="text-center text-zinc-600 py-24">香爐正在點燃…</div>;

  const wearerOf = (itemId: string) => cards.find((c) => c.equipped_item === itemId) ?? null;
  const spellBearerOf = (spellKey: string) =>
    cards.find((c) => Array.isArray(c.mythos_skills) && c.mythos_skills.includes(spellKey)) ?? null;

  return (
    <div className="max-w-5xl mx-auto pb-16">
      {/* ── Altar ── */}
      <div className="relative rounded-xl overflow-hidden mb-6" style={{ border: "1px solid #2a2418", minHeight: 380 }}>
        {/* Scene: art if present, candle-lit CSS otherwise */}
        {altarError ? (
          <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 50% at 50% 62%, #2a1c10 0%, #150e08 45%, #070503 100%)" }} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ALTAR_SRC} alt="" className="absolute inset-0 w-full h-full object-cover" onError={() => setAltarError(true)} />
        )}
        <div className="absolute inset-0 pray-glow pointer-events-none" style={{ background: "radial-gradient(ellipse 50% 40% at 50% 60%, rgba(201,140,60,0.14), transparent 70%)" }} />
        {/* Incense smoke rising from the burner area */}
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none" style={{ bottom: "34%", width: 60, height: 120 }}>
          <span className="pray-smoke" />
          <span className="pray-smoke" />
          <span className="pray-smoke" />
        </div>

        {/* Copy — top-left, as in the reference */}
        <div className="relative z-10 p-6 sm:p-8 max-w-md">
          <h1 className="font-serif text-gold mb-3" style={{ fontSize: "clamp(2rem,4vw,2.75rem)", letterSpacing: "0.12em", textShadow: "0 2px 18px rgba(0,0,0,0.8)" }}>
            舊神祈願
          </h1>
          <p className="text-sm text-zinc-300 leading-relaxed" style={{ textShadow: "0 1px 8px rgba(0,0,0,0.9)" }}>
            向舊神獻上調查點，祂會給予回應。
          </p>
          <p className="text-sm text-zinc-500 leading-relaxed" style={{ textShadow: "0 1px 8px rgba(0,0,0,0.9)" }}>
            煙霧之後，有東西回望著你。
          </p>
        </div>

        {/* Bottom bar: hint + points + pray button */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-3 flex-wrap px-6 py-4" style={{ background: "linear-gradient(180deg, transparent, rgba(5,4,2,0.85) 40%)" }}>
          <p className="text-xs text-zinc-400 flex-1 min-w-[200px]" style={{ textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}>
            將調查點投入香爐，祂將以遺物回報你。
          </p>
          <span className="text-sm text-zinc-400">點數 <span className="text-gold font-bold tabular-nums">{points}</span></span>
          <button
            type="button"
            onClick={pray}
            disabled={!canPray}
            className="px-6 py-2.5 rounded-lg font-serif text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
            style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 18px rgba(201,169,110,0.25)" }}
          >
            {praying ? "焚香中…" : allOwned ? "舊神已無可回應之物" : `獻上 ${PRAY_COST} 點祈願`}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs rounded-lg px-3 py-2 mb-4" style={{ background: "rgba(127,29,29,0.2)", border: "1px solid rgba(185,28,28,0.5)", color: "#fca5a5" }}>
          {error}
        </div>
      )}

      {/* ── Reveal ── */}
      {revealed && (
        <div className="pray-reveal mb-6">
          <ItemCard item={revealed} />
          <button
            type="button"
            onClick={() => setRevealed(null)}
            className="mt-2 text-xs text-zinc-600 hover:text-zinc-400 underline decoration-dotted"
          >
            收下
          </button>
        </div>
      )}

      {/* ── Collection ── */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-serif text-gold">祭品閣 <span className="text-zinc-600 text-xs ml-1">{owned.size} / {ITEM_POOL.length}</span></h2>
        <p className="text-[11px] text-zinc-600">裝備後只影響幕間任務；每位調查員一個欄位。</p>
      </div>
      <div className="space-y-5">
        {RARITY_ORDER.map((rarity) => {
          const items = ITEM_POOL.filter((i) => i.rarity === rarity);
          return (
            <div key={rarity}>
              <p className="text-[11px] tracking-widest mb-2" style={{ color: RARITY_ACCENT[rarity] }}>{RARITY_ZH[rarity]}</p>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {items.map((item) => {
                  const has = owned.has(item.id);
                  const wearer = has ? wearerOf(item.id) : null;
                  const isTome = item.effect.type === "mythos_spell";
                  const spellKey = isTome ? (item.effect as { spell: string }).spell : null;
                  const bearer = spellKey ? spellBearerOf(spellKey) : null;

                  // The tome's bind is irreversible, so once bound the control
                  // is replaced by a plain statement — never a live select that
                  // implies it could be moved.
                  const action = !has ? null : isTome ? (
                    bearer ? (
                      <p className="inline-flex items-center gap-1.5 text-xs py-1" style={{ color: "#b18cd4" }}>
                        <Sparkles size={12} strokeWidth={2} /> 已銘刻於 {bearer.name}（不可更改）
                      </p>
                    ) : (
                      <select
                        value=""
                        onChange={(e) => {
                          const c = cards.find((x) => x.id === e.target.value);
                          if (c && spellKey) bindSpell(item.id, c.id, c.name, MYTHOS_ZH_BY_KEY[spellKey] ?? spellKey);
                        }}
                        disabled={working}
                        className={selectCls}
                      >
                        <option value="">銘刻至調查員…（不可更改）</option>
                        {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )
                  ) : (
                    <select
                      value={wearer?.id ?? ""}
                      onChange={(e) => equip(item.id, e.target.value || null)}
                      disabled={working}
                      className={selectCls}
                    >
                      <option value="">未裝備</option>
                      {cards.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}{c.equipped_item && c.equipped_item !== item.id ? `（現持${itemById(c.equipped_item)?.name ?? "物品"}）` : ""}
                        </option>
                      ))}
                    </select>
                  );

                  return (
                    <ItemCard
                      key={item.id}
                      item={item}
                      owned={has}
                      action={action}
                      actionLabel={isTome ? "銘刻對象" : "裝備至"}
                      showRarity={false}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
