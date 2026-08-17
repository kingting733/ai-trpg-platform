"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Compass, Sparkles, ArrowRight, PersonStanding, Drama, ArrowLeftRight, CircleX, Moon, BookOpen, MessageCircle, Swords, type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  INTERLUDE_MISSIONS,
  missionByKey,
  bestRelevantSkill,
  successRate,
  pointsFor,
} from "@/lib/game/interlude";
import { GrowthRollReveal, type Growth } from "@/components/GrowthRollReveal";
import { SKILL_ZH_BY_KEY, currentSkillValue } from "@/lib/game/skills";
import { computeMissionModifiers, applyRateBonus, applyPointsMult, itemById } from "@/lib/game/items";

// Occupation portrait icons (mirrors select-card / CardRollReveal).
const OCCUPATION_ICON: Record<string, string> = {
  "記者": "/reporter.png", "警探": "/detective.png", "大學生": "/student.png",
  "醫生": "/doctor.png", "黑幫成員": "/gangster.png", "風水師": "/fengshui.png",
  "退役軍人": "/veteran.png", "YouTuber": "/youtuber.png", "前邪教成員": "/cultist.png",
  "賭徒": "/gambler.png", "走私司機": "/smuggler.png",
};
const RARITY_CHIP: Record<string, string> = {
  Common: "border-zinc-600 text-zinc-400", Rare: "border-sky-600/70 text-sky-300",
  Epic: "border-purple-500/70 text-purple-300", Legendary: "border-amber-500/70 text-amber-300",
};
// Mirrors INTERLUDE_MISSIONS' key order (lib/game/interlude.ts) — the mission
// data still carries its own `emoji` field (used only as a fallback key here),
// but the UI renders these icons instead.
const MISSION_ICON: Record<string, LucideIcon> = {
  night_patrol: Moon,
  case_research: BookOpen,
  rumor_gathering: MessageCircle,
  physical_training: Swords,
};

// Asset paths — drop files here and they light up automatically.
const BG_SRC = "/interlude/bg-street.png";
const CHAR_IDLE = "/interlude/char-idle.png";
// Walking is a CSS sprite sheet (8 frames) rather than a GIF: crisp alpha (GIF
// is 1-bit, which fringes against the dark street), a third of the size, and
// the speed is controllable from code. Both assets are cut from the same
// uploaded sheet, so the standing and walking character are the same drawing.
const CHAR_CELL_W = 86;   // 171x300 source cell, shown 150 tall
const CHAR_CELL_H = 150;

interface Card {
  id: string; name: string; rarity: string; occupation: string | null;
  skills: Record<string, number> | null;
  str: number; con: number; siz: number; dex: number; app: number;
  int: number; pow: number; edu: number; luck: number;
  equipped_item: string | null;
}
interface ActiveMission {
  id: string; card_id: string; mission_type: string;
  success_rate: number; points_on_success: number; started_at: string; claimable_at: string;
}
interface Outcome {
  roll: number; success: boolean; points: number; growth: Growth | null; narration: string;
}
interface HistoryRow {
  id: string; card_id: string; mission_type: string; cancelled: boolean;
  claimed_at: string; outcome: Outcome | null;
}

