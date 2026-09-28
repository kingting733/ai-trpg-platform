"use client";
// 調查員召喚 — the gacha sequence that opens a newly drawn character card.
//
//   封印 seal   → a face-down dossier; tap to break it. Light leaks through
//                 cracks. Common and Rare look identical here on purpose (the
//                 dice have not spoken yet); Epic cracks harder, Legendary
//                 shakes the screen — the classic "something's coming" tell.
//   擲骰 dice   → the player rolls each stat by hand (擲骰 / Space); real 3D
//                 dice land on the SERVER's rolled faces (roll_details).
//                 An optional 自動 toggle rolls on its own. A rarity meter fills as each stat lands and
//                 fires a breakthrough when it crosses 稀有/史詩/傳奇. The climb
//                 is honest: rarity IS the sum of these dice. If the last stat
//                 can still change the tier, it becomes 「命運的一擲」: the
//                 tray waits, trembling, for the player's click.
//   顯現 reveal → flash, shockwave, god rays scaled to tier; the card flips,
//                 the total counts up and a rarity seal-stamp slams down.
//
// Nothing here decides anything: every number comes from the card the server
// already persisted. Rarity is shown as gold INTENSITY and light only — the
// same rule app/characters/page.tsx follows — never as new hues.
// prefers-reduced-motion collapses every stage to near-instant fades.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, Dices, Repeat, SkipForward } from "lucide-react";
import { MAX_TOTAL_STATS, RARITY_THRESHOLDS, rarityForTotal, type Rarity } from "@/lib/cards/dice";

// ─── Card shape (structurally compatible with CardRollReveal's RevealCard) ────

type StatKey = "str" | "con" | "siz" | "dex" | "app" | "int" | "pow" | "edu" | "luck";

export interface SummonCard {
  name: string;
  rarity: Rarity;
  total_stats: number;
  hp: number; san: number; mp: number;
  str: number; con: number; siz: number; dex: number; app: number;
  int: number; pow: number; edu: number; luck: number;
  occupation?: string | null;
  roll_details: Partial<Record<StatKey, { dice: number[]; base?: number }>> | null;
}

// ─── Rarity tiers: gold intensity + amount of light, no new colours ──────────

export const TIER: Record<Rarity, {
  zh: string;
  frame: number;   // frame alpha — identical to app/characters/page.tsx RARITY_STYLES
  glow: number;    // aura strength
  rays: number;    // god-ray alpha on reveal (0 = none)
  rings: number;   // shockwave rings on reveal
  sparks: number;  // spark count on reveal
  cracks: number;  // light cracks when the seal breaks
  amp: number;     // seal jitter amplitude (px)
  shake: boolean;  // screen shake on break + reveal
}> = {
  Common:    { zh: "普通", frame: 0.12, glow: 0.10, rays: 0,    rings: 1, sparks: 0,  cracks: 3, amp: 1,   shake: false },
  Rare:      { zh: "稀有", frame: 0.22, glow: 0.20, rays: 0.10, rings: 1, sparks: 12, cracks: 3, amp: 1,   shake: false },
  Epic:      { zh: "史詩", frame: 0.32, glow: 0.34, rays: 0.20, rings: 2, sparks: 22, cracks: 5, amp: 2,   shake: false },
  Legendary: { zh: "傳奇", frame: 0.45, glow: 0.55, rays: 0.32, rings: 3, sparks: 34, cracks: 8, amp: 3.5, shake: true  },
};

export const gold = (a: number) => `rgba(201,169,110,${a})`;
const PARCHMENT = "#e4d8be";

// ─── Stat steps ───────────────────────────────────────────────────────────────

const STAT_META: { key: StatKey; label: string; zh: string; desc: string; base: number }[] = [
  { key: "str",  label: "STR",  zh: "力量", base: 0, desc: "近戰傷害與力量檢定（搬、推、抓握）" },
  { key: "con",  label: "CON",  zh: "體質", base: 0, desc: "生命值，以及抵抗疾病與毒素的能力" },
  { key: "siz",  label: "SIZ",  zh: "體型", base: 6, desc: "生命值與近戰傷害加值（體格越大越痛）" },
  { key: "dex",  label: "DEX",  zh: "敏捷", base: 0, desc: "行動順序、閃避，以及各種身手檢定" },
  { key: "app",  label: "APP",  zh: "外貌", base: 0, desc: "魅惑與社交第一印象的基礎" },
  { key: "int",  label: "INT",  zh: "智力", base: 6, desc: "推理、靈感檢定，並提供技能點數" },
  { key: "pow",  label: "POW",  zh: "意志", base: 0, desc: "魔力上限、理智抵抗與意志對抗" },
  { key: "edu",  label: "EDU",  zh: "教育", base: 6, desc: "知識類技能，並提供大量技能點數" },
  { key: "luck", label: "LUCK", zh: "幸運", base: 0, desc: "運氣檢定與面對隨機事件的命運" },
];

