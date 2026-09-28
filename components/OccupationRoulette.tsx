"use client";
// 職業輪盤 — the occupation draw as a roulette wheel.
//
// The occupation is already decided (the server rolled it with the card); the
// wheel only decelerates onto it. It lands inside the target segment at a
// slightly random offset rather than dead-centre, so it never looks rigged.
//
// Driven by requestAnimationFrame rather than a CSS transition so we know the
// angle every frame: the pointer ticks each time a segment boundary passes and
// the label under the wheel reads out whatever is under the pointer.

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Drama, SkipForward } from "lucide-react";
import { gold, usePrefersReducedMotion } from "@/components/GachaSummon";

const SIZE = 288;
const C = SIZE / 2;
const R_RIM = 142;   // static outer rim with the bulbs
const R_BULB = 134;
const R_SEG = 124;   // rotating segment disc
const R_ICON = 88;
const R_HUB = 30;
const ICON = 40;
const BULBS = 24;
const SPIN_MS = 6200;
const SPIN_TURNS = 6;

/** Point at radius r, `deg` degrees clockwise from 12 o'clock. */
function pt(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}

function sector(r: number, a0: number, a1: number): string {
  const [x0, y0] = pt(r, a0);
  const [x1, y1] = pt(r, a1);
  return `M${C},${C} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
}

function hubStar(r: number): string {
  const p: string[] = [];
  for (let k = 0; k < 5; k++) {
    const [x, y] = pt(r, k * 144);
    p.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return p.join(" ");
}

export function OccupationRoulette({ occupation, icons, onLocked }: {
  occupation: string;
  /** occupation name → portrait path under /public */
  icons: Record<string, string>;
  onLocked?: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  // An occupation missing from the icon map still gets a segment (and lands).
  const names = useMemo(() => {
    const all = Object.keys(icons);
    return all.includes(occupation) ? all : [occupation, ...all];
  }, [icons, occupation]);
  const n = names.length;
  const seg = 360 / n;
  const target = names.indexOf(occupation);

  const wheelRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<HTMLDivElement>(null);
  const angle = useRef(0);
  const endAngle = useRef<number | null>(null);
  const raf = useRef(0);
  const lastIdx = useRef(-1);
  const [phase, setPhase] = useState<"idle" | "spinning" | "locked">("idle");
  const [under, setUnder] = useState(names[0]);

  /** Which segment sits under the pointer (12 o'clock) at wheel rotation r. */
  const indexAt = useCallback((r: number) => {
    const c = (((-r) % 360) + 360) % 360;
    return Math.floor(c / seg) % n;
  }, [seg, n]);

  const paint = useCallback((tick: boolean) => {
    if (wheelRef.current) wheelRef.current.style.transform = `rotate(${angle.current}deg)`;
    const i = indexAt(angle.current);
    if (i !== lastIdx.current) {
      lastIdx.current = i;
      setUnder(names[i]);
      const p = pointerRef.current;
      if (tick && p) { p.classList.remove("is-tick"); void p.offsetWidth; p.classList.add("is-tick"); }
    }
  }, [indexAt, names]);

  // Idle: the wheel drifts slowly so it reads as a wheel, not a picture.
  // Its frame id is LOCAL on purpose: this effect's cleanup runs right after
  // spin() starts, and cancelling the shared raf ref there would kill the spin
  // loop on its first frame.
  useEffect(() => {
    if (phase !== "idle") return;
    paint(false);
    if (reduced) return;
    let id = 0;
    let prev = performance.now();
    const step = (now: number) => {
      angle.current += (now - prev) * 0.015;
      prev = now;
      paint(false);
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [phase, reduced, paint]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const lock = useCallback(() => {
    setPhase("locked");
    setUnder(occupation);
    onLocked?.();
  }, [occupation, onLocked]);

  const spin = useCallback(() => {
    if (phase !== "idle") return;
    const start = angle.current;
    // Land inside the target segment, off-centre by up to ±27% of its width.
    const c = target * seg + seg / 2 + (Math.random() - 0.5) * seg * 0.55;
    let end = -c;
    end += 360 * Math.ceil((start + 360 * SPIN_TURNS - end) / 360);
    endAngle.current = end;
    if (reduced) { angle.current = end; paint(false); lock(); return; }
    setPhase("spinning");
    const t0 = performance.now();
    const ease = (p: number) => 1 - Math.pow(1 - p, 4);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / SPIN_MS);
      angle.current = start + (end - start) * ease(p);
      paint(true);
      if (p < 1) raf.current = requestAnimationFrame(step);
      else lock();
    };
    raf.current = requestAnimationFrame(step);
  }, [phase, target, seg, reduced, paint, lock]);

  const skip = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (endAngle.current == null) {
      const base = -(target * seg + seg / 2);
      endAngle.current = base + 360 * Math.ceil((angle.current + 360 - base) / 360);
    }
    angle.current = endAngle.current;
    paint(false);
    lock();
  }, [target, seg, paint, lock]);

  // Space / Enter spins, like the dice.
  useEffect(() => {
    if (phase !== "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); spin(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, spin]);

  const locked = phase === "locked";

  return (
    <div className="flex flex-col items-center gap-4">
      <div className={`gacha-wheel-wrap${phase === "spinning" ? " is-spinning" : ""}${locked ? " is-locked" : ""}`}
        style={{ width: SIZE, height: SIZE }}>
        {/* static rim + chasing bulbs */}
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0" aria-hidden>
          <circle cx={C} cy={C} r={R_RIM} fill="#0c0a07" stroke={gold(0.55)} strokeWidth="1.5" />
          <circle cx={C} cy={C} r={R_RIM - 5} fill="none" stroke={gold(0.18)} />
          {Array.from({ length: BULBS }, (_, i) => {
            const [x, y] = pt(R_BULB, (i * 360) / BULBS);
            return <circle key={i} cx={x} cy={y} r="2.6" className={`gacha-bulb${i % 2 ? " is-odd" : ""}`} />;
          })}
        </svg>

        {/* rotating disc */}
        <div ref={wheelRef} className="gacha-wheel absolute inset-0">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0" aria-hidden>
            {names.map((nm, i) => (
              <path key={nm} d={sector(R_SEG, i * seg, (i + 1) * seg)}
                fill={i % 2 ? "#13100b" : "#1a1612"} stroke={gold(0.3)} strokeWidth="1"
                className={locked && i === target ? "gacha-seg-win" : undefined} />
            ))}
            <circle cx={C} cy={C} r={R_SEG} fill="none" stroke={gold(0.5)} strokeWidth="1.2" />
            <circle cx={C} cy={C} r={R_SEG - 22} fill="none" stroke={gold(0.12)} strokeDasharray="2 4" />
          </svg>
          {names.map((nm, i) => {
            const a = i * seg + seg / 2;
            const [x, y] = pt(R_ICON, a);
            return (
              <div key={nm} className="absolute flex items-center justify-center"
                style={{ left: x - ICON / 2, top: y - ICON / 2, width: ICON, height: ICON, transform: `rotate(${a}deg)` }}>
                {icons[nm]
                  ? <Image src={icons[nm]} alt={nm} width={ICON} height={ICON} sizes={`${ICON}px`}
                      className={`gacha-wheel-icon${locked && i === target ? " is-win" : ""}`} />
                  : <Drama size={24} strokeWidth={1.5} style={{ color: gold(0.7) }} />}
              </div>
            );
          })}
        </div>

        {/* static hub */}
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 pointer-events-none" aria-hidden>
          <circle cx={C} cy={C} r={R_HUB + 6} fill="none" stroke={gold(0.2)} />
          <circle cx={C} cy={C} r={R_HUB} fill="#0c0a07" stroke={gold(0.6)} strokeWidth="1.2" />
          <polygon points={hubStar(R_HUB - 8)} fill="none" stroke={gold(0.55)} strokeWidth="1" strokeLinejoin="round" />
          <circle cx={C} cy={C} r="3" fill={gold(0.85)} />
        </svg>

        {/* pointer */}
        <div ref={pointerRef} className="gacha-wheel-pointer" aria-hidden>
          <svg viewBox="0 0 26 34" width="26" height="34">
            <path d="M13 33 L2 6 Q13 -2 24 6 Z" fill="#c9a96e" stroke="#0c0a07" strokeWidth="1.5" strokeLinejoin="round" />
            <circle cx="13" cy="9" r="3" fill="#0c0a07" />
          </svg>
        </div>
      </div>

      <div className="h-10 flex items-center justify-center">
        <span key={locked ? "locked" : "rolling"}
          className={`font-serif text-2xl tracking-[0.1em]${locked ? " gacha-wheel-winner" : ""}`}
          style={{ color: locked ? "#e4d8be" : gold(phase === "spinning" ? 0.75 : 0.4) }}>
          {phase === "idle" ? "？？？" : under}
        </span>
      </div>

      {phase === "idle" && (
        <button type="button" onClick={spin}
          className="gacha-roll-btn is-armed w-full py-2.5 rounded-lg font-serif text-sm tracking-[0.2em] transition-all"
          style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07" }}>
          轉動命運之輪
        </button>
      )}
      {phase === "spinning" && (
        <button type="button" onClick={skip}
          className="inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-400">
          跳過 <SkipForward size={12} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
