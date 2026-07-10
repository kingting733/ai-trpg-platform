"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  INTERLUDE_MISSIONS,
  missionByKey,
  bestRelevantSkill,
  successRate,
  pointsFor,
  failPoints,
} from "@/lib/game/interlude";

interface CardLike {
  id: string;
  name: string;
  skills: Record<string, number> | null;
  dex: number;
  app: number;
}

interface ActiveMission {
  id: string;
  card_id: string;
  mission_type: string;
  success_rate: number;
  points_on_success: number;
  claimable_at: string;
}

interface Growth { skillName?: string; d100?: number; old?: number; gain?: number; new?: number; capped?: boolean }

interface Outcome {
  roll: number;
  success: boolean;
  points: number;
  growth: Growth | null;
  narration: string;
}

/** Click-to-roll reveal of the interlude growth check. The result is already
 *  decided by the server (stored in `growth`); this only animates the d100
 *  settling on it — a CoC experience check passes when the roll is OVER the
 *  current skill value. */
function GrowthRollReveal({ growth, onRevealed }: { growth: Growth; onRevealed: () => void }) {
  const [phase, setPhase] = useState<"idle" | "rolling" | "done">("idle");
  const [display, setDisplay] = useState(0);
  const target = growth.d100 ?? 0;
  const threshold = growth.old ?? 0;
  const passed = (growth.gain ?? 0) > 0;

  function roll() {
    if (phase !== "idle") return;
    setPhase("rolling");
    // Slot-machine deceleration: fast at first, then slowing before it lands.
    const delays = [60, 60, 60, 60, 70, 80, 100, 130, 175, 240, 330, 450];
    let i = 0;
    const tick = () => {
      if (i < delays.length - 1) {
        setDisplay(Math.floor(Math.random() * 100) + 1);
        setTimeout(tick, delays[i++]);
      } else {
        setDisplay(target);
        setPhase("done");
        onRevealed();
      }
    };
    setTimeout(tick, delays[i++]);
  }

  const rolling = phase === "rolling";
  const done = phase === "done";
  const glow = done ? (passed ? "rgba(110,231,183,0.5)" : "rgba(120,120,120,0.25)") : "rgba(201,169,110,0.3)";
  const numColor = done ? (passed ? "#6ee7b7" : "#a1a1aa") : "#e4d8be";

  return (
    <div className="flex items-center gap-3 flex-wrap mt-1">
      {/* The die */}
      <button
        type="button"
        onClick={roll}
        disabled={phase !== "idle"}
        title={phase === "idle" ? "點擊擲骰" : undefined}
        className={`relative w-16 h-16 rounded-xl flex items-center justify-center shrink-0 transition-all ${phase === "idle" ? "cursor-pointer hover:brightness-125" : "cursor-default"}`}
        style={{
          background: "linear-gradient(150deg,#1c1813,#0f0c08)",
          border: `1.5px solid ${glow}`,
          boxShadow: `0 0 ${done ? 20 : 12}px ${glow}`,
          // `dice-shake` keyframes are defined globally in globals.css.
          animation: rolling ? "dice-shake 0.5s ease-in-out infinite" : undefined,
        }}
      >
        <span className="tabular-nums font-bold" style={{ fontSize: phase === "idle" ? 22 : 24, color: numColor }}>
          {phase === "idle" ? "🎲" : display}
        </span>
      </button>

      {/* Label / result */}
      <div className="text-xs">
        {phase === "idle" && (
          <>
            <p className="text-gold">點擊擲骰進行成長檢定</p>
            <p className="text-zinc-600 mt-0.5">「{growth.skillName}」目前 {threshold} — 擲出高於 {threshold} 即成長</p>
          </>
        )}
        {rolling && <p className="text-zinc-400">擲骰中…（目標：高於 {threshold}）</p>}
        {done && (
          passed
            ? <p style={{ color: "#6ee7b7" }}>✦ 成長檢定通過！「{growth.skillName}」{growth.old} → <span className="font-bold">{growth.new}</span></p>
            : <p className="text-zinc-500">成長檢定未通過（{target} ≤ {threshold}）。下次再努力。</p>
        )}
      </div>
    </div>
  );
}

/** 幕間任務 — dispatch a card on a 24h off-screen mission from the 調查員 page.
 *  All outcomes are server-rolled; this panel only previews rates (same pure
 *  formulas) and renders the claim result. */