export interface StatStep {
  key: StatKey; label: string; zh: string; desc: string;
  dice: number[];   // raw d6 faces from roll_details ([] for legacy cards)
  base: number;     // raw flat bonus before ×5 (6 for SIZ/INT/EDU)
  total: number;    // the stored stat
  max: number;      // highest this stat could have rolled
}

export function buildStatSteps(card: SummonCard): StatStep[] {
  const rd = card.roll_details;
  return STAT_META.map((m) => {
    const raw = rd?.[m.key]?.dice;
    const dice = Array.isArray(raw) ? raw : [];
    const base = rd?.[m.key]?.base ?? m.base;
    return { ...m, dice, base, total: card[m.key], max: 90 };
  });
}

const isDie = (d: unknown) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 6;

// ─── Hooks & small helpers ────────────────────────────────────────────────────

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return reduced;
}

/** Small seeded PRNG. The dust motes render on first paint, so they must be
 *  identical on the server and the client (Math.random() there is a hydration
 *  mismatch). Effects that only appear after interaction may use Math.random(). */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** setTimeout that is cleared on unmount — every stage transition goes through this. */
function useTimers() {
  const ids = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => ids.current.forEach(clearTimeout), []);
  const later = useCallback((fn: () => void, ms: number) => {
    ids.current.push(setTimeout(fn, ms));
  }, []);
  const clearAll = useCallback(() => { ids.current.forEach(clearTimeout); ids.current = []; }, []);
  return { later, clearAll };
}

function CountUp({ from = 0, to, ms, reduced, onDone }: {
  from?: number; to: number; ms: number; reduced: boolean; onDone?: () => void;
}) {
  const [v, setV] = useState(reduced ? to : from);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (reduced || ms <= 0) { setV(to); done.current?.(); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      setV(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
      else done.current?.();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, ms, reduced]);
  return <>{v}</>;
}

// ─── 3D die ───────────────────────────────────────────────────────────────────
// Face placement and the cube rotation that brings each face to the viewer were
// verified numerically (every face lands face-up with any number of extra full
// turns; opposite faces sum to 7).

const FACE_PLACE: Record<number, string> = {
  1: "rotateY(0deg)", 6: "rotateY(180deg)", 2: "rotateY(90deg)",
  5: "rotateY(-90deg)", 3: "rotateX(90deg)", 4: "rotateX(-90deg)",
};
const FACE_SHOW: Record<number, [number, number]> = {
  1: [0, 0], 6: [0, 180], 2: [0, -90], 5: [0, 90], 3: [-90, 0], 4: [90, 0],
};
const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

