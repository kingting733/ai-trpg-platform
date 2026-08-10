"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ITEM_POOL,
  PRAY_COST,
  RARITY_ZH,
  itemById,
  effectText,
  effectDetail,
  type ItemDef,
  type ItemRarity,
} from "@/lib/game/items";

// Optional altar art — drop /public/pray/altar.png and it lights up; a CSS
// candle-lit fallback stands in otherwise.
const ALTAR_SRC = "/pray/altar.png";

const RARITY_STYLE: Record<ItemRarity, { color: string; glow: string; chip: string }> = {
  common:    { color: "#a1a1aa", glow: "rgba(161,161,170,0.30)", chip: "border-zinc-600 text-zinc-400" },
  rare:      { color: "#7dd3fc", glow: "rgba(125,211,252,0.35)", chip: "border-sky-600/70 text-sky-300" },
  epic:      { color: "#c4b5fd", glow: "rgba(196,181,253,0.35)", chip: "border-purple-500/70 text-purple-300" },
  legendary: { color: "#c9a96e", glow: "rgba(201,169,110,0.50)", chip: "border-amber-500/70 text-amber-300" },
};
const RARITY_ORDER: ItemRarity[] = ["legendary", "epic", "rare", "common"];

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
      {revealed && (() => {
        const st = RARITY_STYLE[revealed.rarity];
        return (
          <div className="pray-reveal rounded-xl p-5 mb-6 flex items-start gap-4"
            style={{ background: "rgba(20,16,11,0.85)", border: `1.5px solid ${st.glow}`, boxShadow: `0 0 30px ${st.glow}` }}>
            <div className="w-14 h-14 rounded-lg shrink-0 flex items-center justify-center"
              style={{ background: "rgba(10,8,5,0.8)", border: `1px solid ${st.glow}`, color: st.color }}>
              <Sparkles size={22} strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border bg-black/30 ${st.chip}`}>{RARITY_ZH[revealed.rarity]}</span>
                <h3 className="font-serif text-lg" style={{ color: st.color }}>{revealed.name}</h3>
              </div>
              <p className="text-xs text-zinc-500 italic leading-relaxed mb-1.5">{revealed.flavor}</p>
              <p className="text-xs" style={{ color: "#cbb890" }}>{effectText(revealed)}</p>
              {effectDetail(revealed) && (
                <p className="text-[11px] text-zinc-500 leading-snug mt-1">{effectDetail(revealed)}</p>
              )}
              <button type="button" onClick={() => setRevealed(null)} className="mt-2 text-xs text-zinc-600 hover:text-zinc-400 underline decoration-dotted">收下</button>
            </div>
          </div>
        );
      })()}

      {/* ── Collection ── */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-serif text-gold">祭品閣 <span className="text-zinc-600 text-xs ml-1">{owned.size} / {ITEM_POOL.length}</span></h2>
        <p className="text-[11px] text-zinc-600">裝備後只影響幕間任務；每位調查員一個欄位。</p>
      </div>
      <div className="space-y-5">
        {RARITY_ORDER.map((rarity) => {
          const items = ITEM_POOL.filter((i) => i.rarity === rarity);
          const st = RARITY_STYLE[rarity];
          return (
            <div key={rarity}>
              <p className="text-[11px] tracking-widest mb-2" style={{ color: st.color }}>{RARITY_ZH[rarity]}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((item) => {
                  const has = owned.has(item.id);
                  const wearer = has ? wearerOf(item.id) : null;
                  return (
                    <div key={item.id} className="rounded-xl p-3.5"
                      style={{
                        background: has ? "rgba(22,19,16,0.85)" : "rgba(14,12,9,0.6)",
                        border: `1px solid ${has ? st.glow : "#1f1a12"}`,
                        opacity: has ? 1 : 0.55,
                      }}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border bg-black/30 shrink-0 ${st.chip}`}>{RARITY_ZH[rarity]}</span>
                        <h4 className="font-serif text-sm truncate" style={{ color: has ? st.color : "#52525b" }}>
                          {has ? item.name : "？？？"}
                        </h4>
                      </div>
                      {has ? (
                        <>
                          <p className="text-[11px] text-zinc-600 italic leading-snug mb-1.5">{item.flavor}</p>
                          <p className="text-[11px] mb-1" style={{ color: "#cbb890" }}>{effectText(item)}</p>
                          {effectDetail(item) && (
                            <p className="text-[11px] text-zinc-500 leading-snug mb-2">{effectDetail(item)}</p>
                          )}
                          {item.effect.type === "mythos_spell" ? (() => {
                            const spellKey = item.effect.spell;
                            const zh = { shrivelling: "萎縮術", elder_sign: "遠古印記", contact_dead: "死者絮語" }[spellKey] ?? spellKey;
                            const bearer = spellBearerOf(spellKey);
                            return bearer ? (
                              <p className="inline-flex items-center gap-1 text-[11px]" style={{ color: "#b18cd4" }}><Sparkles size={11} strokeWidth={2} /> 已銘刻於 {bearer.name}（不可更改）</p>
                            ) : (
                              <select
                                value=""
                                onChange={(e) => {
                                  const c = cards.find((x) => x.id === e.target.value);
                                  if (c) bindSpell(item.id, c.id, c.name, zh);
                                }}
                                disabled={working}
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none disabled:opacity-50"
                              >
                                <option value="">銘刻至調查員…（不可更改）</option>
                                {cards.map((c) => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            );
                          })() : (
                          <select
                            value={wearer?.id ?? ""}
                            onChange={(e) => equip(item.id, e.target.value || null)}
                            disabled={working}
                            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none disabled:opacity-50"
                          >
                            <option value="">未裝備</option>
                            {cards.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}{c.equipped_item && c.equipped_item !== item.id ? `（現持${itemById(c.equipped_item)?.name ?? "物品"}）` : ""}
                              </option>
                            ))}
                          </select>
                          )}
                        </>
                      ) : (
                        <p className="text-[11px] text-zinc-700 italic">尚未從煙霧中歸來。</p>
                      )}
                    </div>
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
