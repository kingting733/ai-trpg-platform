"use client";

import { useState } from "react";

export interface Growth {
  skillName?: string;
  d100?: number;
  old?: number;
  gain?: number;
  new?: number;
  capped?: boolean;
}

/** Click-to-roll reveal of the interlude growth check. The result is already
 *  decided by the server (stored in `growth`); this only animates the d100
 *  settling on it — a CoC experience check passes when the roll is OVER the
 *  current skill value. */
export function GrowthRollReveal({ growth, onRevealed }: { growth: Growth; onRevealed: () => void }) {
  const [phase, setPhase] = useState<"idle" | "rolling" | "done">("idle");
  const [display, setDisplay] = useState(0);
  const target = growth.d100 ?? 0;
  const threshold = growth.old ?? 0;
  const passed = (growth.gain ?? 0) > 0;

  function roll() {
    if (phase !== "idle") return;
    setPhase("rolling");
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
    <div className="flex items-center gap-3 flex-wrap">
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
          animation: rolling ? "dice-shake 0.5s ease-in-out infinite" : undefined,
        }}
      >
        <span className="tabular-nums font-bold" style={{ fontSize: phase === "idle" ? 22 : 24, color: numColor }}>
          {phase === "idle" ? "🎲" : display}
        </span>
      </button>

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