export default function InterludePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState(0);
  const [cards, setCards] = useState<Card[]>([]);
  const [busyCardIds, setBusyCardIds] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<ActiveMission | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [featuredId, setFeaturedId] = useState<string>("");
  const [selectedMission, setSelectedMission] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  const [growthRevealed, setGrowthRevealed] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [charError, setCharError] = useState(false);
  const [bgError, setBgError] = useState(false);

  async function load() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    const [{ data: u }, { data: cardRows }, { data: missions }, { data: inRooms }, { data: hist }] = await Promise.all([
      supabase.from("users").select("points").eq("id", user.id).single(),
      supabase.from("character_cards").select("id,name,rarity,occupation,skills,str,con,siz,dex,app,int,pow,edu,luck,equipped_item").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("card_missions").select("id,card_id,mission_type,success_rate,points_on_success,started_at,claimable_at").is("claimed_at", null).eq("user_id", user.id),
      supabase.from("characters").select("source_card_id, rooms!inner(status)").eq("user_id", user.id).in("rooms.status", ["waiting", "in_progress"]),
      supabase.from("card_missions").select("id,card_id,mission_type,cancelled,claimed_at,outcome").not("claimed_at", "is", null).eq("cancelled", false).eq("user_id", user.id).order("claimed_at", { ascending: false }).limit(3),
    ]);
    setPoints(u?.points ?? 0);
    const list = (cardRows as Card[]) ?? [];
    setCards(list);
    const act = (missions?.[0] as ActiveMission) ?? null;
    setActive(act);
    setBusyCardIds(new Set((inRooms ?? []).map((r: any) => r.source_card_id).filter(Boolean)));
    setHistory((hist as HistoryRow[]) ?? []);
    // Feature the mission's card if one is out, else keep/choose the first idle card.
    setFeaturedId((prev) => act?.card_id ?? (prev && list.some((c) => c.id === prev) ? prev : list[0]?.id ?? ""));
    setLoading(false);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  // Default the training skill to the card's best when a mission/card is chosen.
  useEffect(() => {
    if (!selectedMission) { setSelectedSkill(null); return; }
    const m = missionByKey(selectedMission);
    const card = cards.find((c) => c.id === featuredId);
    if (!m || !card) return;
    setSelectedSkill(bestRelevantSkill({ skills: card.skills, dex: card.dex, app: card.app }, m).key);
  }, [selectedMission, featuredId, cards]);

  // Retry the character art when switching walk↔idle (one may exist, one not).
  useEffect(() => { setCharError(false); }, [
    // walking depends on active+claimable; recompute inline to avoid ordering issues
    active?.id, active ? new Date(active.claimable_at).getTime() <= now : false,
  ]);

  async function dispatch(missionKey: string) {
    if (!featuredId || working) return;
    setWorking(true); setError(null);
    try {
      const res = await fetch("/api/interlude/dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardId: featuredId, missionType: missionKey, growthSkill: selectedSkill }) });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "出發失敗。"); else { setResult(null); setSelectedMission(null); await load(); }
    } catch { setError("網路錯誤，請再試一次。"); }
    setWorking(false);
  }
  async function claim() {
    if (!active || working) return;
    setWorking(true); setError(null);
    try {
      const res = await fetch("/api/interlude/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ missionId: active.id }) });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "領取失敗。");
      else {
        const outcome = (data.outcome as Outcome) ?? null;
        setResult(outcome);
        const g = outcome?.growth;
        setGrowthRevealed(!(g && !g.capped && typeof g.d100 === "number"));
        await load();
      }
    } catch { setError("網路錯誤，請再試一次。"); }
    setWorking(false);
  }
  async function cancel() {
    if (!active || working) return;
    if (!window.confirm("取消任務會放棄所有獎勵，確定讓調查員提前回來？")) return;
    setWorking(true); setError(null);
    try {
      const res = await fetch("/api/interlude/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ missionId: active.id }) });
      if (!res.ok) setError((await res.json()).error ?? "取消失敗。"); else await load();
    } catch { setError("網路錯誤，請再試一次。"); }
    setWorking(false);
  }

  const featured = cards.find((c) => c.id === featuredId) ?? null;
  const idleCards = cards.filter((c) => !busyCardIds.has(c.id) && c.id !== active?.card_id);
  const activeMission = active ? missionByKey(active.mission_type) : null;
  const activeCard = active ? cards.find((c) => c.id === active.card_id) : null;
  const remainMs = active ? new Date(active.claimable_at).getTime() - now : 0;
  const claimable = active !== null && remainMs <= 0;
  const progressPct = active
    ? Math.max(0, Math.min(100, Math.round(((now - new Date(active.started_at).getTime()) / (new Date(active.claimable_at).getTime() - new Date(active.started_at).getTime())) * 100)))
    : 0;
  const walking = active !== null && !claimable;

  const fmt = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  if (loading) return <div className="text-center text-zinc-600 py-24">載入幕間任務中…</div>;

  return (
    <div className="max-w-6xl mx-auto pb-16">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap pt-2 pb-5">
        <div className="flex items-center gap-4">
          <Compass size={36} strokeWidth={1.5} className="opacity-70 text-zinc-300" />
          <div>
            <h1 className="font-serif text-gold leading-none mb-1.5" style={{ fontSize: "clamp(1.8rem,3.5vw,2.5rem)", letterSpacing: "0.08em" }}>幕間任務</h1>
            <p className="text-zinc-500 text-sm">派遣調查員執行 24 小時的幕間任務，離線也能持續推進。</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ background: "rgba(22,19,16,0.8)", border: "1px solid rgba(201,169,110,0.35)" }}>
          <Sparkles size={14} strokeWidth={2} className="text-gold" />
          <span className="text-sm text-zinc-400">點數</span>
          <span className="text-gold font-bold tabular-nums text-lg">{points}</span>
        </div>
      </div>

      {error && <div className="text-xs rounded-lg px-3 py-2 mb-4" style={{ background: "rgba(127,29,29,0.2)", border: "1px solid rgba(185,28,28,0.5)", color: "#fca5a5" }}>{error}</div>}

      {cards.length === 0 ? (
        <div className="text-center py-20 rounded-xl" style={{ border: "1px dashed #2e2416", background: "#0e0c08" }}>
          <p className="text-zinc-400">你還沒有任何調查員。</p>
          <button onClick={() => router.push("/characters")} className="mt-3 text-sm text-gold underline decoration-dotted inline-flex items-center gap-1">去抽取調查員 <ArrowRight size={13} strokeWidth={2} /></button>
        </div>
      ) : (
        <>
          {/* Animated mission scene */}
          <div className="rounded-xl overflow-hidden mb-4" style={{ background: "rgba(16,13,9,0.9)", border: "1px solid #2a2418" }}>
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "#2a2418" }}>
              <span className="text-sm text-gold">{active ? "任務進行中" : "尚未出發"}</span>
              {active && <span className="text-[11px] text-emerald-400/80 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />{claimable ? "已歸來" : "離線進行中…"}</span>}
            </div>

            {/* The scene. bg is 2131×360; shown near native height for crisp
                pixels. Scroll speed tuned to a stroll (adjustable). */}
            <div className="il-scene" style={{ height: 300, background: "#0b0e14" }}>
              {bgError ? (
                <div className="absolute inset-0" style={{ background: "linear-gradient(180deg,#12233a,#0a0d14)" }} />
              ) : (
                <div className={`il-track ${walking ? "" : "il-paused"}`} style={{ ["--il-speed" as any]: "30s" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={BG_SRC} alt="" className="il-tile" onError={() => setBgError(true)} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={BG_SRC} alt="" className="il-tile" aria-hidden />
                </div>
              )}
              <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(180deg, rgba(8,10,16,0.35), rgba(8,10,16,0.15) 40%, rgba(8,10,16,0.55))" }} />
              <div className="absolute left-1/2 bottom-3 -translate-x-1/2 z-10">
                {charError ? (
                  <div className={`il-char ${walking ? "" : "il-paused"}`} style={{ height: CHAR_CELL_H, display: "flex", alignItems: "center" }}>
                    <PersonStanding size={72} strokeWidth={1.5} className="text-zinc-300" />
                  </div>
                ) : walking ? (
                  <div
                    className="il-walk"
                    role="img"
                    aria-label="調查員行走中"
                    style={{
                      ["--il-walk-w" as string]: `${CHAR_CELL_W}px`,
                      ["--il-walk-h" as string]: `${CHAR_CELL_H}px`,
                    }}
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={CHAR_IDLE}
                    alt="調查員"
                    style={{ height: CHAR_CELL_H }}
                    onError={() => setCharError(true)}
                  />
                )}
              </div>
              {!active && (
                <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: "rgba(8,7,4,0.55)" }}>
                  <p className="text-zinc-400 text-sm">選擇下方任務，派出 <span className="text-gold">{featured?.name ?? "調查員"}</span> 出發</p>
                </div>
              )}
            </div>

            {active && (
              <div className="flex items-center gap-4 px-4 py-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-[160px]">
                  {activeMission && (() => { const Icon = MISSION_ICON[activeMission.key] ?? Compass; return <Icon size={20} strokeWidth={2} className="text-gold shrink-0" />; })()}
                  <div><p className="text-sm text-zinc-200">{activeMission?.name}</p><p className="text-[11px] text-zinc-600">成功率 {active.success_rate}%</p></div>
                </div>
                <div className="flex-1 min-w-[160px]">
                  <div className="flex justify-between text-[11px] text-zinc-500 mb-1"><span>進度</span><span>{progressPct}%</span></div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "#0e0c08" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${progressPct}%`, background: "linear-gradient(90deg,#a8884f,#c9a96e)" }} />
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-[11px] text-zinc-600">剩餘時間</p>
                  <p className="font-mono text-lg tabular-nums" style={{ color: claimable ? "#6ee7b7" : "#e4d8be" }}>{claimable ? "已完成" : fmt(remainMs)}</p>
                </div>
                {claimable ? (
                  <button type="button" onClick={claim} disabled={working} className="px-5 py-2.5 rounded-lg font-serif text-sm transition-all disabled:opacity-40 hover:brightness-110" style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07" }}>{working ? "..." : "領取成果"}</button>
                ) : (
                  <button type="button" onClick={cancel} disabled={working} className="px-4 py-2.5 rounded-lg text-xs transition-colors disabled:opacity-40" style={{ border: "1px solid rgba(185,28,28,0.4)", color: "#f87171" }}>取消任務</button>
                )}
              </div>
            )}
          </div>

          {/* Top row: featured card · mission picker · rules */}
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_240px] gap-4 mb-4">
            {/* Featured investigator */}
            <div className="rounded-xl p-4" style={{ background: "rgba(22,19,16,0.8)", border: "1px solid #2a2418" }}>
              <div className="flex items-center gap-3 mb-3">
                {featured?.occupation && OCCUPATION_ICON[featured.occupation] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={OCCUPATION_ICON[featured.occupation]} alt="" width={56} height={56} className="rounded-lg shrink-0" style={{ objectFit: "cover", border: "1px solid rgba(201,169,110,0.25)" }} />
                ) : <div className="w-14 h-14 rounded-lg shrink-0 flex items-center justify-center" style={{ background: "rgba(14,12,8,0.6)", border: "1px solid rgba(201,169,110,0.2)" }}><Drama size={24} strokeWidth={1.5} className="opacity-40" /></div>}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-serif truncate" style={{ color: "#e4d8be" }}>{featured?.name ?? "—"}</h3>
                    {featured && <span className={`text-[10px] px-1.5 py-0.5 rounded border bg-black/30 shrink-0 ${RARITY_CHIP[featured.rarity] ?? ""}`}>{featured.rarity}</span>}
                  </div>
                  {featured?.occupation && <p className="text-xs mt-0.5" style={{ color: "rgba(201,169,110,0.65)" }}>{featured.occupation}</p>}
                </div>
              </div>
              {featured && (
                <div className="grid grid-cols-3 gap-x-3 gap-y-1 mb-3 text-xs">
                  {([["STR", featured.str], ["CON", featured.con], ["DEX", featured.dex], ["INT", featured.int], ["EDU", featured.edu], ["LUK", featured.luck]] as const).map(([k, v]) => (
                    <div key={k} className="flex justify-between"><span className="text-zinc-600">{k}</span><span className="text-zinc-200 font-semibold">{v}</span></div>
                  ))}
                </div>
              )}
              {featured && (
                <p className="text-[11px] mb-2 inline-flex items-center gap-1" style={{ color: featured.equipped_item ? "#cbb890" : "#52525b" }}>
                  <Sparkles size={11} strokeWidth={2} />
                  {featured.equipped_item ? `裝備：${itemById(featured.equipped_item)?.name ?? "未知物品"}` : "未裝備任何物品"}
                </p>
              )}
              <button type="button" onClick={() => setSwitching((s) => !s)} disabled={!!active} className="w-full text-xs py-2 rounded-lg transition-colors disabled:opacity-40 inline-flex items-center justify-center gap-1" style={{ border: "1px solid #2e2416", color: "#c9a96e" }}>
                切換調查員 <ArrowLeftRight size={11} strokeWidth={2} />
              </button>
              {switching && !active && (
                <div className="mt-2 max-h-40 overflow-y-auto flex flex-col gap-1">
                  {idleCards.length === 0 && <p className="text-[11px] text-zinc-600 px-1">沒有其他可派出的調查員。</p>}
                  {idleCards.map((c) => (
                    <button key={c.id} type="button" onClick={() => { setFeaturedId(c.id); setSwitching(false); }} className="text-left text-xs px-2 py-1.5 rounded hover:brightness-125" style={{ background: c.id === featuredId ? "rgba(201,169,110,0.12)" : "transparent", color: "#cbb890" }}>{c.name} <span className="text-zinc-600">· {c.rarity}</span></button>
                  ))}
                </div>
              )}
              {active && <p className="text-[11px] text-zinc-600 mt-2">任務進行中不能切換。</p>}
            </div>

            {/* Mission picker */}
            <div className="rounded-xl p-4" style={{ background: "rgba(22,19,16,0.8)", border: "1px solid #2a2418" }}>
              <p className="text-sm text-gold mb-3">選擇任務 <span className="text-zinc-600 text-xs">每次執行需 24 小時（離線進行）</span></p>
              {active ? (
                <p className="text-zinc-600 text-sm py-6 text-center">調查員正在執行任務中，歸來後才能派出新任務。</p>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {INTERLUDE_MISSIONS.map((m) => {
                    const best = featured ? bestRelevantSkill({ skills: featured.skills, dex: featured.dex, app: featured.app }, m) : null;
                    // Include the equipped item's bonus — must match dispatch math.
                    const gridMods = featured ? computeMissionModifiers(featured.equipped_item, m.key) : null;
                    const rate = best && gridMods ? applyRateBonus(successRate(best.value), gridMods.rateBonus) : null;
                    const isSel = selectedMission === m.key;
                    return (
                      <button
                        key={m.key}
                        type="button"
                        disabled={!featured || working}
                        onClick={() => setSelectedMission(isSel ? null : m.key)}
                        className="text-left rounded-lg p-3 transition-all disabled:opacity-40 hover:brightness-110"
                        style={{
                          background: isSel ? "rgba(201,169,110,0.14)" : "rgba(26,21,14,0.6)",
                          border: `1px solid ${isSel ? "rgba(201,169,110,0.6)" : "#2e2416"}`,
                        }}
                      >
                        <p className="text-sm mb-1 inline-flex items-center gap-1.5" style={{ color: isSel ? "#e4d8be" : "#d4d4d8" }}>
                          {(() => { const Icon = MISSION_ICON[m.key] ?? Compass; return <Icon size={14} strokeWidth={2} />; })()}
                          {m.name}
                        </p>
                        <p className="text-[11px] text-zinc-600 leading-snug mb-2 min-h-[2.5em]">{m.desc}</p>
                        {rate != null ? (
                          <p className="text-[11px] text-gold">
                            最高成功率 {rate}%
                            {gridMods && gridMods.rateBonus > 0 && <span className="text-emerald-400/80 ml-1 inline-flex items-center gap-0.5">（<Sparkles size={10} strokeWidth={2} />+{gridMods.rateBonus}%）</span>}
                          </p>
                        ) : <p className="text-[11px] text-zinc-700">選擇調查員查看</p>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Selected-mission detail + confirm (replaces the static rules panel) */}
            <div className="rounded-xl p-4 text-xs" style={{ background: "rgba(22,19,16,0.8)", border: "1px solid #2a2418" }}>
              {active ? (
                <>
                  <p className="text-gold mb-3">任務進行中</p>
                  <p className="text-zinc-500 leading-relaxed">{activeCard?.name} 正在執行「{activeMission?.name}」，歸來後即可領取。</p>
                </>
              ) : !featured ? (
                <p className="text-zinc-600 py-8 text-center">先選擇一位調查員。</p>
              ) : !selectedMission ? (
                <p className="text-zinc-600 py-8 text-center">從左側選擇一個任務，這裡會顯示預期的成功與失敗結果。</p>
              ) : (() => {
                const m = missionByKey(selectedMission)!;
                const attrs = { dex: featured.dex, app: featured.app };
                // The chosen training skill drives everything.
                const chosenKey = selectedSkill && m.skills.includes(selectedSkill) ? selectedSkill : bestRelevantSkill({ skills: featured.skills, dex: featured.dex, app: featured.app }, m).key;
                const chosenVal = currentSkillValue(chosenKey, featured.skills, attrs);
                // Mirror the dispatch route: equipped-item modifiers baked in.
                const mods = computeMissionModifiers(featured.equipped_item, m.key);
                const rate = applyRateBonus(successRate(chosenVal), mods.rateBonus);
                const pts = applyPointsMult(pointsFor(chosenVal), mods.pointsMult);
                const equippedDef = itemById(featured.equipped_item);
                return (
                  <>
                    <p className="text-gold mb-1 inline-flex items-center gap-1.5">
                      {(() => { const Icon = MISSION_ICON[m.key] ?? Compass; return <Icon size={14} strokeWidth={2} />; })()}
                      {m.name}
                    </p>
                    <p className="text-[11px] text-zinc-600 leading-snug mb-3">{m.desc}</p>

                    <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">選擇要鍛鍊的技能</p>
                    <p className="text-[10px] text-zinc-600 mb-1.5">
                      技能越高 <ArrowRight size={9} strokeWidth={2} className="inline align-[-1px]" /> 成功率／點數越高，但成長越難；
                      技能越低 <ArrowRight size={9} strokeWidth={2} className="inline align-[-1px]" /> 風險高，但更容易成長。
                    </p>
                    <div className="flex flex-col gap-1 mb-3">
                      {m.skills.map((k) => {
                        const v = currentSkillValue(k, featured.skills, attrs);
                        const sel = k === chosenKey;
                        return (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setSelectedSkill(k)}
                            className="flex justify-between items-center px-2 py-1.5 rounded-lg text-left transition-colors"
                            style={{
                              background: sel ? "rgba(201,169,110,0.14)" : "rgba(14,12,8,0.5)",
                              border: `1px solid ${sel ? "rgba(201,169,110,0.5)" : "#2e2416"}`,
                            }}
                          >
                            <span className={sel ? "text-gold" : "text-zinc-400"}>{SKILL_ZH_BY_KEY[k] ?? k}</span>
                            <span className="flex items-center gap-2">
                              <span className={sel ? "text-gold font-semibold" : "text-zinc-500"}>{v}</span>
                              <span className="text-[10px] text-zinc-600">成功 {applyRateBonus(successRate(v), mods.rateBonus)}%</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between mb-1">
                      <span className="text-zinc-400">本次成功率</span>
                      <span className="text-gold font-bold text-sm">{rate}%</span>
                    </div>
                    {equippedDef && (
                      <p className="text-[10px] text-zinc-600 mb-2 inline-flex items-center gap-1">
                        <Sparkles size={10} strokeWidth={2} />
                        已裝備「{equippedDef.name}」{mods.rateBonus > 0 || mods.pointsMult !== 1 || mods.failFloor !== 0.1 || mods.growthBonus > 0 ? "（效果已計入）" : "（此任務無效果）"}
                      </p>
                    )}
                    <div className="mb-2" />

                    <div className="rounded-lg p-2.5 mb-2" style={{ background: "rgba(6,78,59,0.18)", border: "1px solid rgba(16,94,66,0.5)" }}>
                      <p style={{ color: "#6ee7b7" }} className="inline-flex items-center gap-1"><Sparkles size={11} strokeWidth={2} />成功時</p>
                      <ul className="text-[11px] text-zinc-400 mt-1 space-y-0.5">
                        <li>· 獲得 <span className="text-gold">{pts}</span> 點數</li>
                        <li>· 對「{SKILL_ZH_BY_KEY[chosenKey] ?? chosenKey}」進行成長檢定（擲高於 {chosenVal} 則 +1）</li>
                        <li className="text-zinc-600">· 每名調查員每週最多成長 2 次</li>
                      </ul>
                    </div>
                    <div className="rounded-lg p-2.5 mb-3" style={{ background: "rgba(127,29,29,0.15)", border: "1px solid rgba(153,27,27,0.45)" }}>
                      <p style={{ color: "#fca5a5" }} className="inline-flex items-center gap-1"><CircleX size={11} strokeWidth={2} />失敗時</p>
                      <ul className="text-[11px] text-zinc-400 mt-1 space-y-0.5">
                        <li>· 僅獲得 <span className="text-zinc-300">{Math.ceil(pts * mods.failFloor)}</span> 點數（{Math.round(mods.failFloor * 100)}%）</li>
                        <li>· 不進行成長檢定</li>
                        <li className="text-zinc-600">· 沒有任何其他損失</li>
                      </ul>
                    </div>

                    <button
                      type="button"
                      onClick={() => dispatch(m.key)}
                      disabled={working}
                      className="w-full py-2.5 rounded-lg font-serif text-sm transition-all disabled:opacity-40 hover:brightness-110 inline-flex items-center justify-center gap-1"
                      style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07" }}
                    >
                      {working ? "派遣中…" : <>派 {featured.name} 出發 <ArrowRight size={14} strokeWidth={2} /></>}
                    </button>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Claim result */}
          {result && (
            <div className="rounded-lg p-4 mb-4" style={{ background: "rgba(20,16,11,0.7)", border: "1px solid rgba(201,169,110,0.3)" }}>
              <p className="text-xs uppercase tracking-wider mb-2 inline-flex items-center gap-1" style={{ color: result.success ? "#6ee7b7" : "#fdba74" }}>
                {result.success ? <Sparkles size={12} strokeWidth={2} /> : <CircleX size={12} strokeWidth={2} />}
                {result.success ? "任務成功" : "不太順利"}
              </p>
              <p className="text-sm text-zinc-300 leading-relaxed mb-3">{result.narration}</p>
              <div className="flex items-center gap-4 text-xs flex-wrap mb-2"><span className="text-gold">＋{result.points} 點數</span>{result.growth?.capped && <span className="text-zinc-500">本週成長已達上限</span>}</div>
              {result.growth && !result.growth.capped && (
                growthRevealed
                  ? ((result.growth.gain ?? 0) > 0
                      ? <p className="text-xs inline-flex items-center gap-1" style={{ color: "#6ee7b7" }}><Sparkles size={11} strokeWidth={2} />「{result.growth.skillName}」{result.growth.old} → {result.growth.new}</p>
                      : <p className="text-xs text-zinc-500">成長檢定未通過（{result.growth.d100} ≤ {result.growth.old}）</p>)
                  : <GrowthRollReveal growth={result.growth} onRevealed={() => setGrowthRevealed(true)} />
              )}
              <button type="button" onClick={() => setResult(null)} className="mt-3 block text-xs text-zinc-500 hover:text-zinc-300 underline decoration-dotted">收起</button>
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: "rgba(22,19,16,0.8)", border: "1px solid #2a2418" }}>
              <p className="text-sm text-gold mb-3">近期任務紀錄</p>
              <div className="flex flex-col gap-1.5">
                {history.map((h) => {
                  const m = missionByKey(h.mission_type);
                  const o = h.outcome;
                  const name = cards.find((c) => c.id === h.card_id)?.name ?? "調查員";
                  const grew = o?.growth && (o.growth.gain ?? 0) > 0;
                  return (
                    <div key={h.id} className="flex items-center gap-3 text-xs py-1.5 border-b last:border-0" style={{ borderColor: "rgba(42,36,24,0.6)" }}>
                      <span className={`px-1.5 py-0.5 rounded shrink-0 ${o?.success ? "text-emerald-300" : "text-rose-300"}`} style={{ border: `1px solid ${o?.success ? "rgba(16,94,66,0.6)" : "rgba(153,27,27,0.6)"}`, background: o?.success ? "rgba(6,78,59,0.3)" : "rgba(127,29,29,0.25)" }}>{o?.success ? "成功" : "失敗"}</span>
                      <span className="shrink-0">{m && (() => { const Icon = MISSION_ICON[m.key] ?? Compass; return <Icon size={13} strokeWidth={2} className="text-zinc-500" />; })()}</span>
                      <span className="text-zinc-300 w-24 truncate shrink-0">{m?.name}</span>
                      <span className="text-zinc-500 flex-1 truncate">{name} · {o ? `+${o.points} 點` : "—"}{grew ? `，${o?.growth?.skillName} +1` : ""}</span>
                      <span className="text-gold tabular-nums shrink-0">＋{o?.points ?? 0}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