export function InterludePanel({ cards, onCardsChanged }: { cards: CardLike[]; onCardsChanged: () => void }) {
  const [points, setPoints] = useState<number | null>(null);
  const [active, setActive] = useState<ActiveMission | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickedCardId, setPickedCardId] = useState<string>("");
  const [busyCardIds, setBusyCardIds] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  // false while a rollable growth check awaits the player's click-to-roll.
  const [growthRevealed, setGrowthRevealed] = useState(true);
  const [now, setNow] = useState(Date.now());

  async function load() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [{ data: u }, { data: missions }, { data: inRooms }] = await Promise.all([
      supabase.from("users").select("points").eq("id", user.id).single(),
      supabase.from("card_missions").select("id, card_id, mission_type, success_rate, points_on_success, claimable_at").is("claimed_at", null).eq("user_id", user.id),
      supabase.from("characters").select("source_card_id, rooms!inner(status)").eq("user_id", user.id).in("rooms.status", ["waiting", "in_progress"]),
    ]);
    setPoints(u?.points ?? 0);
    setActive((missions?.[0] as ActiveMission) ?? null);
    setBusyCardIds(new Set((inRooms ?? []).map((r: any) => r.source_card_id).filter(Boolean)));
    setLoading(false);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Ticking countdown while a mission is out.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  async function dispatch(missionKey: string) {
    if (!pickedCardId || working) return;
    setWorking(true); setError(null);
    try {
      const res = await fetch("/api/interlude/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: pickedCardId, missionType: missionKey }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "出發失敗。");
      else await load();
    } catch { setError("網路錯誤，請再試一次。"); }
    setWorking(false);
  }

  async function claim() {
    if (!active || working) return;
    setWorking(true); setError(null);
    try {
      const res = await fetch("/api/interlude/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId: active.id }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "領取失敗。");
      else {
        const outcome = (data.outcome as Outcome) ?? null;
        setResult(outcome);
        // A growth check with a real d100 (success mission, not capped) waits for
        // the player to click-to-roll; everything else reveals immediately.
        const g = outcome?.growth;
        setGrowthRevealed(!(g && !g.capped && typeof g.d100 === "number"));
        await load();
        onCardsChanged(); // growth may have bumped a skill
      }
    } catch { setError("網路錯誤，請再試一次。"); }
    setWorking(false);
  }

  async function cancel() {
    if (!active || working) return;
    if (!window.confirm("取消任務會放棄所有獎勵，確定讓調查員提前回來？")) return;
    setWorking(true); setError(null);
    try {
      const res = await fetch("/api/interlude/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId: active.id }),
      });
      if (!res.ok) setError((await res.json()).error ?? "取消失敗。");
      else await load();
    } catch { setError("網路錯誤，請再試一次。"); }
    setWorking(false);
  }

  const pickedCard = cards.find((c) => c.id === pickedCardId) ?? null;
  const idleCards = cards.filter((c) => !busyCardIds.has(c.id));
  const activeMission = active ? missionByKey(active.mission_type) : null;
  const activeCard = active ? cards.find((c) => c.id === active.card_id) : null;
  const remainMs = active ? new Date(active.claimable_at).getTime() - now : 0;
  const claimable = active !== null && remainMs <= 0;

  const fmt = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `${h}小時 ${String(m).padStart(2, "0")}分 ${String(s % 60).padStart(2, "0")}秒`;
  };

  if (loading) return null;

  return (
    <div className="rounded-xl p-5 mb-8" style={{ background: "rgba(22,19,16,0.8)", border: "1px solid #2a2418" }}>
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h2 className="font-serif text-gold text-lg">🕯 幕間任務</h2>
        <span className="text-sm text-zinc-400">點數 <span className="text-gold font-bold tabular-nums">{points ?? "—"}</span></span>
      </div>
      <p className="text-xs text-zinc-600 mb-4">派一位調查員離隊 24 小時執行任務。期間無法參加冒險；歸來時領取點數，成功還有機會成長（每週每位最多 +2）。失敗只會少收穫，不會有任何損失。</p>

      {error && (
        <div className="text-xs rounded-lg px-3 py-2 mb-3" style={{ background: "rgba(127,29,29,0.2)", border: "1px solid rgba(185,28,28,0.5)", color: "#fca5a5" }}>
          {error}
        </div>
      )}

      {/* ── Claim result story ── */}
      {result && (
        <div className="rounded-lg p-4 mb-4" style={{ background: "rgba(20,16,11,0.7)", border: "1px solid rgba(201,169,110,0.3)" }}>
          <p className="text-xs uppercase tracking-wider mb-2" style={{ color: result.success ? "#6ee7b7" : "#fdba74" }}>
            {result.success ? "✦ 任務成功" : "✧ 不太順利"}
          </p>
          <p className="text-sm text-zinc-300 leading-relaxed mb-3">{result.narration}</p>
          <div className="flex items-center gap-4 text-xs flex-wrap">
            <span className="text-gold">＋{result.points} 點數</span>
            {result.growth && result.growth.capped && <span className="text-zinc-500">本週成長已達上限</span>}
          </div>
          {/* Growth check — click-to-roll dice reveal (success missions only) */}
          {result.growth && !result.growth.capped && (
            growthRevealed
              ? (
                (result.growth.gain ?? 0) > 0
                  ? <p className="text-xs mt-2" style={{ color: "#6ee7b7" }}>✦ 「{result.growth.skillName}」成長檢定通過 {result.growth.old} → {result.growth.new}</p>
                  : <p className="text-xs mt-2 text-zinc-500">成長檢定未通過（{result.growth.d100} ≤ {result.growth.old}）</p>
              )
              : <GrowthRollReveal growth={result.growth} onRevealed={() => setGrowthRevealed(true)} />
          )}
          <button type="button" onClick={() => setResult(null)} className="mt-3 block text-xs text-zinc-500 hover:text-zinc-300 underline decoration-dotted">收起</button>
        </div>
      )}

      {active ? (
        /* ── Mission in progress ── */
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm text-zinc-300">
              <span className="text-gold font-medium">{activeCard?.name ?? "調查員"}</span> 正在執行
              <span className="text-gold font-medium">「{activeMission?.name ?? active.mission_type}」</span>
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              成功率 {active.success_rate}% · 成功可得 {active.points_on_success} 點
              {claimable ? <span className="ml-2" style={{ color: "#6ee7b7" }}>已歸來！</span> : <span className="ml-2">尚餘 {fmt(remainMs)}</span>}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={claim}
              disabled={!claimable || working}
              className="px-5 py-2.5 rounded-lg font-serif text-sm transition-all disabled:opacity-40 hover:brightness-110"
              style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07" }}
            >
              {working ? "..." : "領取成果"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={working}
              className="px-3 py-2.5 rounded-lg text-xs transition-colors disabled:opacity-40"
              style={{ border: "1px solid rgba(185,28,28,0.4)", color: "#f87171" }}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        /* ── Dispatch picker ── */
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-zinc-500">派出：</span>
            <select
              value={pickedCardId}
              onChange={(e) => setPickedCardId(e.target.value)}
              className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none"
            >
              <option value="">選擇調查員</option>
              {idleCards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {cards.length > idleCards.length && (
              <span className="text-[11px] text-zinc-600">（冒險中的調查員不能派出）</span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {INTERLUDE_MISSIONS.map((m) => {
              const best = pickedCard ? bestRelevantSkill({ skills: pickedCard.skills, dex: pickedCard.dex, app: pickedCard.app }, m) : null;
              const rate = best ? successRate(best.value) : null;
              const pts = best ? pointsFor(best.value) : null;
              return (
                <button
                  key={m.key}
                  type="button"
                  disabled={!pickedCard || working}
                  onClick={() => dispatch(m.key)}
                  className="text-left rounded-lg p-3 transition-all disabled:opacity-40 hover:brightness-110"
                  style={{ background: "rgba(26,21,14,0.6)", border: "1px solid #2e2416" }}
                >
                  <p className="text-sm text-zinc-200 mb-0.5">{m.emoji} {m.name}</p>
                  <p className="text-[11px] text-zinc-600 leading-snug mb-1.5">{m.desc}</p>
                  {best && rate != null && pts != null ? (
                    <p className="text-[11px]">
                      <span className="text-gold">成功率 {rate}%</span>
                      <span className="text-zinc-500"> · 成功 {pts} 點 / 失敗 {failPoints(pts)} 點</span>
                    </p>
                  ) : (
                    <p className="text-[11px] text-zinc-700">先選擇調查員查看成功率</p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