function Die3D({ value, delay, duration, reduced, idle = false, tremble = false, size = 54 }: {
  value: number; delay: number; duration: number; reduced: boolean;
  /** Waiting in the tray for the player to roll: a neutral pose that never
   *  shows the result face-on, so nothing is spoiled. */
  idle?: boolean;
  tremble?: boolean;
  size?: number;
}) {
  // Start at a random orientation behind the target so the tumble always spins
  // forward; land on target + whole turns (same face, more drama).
  const [pose, setPose] = useState<[number, number]>(() =>
    idle ? [-28 - Math.random() * 20, 35 + Math.random() * 30]
      : reduced ? FACE_SHOW[value] : [-(120 + Math.random() * 300), -(120 + Math.random() * 300)]
  );
  const [landed, setLanded] = useState(reduced && !idle);

  useEffect(() => {
    if (idle) return;
    if (reduced) { setPose(FACE_SHOW[value]); setLanded(true); return; }
    const [fx, fy] = FACE_SHOW[value];
    let r1 = 0, r2 = 0;
    // Two frames so the start pose is painted before the transition target is set.
    r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setPose([fx + 720, fy + 1080])); });
    const t = setTimeout(() => setLanded(true), delay + duration);
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); clearTimeout(t); };
  }, [value, delay, duration, reduced, idle]);

  const tossStyle: CSSProperties = reduced || idle
    ? {}
    : { animationDuration: `${duration}ms`, animationDelay: `${delay}ms` };
  const motion = reduced ? "" : idle ? (tremble ? "gacha-die-tremble" : "gacha-die-idle") : "gacha-die-toss";

  return (
    <div className={`gacha-die-slot${landed ? " is-landed" : ""}${idle ? " is-idle" : ""}`} style={{ width: size, height: size }}>
      <div className={reduced || idle ? "gacha-die-shadow-rest" : "gacha-die-shadow"} style={tossStyle} />
      <div className={motion} style={tossStyle}>
        <div className="gacha-die-tilt">
          <div
            className="gacha-die"
            style={{
              width: size, height: size,
              transform: `rotateX(${pose[0]}deg) rotateY(${pose[1]}deg)`,
              transition: reduced || idle ? "none" : `transform ${duration}ms cubic-bezier(.12,.7,.2,1) ${delay}ms`,
            }}
          >
            {[1, 2, 3, 4, 5, 6].map((f) => (
              <div
                key={f}
                className={`gacha-die-face${landed && f === value ? " is-result" : ""}`}
                style={{ transform: `${FACE_PLACE[f]} translateZ(${size / 2}px)` }}
              >
                {Array.from({ length: 9 }, (_, i) => (
                  <span key={i} className={PIPS[f].includes(i) ? "gacha-pip" : ""} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Card back (the seal) ─────────────────────────────────────────────────────

const CX = 100, CY = 140;

function pentagram(r: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 5; k++) {
    const a = ((-90 + k * 144) * Math.PI) / 180;
    pts.push(`${(CX + r * Math.cos(a)).toFixed(1)},${(CY + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

function crackPaths(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const base = (i * 360) / n + Math.random() * 24 - 12;
    const pts: string[] = [];
    for (const r of [8, 34, 62, 96, 150]) {
      const a = ((base + Math.random() * 26 - 13) * Math.PI) / 180;
      pts.push(`${(CX + r * Math.cos(a)).toFixed(1)},${(CY + r * Math.sin(a)).toFixed(1)}`);
    }
    out.push(`M${pts.join(" L")}`);
  }
  return out;
}

function CardBack({ breaking, cracks, holdMs, reduced }: {
  breaking: boolean; cracks: string[]; holdMs: number; reduced: boolean;
}) {
  return (
    <svg viewBox="0 0 200 280" className="absolute inset-0 w-full h-full" aria-hidden>
      <defs>
        <radialGradient id="gacha-back-bg" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor="#201d17" />
          <stop offset="100%" stopColor="#0c0a07" />
        </radialGradient>
      </defs>
      <rect x="1" y="1" width="198" height="278" rx="14" fill="url(#gacha-back-bg)" />
      <rect x="8" y="8" width="184" height="264" rx="10" fill="none" stroke={gold(0.55)} strokeWidth="1.2" />
      <rect x="15" y="15" width="170" height="250" rx="6" fill="none" stroke={gold(0.22)} strokeWidth="0.8" />
      {[[15, 15], [185, 15], [15, 265], [185, 265]].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y - 5} L${x + 5} ${y} L${x} ${y + 5} L${x - 5} ${y} Z`} fill={gold(0.45)} />
      ))}
      <circle cx={CX} cy={CY} r="58" fill="none" stroke={gold(0.2)} strokeDasharray="2 5" />
      <circle cx={CX} cy={CY} r="48" fill="none" stroke={gold(0.5)} strokeWidth="1.1" />
      <polygon points={pentagram(42)} fill="none" stroke={gold(0.6)} strokeWidth="1.1" strokeLinejoin="round" />
      <ellipse cx={CX} cy={CY} rx="12" ry="6.5" fill="none" stroke={gold(0.75)} strokeWidth="1.1" />
      <circle cx={CX} cy={CY} r="3.2" fill={gold(0.85)} />
      <text x={CX} y="238" textAnchor="middle" fontSize="11" letterSpacing="4"
        fill={gold(0.55)} style={{ fontFamily: "'Noto Serif TC', serif" }}>調查員檔案</text>
      <text x={CX} y="44" textAnchor="middle" fontSize="8" letterSpacing="5"
        fill={gold(0.35)} style={{ fontFamily: "'Cormorant', serif" }}>SEALED</text>
      {breaking && cracks.map((d, i) => (
        <path key={i} d={d} className={reduced ? "" : "gacha-crack"} fill="none"
          stroke={PARCHMENT} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
          style={reduced ? undefined : { animationDelay: `${(i * holdMs * 0.7) / cracks.length}ms` }} />
      ))}
    </svg>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Stage = "seal" | "breaking" | "dice" | "reveal";
type RollPhase = "ready" | "rolling" | "landed";

interface RollTiming { toss: number; stagger: number; lead: number }

const TIER_ORDER: Rarity[] = ["Common", "Rare", "Epic", "Legendary"];
const THRESHOLDS: { tier: Rarity; at: number }[] = [
  { tier: "Rare", at: RARITY_THRESHOLDS.Rare },
  { tier: "Epic", at: RARITY_THRESHOLDS.Epic },
  { tier: "Legendary", at: RARITY_THRESHOLDS.Legendary },
];

export function GachaSummon({ card, onComplete }: { card: SummonCard; onComplete: () => void }) {
  const reduced = usePrefersReducedMotion();
  const { later, clearAll } = useTimers();
  const steps = useMemo(() => buildStatSteps(card), [card]);
  // Legacy cards (no roll_details) have no faces to land on: seal → reveal.
  const hasDice = steps.every((s) => s.dice.length > 0 && s.dice.every(isDie));
  const tier = TIER[card.rarity];
  const last = steps.length - 1;

  const [stage, setStage] = useState<Stage>("seal");
  const [flash, setFlash] = useState(false);
  const [shake, setShake] = useState(false);
  const [idx, setIdx] = useState(0);
  const [rollPhase, setRollPhase] = useState<RollPhase>("ready");
  const [rollNo, setRollNo] = useState(0);
  const [landedCount, setLandedCount] = useState(0);
  const [roll, setRoll] = useState<RollTiming>({ toss: 0, stagger: 0, lead: 0 });
  const [breakthrough, setBreakthrough] = useState<Rarity | null>(null);
  const [auto, setAuto] = useState(false);
  const [counted, setCounted] = useState(false);
  const [stamped, setStamped] = useState(false);
  const leaving = useRef(false);

  const cracks = useMemo(() => crackPaths(tier.cracks), [tier.cracks]);
  const motes = useMemo(() => {
    const rnd = seeded(7331);
    return Array.from({ length: 18 }, () => ({
      left: rnd() * 100, size: 2 + rnd() * 2.5,
      dur: 5 + rnd() * 5, delay: -rnd() * 9, drift: rnd() * 40 - 20,
    }));
  }, []);
  const sparks = useMemo(() => Array.from({ length: tier.sparks }, (_, i) => {
    const a = (i / Math.max(1, tier.sparks)) * Math.PI * 2 + Math.random() * 0.4;
    const d = 140 + Math.random() * 180;
    return { dx: Math.cos(a) * d, dy: Math.sin(a) * d, delay: Math.random() * 160, size: 2.5 + Math.random() * 3 };
  }), [tier.sparks]);

  const running = steps.slice(0, landedCount).reduce((s, x) => s + x.total, 0);
  const runningTier = rarityForTotal(running);
  const intensity = TIER_ORDER.indexOf(runningTier) / 3;

  // Would the LAST stat's roll decide the tier? Then it is the fate roll.
  const beforeLast = steps.slice(0, last).reduce((s, x) => s + x.total, 0);
  const fateTarget = THRESHOLDS.find((t) => t.at > beforeLast && beforeLast + steps[last].max >= t.at) ?? null;
  const isFate = useCallback((i: number) => i === last && !!fateTarget && !reduced, [last, fateTarget, reduced]);

  const flashTo = useCallback((next: Stage, withShake: boolean) => {
    if (reduced) { setStage(next); return; }
    setFlash(true);
    if (withShake) setShake(true);
    later(() => { setStage(next); }, 180);
    later(() => { setFlash(false); setShake(false); }, 750);
  }, [later, reduced]);

  // ── seal ──
  const holdMs = reduced ? 0 : card.rarity === "Legendary" ? 2000 : card.rarity === "Epic" ? 1550 : 1200;
  const breakSeal = useCallback(() => {
    if (stage !== "seal") return;
    setStage("breaking");
    if (tier.shake && !reduced) later(() => setShake(true), holdMs * 0.5);
    later(() => flashTo(hasDice ? "dice" : "reveal", false), holdMs);
  }, [stage, tier.shake, reduced, later, holdMs, flashTo, hasDice]);

  // ── dice: the player rolls each stat; every toss starts from a click (or 自動) ──
  const rollStat = useCallback((i: number) => {
    const fate = isFate(i);
    const t: RollTiming = reduced
      ? { toss: 0, stagger: 0, lead: 0 }
      : { toss: fate ? 1900 : i < 2 ? 1300 : 1150, stagger: 170, lead: fate ? 250 : 0 };
    setIdx(i);
    setRoll(t);
    setRollNo((n) => n + 1);
    setRollPhase("rolling");
    const landAt = t.lead + t.stagger * (steps[i].dice.length - 1) + t.toss + (reduced ? 60 : 90);
    later(() => {
      const before = steps.slice(0, i).reduce((s, x) => s + x.total, 0);
      const after = before + steps[i].total;
      setLandedCount(i + 1);
      setRollPhase("landed");
      const from = rarityForTotal(before), to = rarityForTotal(after);
      if (to !== from && !reduced) {
        setBreakthrough(to);
        later(() => setBreakthrough(null), 1800);
      }
      // The fate roll gets its own held breath: after the second-to-last stat
      // lands, the tray turns to LUCK and waits — trembling — for the click.
      if (i === last - 1 && isFate(last)) later(() => { setIdx(last); setRollPhase("ready"); }, 1300);
    }, landAt);
  }, [isFate, reduced, steps, later, last]);

  const waitingForFate = rollPhase === "landed" && idx === last - 1 && isFate(last);

  const advance = useCallback(() => {
    if (stage !== "dice" || leaving.current) return;
    if (rollPhase === "rolling" || waitingForFate) return;
    if (rollPhase === "ready") { rollStat(idx); return; }
    if (idx >= last) { leaving.current = true; flashTo("reveal", tier.shake); return; }
    rollStat(idx + 1);
  }, [stage, rollPhase, waitingForFate, rollStat, idx, last, flashTo, tier.shake]);

  // 自動: same sequence, the machine presses 擲骰 for you (off by default).
  useEffect(() => {
    if (!auto || stage !== "dice" || rollPhase === "rolling") return;
    const id = setTimeout(advance, rollPhase === "ready" ? 900 : 1400);
    return () => clearTimeout(id);
  }, [auto, stage, rollPhase, idx, advance]);

  const skip = useCallback(() => {
    clearAll();
    leaving.current = true;
    setLandedCount(steps.length);
    setBreakthrough(null);
    setShake(false);
    setFlash(false);
    setStage("reveal");
  }, [clearAll, steps.length]);

  // ── reveal ──
  useEffect(() => {
    if (stage !== "reveal") return;
    setLandedCount(steps.length);
    if (!counted) return;
    later(() => {
      setStamped(true);
      if ((card.rarity === "Epic" || card.rarity === "Legendary") && !reduced) {
        setShake(true);
        later(() => setShake(false), 420);
      }
    }, reduced ? 0 : 380);
  }, [stage, counted, steps.length, later, card.rarity, reduced]);

  // Keyboard: Space/Enter = the main button of each stage; Esc skips to the reveal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        if (stage === "seal") { e.preventDefault(); breakSeal(); }
        else if (stage === "dice") { e.preventDefault(); advance(); }
        else if (stage === "reveal" && stamped) { e.preventDefault(); onComplete(); }
      } else if (e.key === "Escape" && stage !== "reveal") {
        skip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, stamped, breakSeal, advance, skip, onComplete]);

  const step = steps[Math.min(idx, last)];
  const currentLanded = landedCount > idx;
  const fateNow = isFate(idx) && !currentLanded;
  const rollLabel =
    rollPhase === "rolling" ? "擲骰中……"
    : rollPhase === "ready" ? (isFate(idx) ? "命運的一擲" : `擲骰 · ${step.zh}`)
    : idx >= last ? "揭曉結果"
    : waitingForFate ? "……"
    : `擲下一項 · ${steps[idx + 1].zh}`;
  const rollDisabled = rollPhase === "rolling" || waitingForFate;
  const meterPct = Math.min(100, (running / MAX_TOTAL_STATS) * 100);

  return (
    <div
      className={`gacha-stage${shake ? " gacha-shake" : ""}`}
      style={{ ["--gacha-amp" as string]: `${tier.amp}px` } as CSSProperties}
      role="dialog"
      aria-label="調查員召喚"
    >
      {/* rising dust — the whole sequence sits in it */}
      {!reduced && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
          {motes.map((m, i) => (
            <span key={i} className="gacha-mote" style={{
              left: `${m.left}%`, width: m.size, height: m.size,
              animationDuration: `${m.dur}s`, animationDelay: `${m.delay}s`,
              ["--drift" as string]: `${m.drift}px`,
            } as CSSProperties} />
          ))}
        </div>
      )}

      {/* ───────────── 封印 ───────────── */}
      {(stage === "seal" || stage === "breaking") && (
        <div className="relative my-auto flex flex-col items-center gap-6 px-4">
          <p className="text-[10px] tracking-[0.35em]" style={{ color: gold(0.55) }}>調 查 員 召 喚</p>
          <button
            type="button"
            onClick={breakSeal}
            className={`gacha-seal relative${stage === "breaking" ? " is-breaking" : ""}`}
            style={{ width: 200, height: 280 }}
            aria-label="揭開封印"
          >
            <span
              className="gacha-seal-glow"
              style={{
                opacity: stage === "breaking" ? 1 : 0.45,
                background: `radial-gradient(circle, ${gold(stage === "breaking" ? 0.35 + tier.glow : 0.25)} 0%, transparent 65%)`,
                transitionDuration: `${holdMs}ms`,
              }}
            />
            <span className={`gacha-seal-card${!reduced && stage === "seal" ? " is-floating" : ""}`}>
              <CardBack breaking={stage === "breaking"} cracks={cracks} holdMs={holdMs} reduced={reduced} />
            </span>
          </button>
          <p className="text-sm font-serif tracking-wider" style={{ color: stage === "breaking" ? PARCHMENT : gold(0.7) }}>
            {stage === "breaking" ? "封印正在碎裂……" : "點擊封印，開始擲骰"}
          </p>
          <p className="text-[10px] -mt-4" style={{ color: gold(0.35) }}>
            {stage === "seal" ? "（也可以按空白鍵）" : " "}
          </p>
        </div>
      )}

      {/* ───────────── 擲骰 ───────────── */}
      {stage === "dice" && (
        <div className={`relative my-auto w-full max-w-[420px] flex flex-col gap-4 px-4${fateNow ? " is-fate" : ""}`}>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1" style={{ background: `linear-gradient(to right, transparent, ${gold(0.3)})` }} />
            <span className="text-[10px] tracking-[0.3em]" style={{ color: gold(0.55) }}>
              擲骰 · {idx + 1} / {steps.length}
            </span>
            <div className="h-px flex-1" style={{ background: `linear-gradient(to left, transparent, ${gold(0.3)})` }} />
          </div>

          {/* 9 stat slots */}
          <div className="gacha-slots grid grid-cols-3 gap-2">
            {steps.map((s, i) => {
              const done = i < landedCount;
              const active = i === idx && !done;
              return (
                <div key={s.key} className={`gacha-slot${done ? " is-done" : ""}${active ? " is-active" : ""}`}>
                  <span className="text-[10px] tracking-wider" style={{ color: gold(done ? 0.7 : 0.4) }}>
                    {s.zh} <span className="opacity-60">{s.label}</span>
                  </span>
                  <span className="text-lg font-bold tabular-nums leading-tight"
                    style={{ color: done ? (s.total >= 70 ? "#d4b87a" : PARCHMENT) : gold(active ? 0.55 : 0.2) }}>
                    {done ? s.total : active ? "…" : "—"}
                  </span>
                </div>
              );
            })}
          </div>

          {/* tray */}
          <div className="gacha-tray relative rounded-xl px-3 pt-3 pb-4 text-center">
            {isFate(idx) && (
              <p className="gacha-fate-banner text-[11px] tracking-[0.3em] mb-1" style={{ color: PARCHMENT }}>
                命 運 的 一 擲
              </p>
            )}
            <p className="font-serif text-base" style={{ color: PARCHMENT }}>
              {step.zh} <span className="text-[11px] tracking-[0.2em]" style={{ color: gold(0.55) }}>{step.label}</span>
            </p>
            <p className="text-[11px] leading-snug mb-3" style={{ color: gold(0.45) }}>{step.desc}</p>

            <div key={`${idx}-${rollPhase === "ready" ? "ready" : rollNo}`} className="flex items-end justify-center gap-4 h-[92px] pb-1">
              {step.dice.map((d, i) => rollPhase === "ready" ? (
                <Die3D key={i} value={d} reduced={reduced} idle tremble={fateNow} delay={0} duration={0} />
              ) : (
                <Die3D key={i} value={d} reduced={reduced}
                  delay={roll.lead + i * roll.stagger} duration={roll.toss} />
              ))}
            </div>

            <div className="h-7 mt-5 flex items-center justify-center">
              {currentLanded ? (
                <span className="gacha-formula text-sm tabular-nums" style={{ color: gold(0.75) }}>
                  ({step.dice.join(" + ")}
                  {step.base > 0 && <span style={{ color: gold(0.4) }}> + {step.base}</span>}
                  ) × 5 ={" "}
                  <b className="text-xl" style={{ color: "#c9a96e", textShadow: `0 0 14px ${gold(0.5)}` }}>{step.total}</b>
                </span>
              ) : fateNow ? (
                <span className="text-[11px]" style={{ color: gold(0.6) }}>
                  距離〈{TIER[fateTarget!.tier].zh}〉還差 {fateTarget!.at - running} 點
                </span>
              ) : null}
            </div>
          </div>

          {/* rarity meter */}
          <div className="relative">
            {breakthrough && (
              <div key={breakthrough} className="gacha-breakthrough" aria-live="polite">
                突破 · {TIER[breakthrough].zh}
              </div>
            )}
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[10px] tracking-[0.25em]" style={{ color: gold(0.5) }}>屬性總計</span>
              <span className="text-xl font-bold tabular-nums"
                style={{ color: "#c9a96e", textShadow: `0 0 ${10 + 18 * intensity}px ${gold(0.25 + 0.45 * intensity)}` }}>
                {running}
                <span className="text-[10px] ml-1 font-normal" style={{ color: gold(0.35) }}>/ {MAX_TOTAL_STATS}</span>
              </span>
            </div>
            <div className="relative h-3 rounded-full" style={{ background: "#0e0c08", border: `1px solid ${gold(0.25)}` }}>
              <div className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${meterPct}%`,
                  background: `linear-gradient(90deg, ${gold(0.3)}, ${gold(0.45 + 0.5 * intensity)})`,
                  boxShadow: `0 0 ${6 + 18 * intensity}px ${gold(0.2 + 0.5 * intensity)}`,
                  transition: reduced ? "none" : "width 600ms cubic-bezier(.2,.8,.2,1), box-shadow 400ms, background 400ms",
                }} />
              {THRESHOLDS.map((t) => {
                const reached = running >= t.at;
                return (
                  <span key={t.tier}
                    className={`absolute -top-1 -bottom-1 w-[2px] rounded-full${reached ? " gacha-tick-lit" : ""}`}
                    style={{ left: `${(t.at / MAX_TOTAL_STATS) * 100}%`, background: reached ? PARCHMENT : gold(0.35) }} />
                );
              })}
            </div>
            <div className="relative h-4 mt-1">
              {THRESHOLDS.map((t) => (
                <span key={t.tier} className="absolute -translate-x-1/2 text-[10px]"
                  style={{ left: `${(t.at / MAX_TOTAL_STATS) * 100}%`, color: running >= t.at ? PARCHMENT : gold(0.4) }}>
                  {TIER[t.tier].zh}
                </span>
              ))}
            </div>
          </div>

          <button type="button" onClick={advance} disabled={rollDisabled}
            className={`gacha-roll-btn w-full py-3 rounded-xl font-serif text-base tracking-[0.15em] transition-all${fateNow && rollPhase === "ready" ? " is-fate-btn" : ""}${rollPhase === "ready" || rollPhase === "landed" ? " is-armed" : ""}`}
            style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07" }}>
            <span className="inline-flex items-center justify-center gap-2">
              {rollPhase === "landed" && idx >= last ? (
                <>{rollLabel} <ArrowRight size={16} strokeWidth={2} /></>
              ) : (
                <>{rollPhase !== "rolling" && !waitingForFate && <Dices size={17} strokeWidth={2} />}{rollLabel}</>
              )}
            </span>
          </button>

          <div className="flex items-center justify-between -mt-1">
            <button type="button" onClick={() => setAuto((v) => !v)}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full transition-colors"
              style={auto
                ? { background: gold(0.18), border: `1px solid ${gold(0.5)}`, color: PARCHMENT }
                : { border: `1px solid ${gold(0.2)}`, color: gold(0.55) }}
              aria-pressed={auto}>
              <Repeat size={12} strokeWidth={2} /> 自動
            </button>
            <span className="text-[10px]" style={{ color: gold(0.3) }}>空白鍵也可以擲骰</span>
            <button type="button" onClick={skip} className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
              跳過 <SkipForward size={12} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      {/* ───────────── 顯現 ───────────── */}
      {stage === "reveal" && (
        <div className="relative my-auto flex flex-col items-center gap-6 px-4">
          <div className="relative">
          {!reduced && tier.rays > 0 && (
            <div className="gacha-rays" aria-hidden style={{
              background: `repeating-conic-gradient(from 0deg, transparent 0deg 8deg, ${gold(tier.rays)} 11deg, transparent 14deg 22deg)`,
            }} />
          )}
          {!reduced && Array.from({ length: tier.rings }, (_, i) => (
            <span key={i} className="gacha-ring" aria-hidden style={{ animationDelay: `${i * 170}ms`, borderColor: gold(0.35 + tier.glow * 0.8) }} />
          ))}
          {!reduced && sparks.map((s, i) => (
            <span key={i} className="gacha-spark" aria-hidden style={{
              width: s.size, height: s.size, animationDelay: `${s.delay}ms`,
              ["--dx" as string]: `${s.dx}px`, ["--dy" as string]: `${s.dy}px`,
            } as CSSProperties} />
          ))}

          <div className={`gacha-card-front relative${reduced ? "" : " is-flipping"}${tier.rays >= 0.2 && !reduced ? " has-shimmer" : ""}`}
            style={{
              width: 240, minHeight: 300,
              border: `1px solid ${gold(tier.frame + 0.15)}`,
              boxShadow: `0 0 ${24 + 50 * tier.glow}px ${gold(tier.glow)}, 0 20px 50px rgba(0,0,0,0.7)`,
            }}>
            <div className="absolute inset-[7px] rounded-xl pointer-events-none" style={{ border: `1px solid ${gold(tier.frame)}` }} />
            <div className="relative flex flex-col items-center px-5 pt-6 pb-5 h-full">
              <p className="text-[10px] tracking-[0.3em]" style={{ color: gold(0.5) }}>調查員檔案</p>
              <h2 className="font-serif text-xl mt-2 text-center break-all" style={{ color: PARCHMENT, letterSpacing: "0.04em" }}>{card.name}</h2>
              <p className="text-[10px] tracking-[0.25em] mt-5" style={{ color: gold(0.5) }}>屬性總計</p>
              <div className="text-6xl font-bold tabular-nums leading-none mt-1"
                style={{ color: "#c9a96e", textShadow: `0 0 ${18 + 30 * tier.glow}px ${gold(0.3 + tier.glow * 0.7)}` }}>
                <CountUp to={card.total_stats} ms={1700} reduced={reduced} onDone={() => setCounted(true)} />
              </div>
              <div className="h-[74px] flex items-center justify-center mt-3">
                {stamped && (
                  <div className={`gacha-stamp${reduced ? "" : " is-slamming"}`}
                    style={{
                      color: card.rarity === "Legendary" ? PARCHMENT : "#c9a96e",
                      borderColor: gold(0.45 + tier.frame),
                      boxShadow: `0 0 ${10 + 30 * tier.glow}px ${gold(tier.glow)}, inset 0 0 12px ${gold(tier.glow * 0.6)}`,
                      textShadow: `0 0 ${8 + 16 * tier.glow}px ${gold(0.3 + tier.glow)}`,
                    }}>
                    {tier.zh}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 w-full mt-2">
                {[{ l: "生命", v: card.hp }, { l: "理智", v: card.san }, { l: "魔力", v: card.mp }].map((d) => (
                  <div key={d.l} className="rounded-lg py-1.5 text-center" style={{ background: "rgba(14,12,8,0.6)", border: "1px solid #2a2010" }}>
                    <div className="text-[10px]" style={{ color: gold(0.5) }}>{d.l}</div>
                    <div className="text-base font-bold" style={{ color: PARCHMENT }}>{d.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          </div>

          <button type="button" onClick={onComplete}
            className={`w-[240px] py-2.5 rounded-lg font-serif text-sm transition-all hover:brightness-110${stamped ? " gacha-fade-in" : " invisible"}`}
            style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: `0 0 18px ${gold(0.25)}` }}>
            <span className="inline-flex items-center gap-1">
              {card.occupation ? "抽取職業" : "查看屬性總覽"} <ArrowRight size={15} strokeWidth={2} />
            </span>
          </button>
        </div>
      )}

      {/* seal-stage skip */}
      {(stage === "seal" || stage === "breaking") && (
        <button type="button" onClick={skip}
          className="absolute bottom-6 inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-400">
          跳過動畫 <SkipForward size={12} strokeWidth={2} />
        </button>
      )}

      <div className={`gacha-flash${flash ? " is-on" : ""}`} aria-hidden />
    </div>
  );
}
