"use client";
import { useEffect, useRef, useState } from "react";

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

const ALL_OCCUPATIONS = Object.keys(OCCUPATION_ICON);
import type { SkillKey } from "@/lib/cards/dice";

type Rarity = "Common" | "Rare" | "Epic" | "Legendary";

interface RollDetails {
  str:  { dice: number[] };
  con:  { dice: number[] };
  siz:  { base: number; dice: number[] };
  dex:  { dice: number[] };
  app:  { dice: number[] };
  int:  { base: number; dice: number[] };
  pow:  { dice: number[] };
  edu:  { base: number; dice: number[] };
  luck: { dice: number[] };
}

export interface RevealCard {
  id:          string;
  name:        string;
  str:  number; con: number; siz: number; dex: number; app: number;
  int:  number; pow: number; edu: number; luck: number;
  hp:   number; san: number; mp: number;
  total_stats: number;
  rarity:      Rarity;
  roll_details: RollDetails | null;
  skills?:     Record<string, number> | null; // occupation-seeded starting buffs
  occupation?: string | null;
}

const RARITY_ACCENT: Record<Rarity, { color: string; glow: string; label: string }> = {
  Common:    { color: "#a1a1aa", glow: "rgba(161,161,170,0.25)", label: "Common"    },
  Rare:      { color: "#7dd3fc", glow: "rgba(125,211,252,0.30)", label: "Rare"      },
  Epic:      { color: "#c4b5fd", glow: "rgba(196,181,253,0.30)", label: "Epic"      },
  Legendary: { color: "#c9a96e", glow: "rgba(201,169,110,0.45)", label: "Legendary" },
};

const PANEL = {
  background: "linear-gradient(150deg,#1c1813 0%,#13100b 55%,#0f0c08 100%)",
  border: "1px solid #2e2416",
  boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
};

interface Step {
  key: string; label: string; labelZh: string;
  sides: number; base: number; dice: number[]; total: number;
}

// Short, player-facing note on what each stat governs in play.
const STAT_DESC: Record<string, string> = {
  str:  "近戰傷害與力量檢定（搬、推、抓握）",
  con:  "生命值，以及抵抗疾病與毒素的能力",
  siz:  "生命值與近戰傷害加值（體格越大越痛）",
  dex:  "行動順序、閃避，以及各種身手檢定",
  app:  "魅惑與社交第一印象的基礎",
  int:  "推理、靈感檢定，並提供技能點數",
  pow:  "魔力上限、理智抵抗與意志對抗",
  edu:  "知識類技能，並提供大量技能點數",
  luck: "運氣檢定與面對隨機事件的命運",
};

function buildSteps(card: RevealCard): Step[] {
  const rd = card.roll_details;
  if (!rd) {
    const mk = (key: string, label: string, labelZh: string, total: number): Step =>
      ({ key, label, labelZh, sides: 6, base: 0, dice: [total], total });
    return [
      mk("str",  "STR",  "力量", card.str),  mk("con",  "CON",  "體質", card.con),
      mk("siz",  "SIZ",  "體型", card.siz),  mk("dex",  "DEX",  "敏捷", card.dex),
      mk("app",  "APP",  "外貌", card.app),  mk("int",  "INT",  "智力", card.int),
      mk("pow",  "POW",  "意志", card.pow),  mk("edu",  "EDU",  "教育", card.edu),
      mk("luck", "LUCK", "幸運", card.luck),
    ];
  }
  return [
    { key: "str",  label: "STR",  labelZh: "力量", sides: 6, base: 0,                  dice: rd.str.dice,  total: card.str  },
    { key: "con",  label: "CON",  labelZh: "體質", sides: 6, base: 0,                  dice: rd.con.dice,  total: card.con  },
    { key: "siz",  label: "SIZ",  labelZh: "體型", sides: 6, base: rd.siz.base * 5,    dice: rd.siz.dice,  total: card.siz  },
    { key: "dex",  label: "DEX",  labelZh: "敏捷", sides: 6, base: 0,                  dice: rd.dex.dice,  total: card.dex  },
    { key: "app",  label: "APP",  labelZh: "外貌", sides: 6, base: 0,                  dice: rd.app.dice,  total: card.app  },
    { key: "int",  label: "INT",  labelZh: "智力", sides: 6, base: rd.int.base * 5,    dice: rd.int.dice,  total: card.int  },
    { key: "pow",  label: "POW",  labelZh: "意志", sides: 6, base: 0,                  dice: rd.pow.dice,  total: card.pow  },
    { key: "edu",  label: "EDU",  labelZh: "教育", sides: 6, base: rd.edu.base * 5,    dice: rd.edu.dice,  total: card.edu  },
    { key: "luck", label: "LUCK", labelZh: "幸運", sides: 6, base: 0,                  dice: rd.luck.dice, total: card.luck },
  ];
}

// ─── Skill system ─────────────────────────────────────────────────────────────

const SKILLS: { key: SkillKey; zh: string; base: number | "dex2" | "app2" | "inv_app" }[] = [
  { key: "spot_hidden",  zh: "偵查",      base: 10 },
  { key: "listen",       zh: "聆聽",      base: 10 },
  { key: "library_use",  zh: "圖書館使用", base: 10 },
  { key: "psychology",   zh: "心理學",    base:  1 },
  { key: "persuade",     zh: "說服",      base:  5 },
  { key: "fast_talk",    zh: "話術",      base:  5 },
  { key: "charm",        zh: "魅惑",      base: "app2" },
  { key: "intimidate",   zh: "恐嚇",      base: "inv_app" },
  { key: "dodge",        zh: "閃避",      base: "dex2" },
  { key: "first_aid",    zh: "急救",      base:  1 },
  { key: "stealth",      zh: "潛行",      base:  1 },
  { key: "lockpick",     zh: "開鎖",      base:  1 },
  { key: "drive_auto",   zh: "駕駛汽車",  base:  0 },
  { key: "firearms",     zh: "射擊",      base: 20 },
  { key: "occult",       zh: "神秘學",    base:  5 },
  { key: "fighting",     zh: "搏鬥",      base: 25 },
];

function baseForSkill(s: typeof SKILLS[number], dex: number, app: number = 50): number {
  if (s.base === "dex2")    return Math.floor(dex / 2);
  if (s.base === "app2")    return Math.floor(app / 2);
  if (s.base === "inv_app") return Math.floor((100 - app) / 5);
  return s.base;
}

function SkillAllocator({ card, onSaved, onRequestSkip }: { card: RevealCard; onSaved: () => void; onRequestSkip: () => void }) {
  const totalPool = card.edu * 2 + card.int * 2;
  const [allocated, setAllocated] = useState<Partial<Record<SkillKey, number>>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Starting value (floor) for a skill = its occupation-seeded buff if present,
  // otherwise the catalogue base. Players allocate points on top of the floor.
  function floorFor(s: typeof SKILLS[number]): number {
    const seeded = card.skills?.[s.key];
    if (typeof seeded === "number") return seeded;
    return baseForSkill(s, card.dex, card.app);
  }

  const buffedKeys = new Set(Object.keys(card.skills ?? {}));

  const spent = Object.values(allocated).reduce((s, v) => s + (v ?? 0), 0);
  const remaining = totalPool - spent;

  function adjust(key: SkillKey, delta: number) {
    setAllocated((prev) => {
      const cur = prev[key] ?? 0;
      const next = cur + delta;
      if (next < 0) return prev;
      if (delta > 0 && remaining <= 0) return prev;
      const base = floorFor(SKILLS.find((s) => s.key === key)!);
      if (base + next > 95) return prev;
      return { ...prev, [key]: next };
    });
  }

  function setDirect(key: SkillKey, raw: string) {
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 0) { setAllocated((prev) => ({ ...prev, [key]: 0 })); return; }
    const base = floorFor(SKILLS.find((s) => s.key === key)!);
    const cur = allocated[key] ?? 0;
    const headroom = remaining + cur;
    const capped = Math.min(n, headroom, 95 - base);
    setAllocated((prev) => ({ ...prev, [key]: capped }));
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/characters/${card.id}/skills`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: Object.fromEntries(
            SKILLS.map((s) => [s.key, floorFor(s) + (allocated[s.key] ?? 0)])
          ),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? "儲存失敗"); setSaving(false); return; }
      onSaved();
    } catch {
      setErr("網路錯誤，請重試。"); setSaving(false);
    }
  }

  return (
    <div>
      {/* Points header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="text-zinc-400 text-sm">分配技能點數</span>
        <span className="text-sm font-bold px-3 py-0.5 rounded-full"
          style={remaining === 0
            ? { background: "rgba(6,78,59,0.4)", color: "#6ee7b7", border: "1px solid rgba(6,95,70,0.6)" }
            : { background: "rgba(26,21,14,0.8)", color: "#c9a96e", border: "1px solid rgba(201,169,110,0.35)" }}>
          剩餘 {remaining} / {totalPool}
        </span>
      </div>

      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
        {SKILLS.map((s) => {
          const base = floorFor(s);
          const add  = allocated[s.key] ?? 0;
          const total = base + add;
          const buffed = buffedKeys.has(s.key);
          return (
            <div key={s.key} className="flex items-center gap-2 rounded-lg px-3 py-2"
              style={buffed
                ? { background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.3)" }
                : { background: "rgba(14,12,8,0.6)", border: "1px solid #2a2010" }}>
              <span className="flex-1 text-xs text-zinc-300">
                {s.zh}
                {buffed && <span className="ml-1 text-[10px]" style={{ color: "#c9a96e" }}>★職業</span>}
              </span>
              <span className="text-[10px] text-zinc-600 w-5 text-right shrink-0">{base}</span>
              <span className="text-zinc-700 text-xs">+</span>
              <button onClick={() => adjust(s.key, -1)} disabled={add <= 0}
                className="w-5 h-5 rounded flex items-center justify-center text-xs disabled:opacity-25 hover:brightness-125"
                style={{ background: "#1a150e", border: "1px solid #2e2416", color: "#c9a96e" }}>−</button>
              <input type="number" min={0} max={95 - base} value={add}
                onChange={(e) => setDirect(s.key, e.target.value)}
                className="w-9 rounded text-center text-xs py-0.5 focus:outline-none"
                style={{ background: "#0e0c08", border: "1px solid rgba(201,169,110,0.3)", color: "#e4d8be" }} />
              <button onClick={() => adjust(s.key, 1)} disabled={remaining <= 0 || base + add >= 95}
                className="w-5 h-5 rounded flex items-center justify-center text-xs disabled:opacity-25 hover:brightness-125"
                style={{ background: "#1a150e", border: "1px solid #2e2416", color: "#c9a96e" }}>+</button>
              <span className="w-9 text-right text-xs font-bold shrink-0"
                style={{ color: total >= 80 ? "#c9a96e" : total >= 60 ? "#6ee7b7" : "#a1a1aa" }}>
                {total}%
              </span>
            </div>
          );
        })}
      </div>

      {err && <p className="text-red-400 text-xs mt-2">{err}</p>}

      <button onClick={save} disabled={saving}
        className="mt-4 w-full py-2.5 rounded-lg font-serif text-sm transition-all hover:brightness-110 disabled:opacity-50"
        style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 16px rgba(201,169,110,0.18)" }}>
        {saving ? "儲存中…" : "確認技能並加入收藏"}
      </button>
      <button onClick={onRequestSkip} className="mt-2 w-full text-xs text-zinc-600 hover:text-zinc-400">
        跳過（使用基礎值）
      </button>
    </div>
  );
}

// ─── Occupation slot-machine reveal ──────────────────────────────────────────

const SKILL_ZH_MAP: Record<string, string> = {
  spot_hidden: "偵查", listen: "聆聽", library_use: "圖書館使用",
  psychology: "心理學", persuade: "說服", fast_talk: "話術",
  charm: "魅惑", intimidate: "恐嚇", dodge: "閃避",
  first_aid: "急救", stealth: "潛行", lockpick: "開鎖",
  drive_auto: "駕駛汽車", firearms: "射擊", occult: "神秘學", fighting: "搏鬥",
};

function OccupationReveal({
  occupation,
  buffedSkills,
  onDone,
}: {
  occupation: string;
  buffedSkills: string[];
  onDone: () => void;
}) {
  // Phase: "spinning" → "slowing" → "locked"
  const [spinPhase, setSpinPhase] = useState<"spinning" | "slowing" | "locked">("spinning");
  const [displayed, setDisplayed] = useState(ALL_OCCUPATIONS[0]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let speed = 60;
    let ticks = 0;
    const FAST_TICKS = 18;    // fast spin count
    const SLOW_TICKS = 10;    // slow spin count

    function spin(ms: number) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        ticks++;
        if (ticks <= FAST_TICKS) {
          setDisplayed(ALL_OCCUPATIONS[ticks % ALL_OCCUPATIONS.length]);
        } else if (ticks <= FAST_TICKS + SLOW_TICKS) {
          setSpinPhase("slowing");
          speed = 80 + (ticks - FAST_TICKS) * 30;
          setDisplayed(ALL_OCCUPATIONS[ticks % ALL_OCCUPATIONS.length]);
          // re-schedule at new speed
          clearInterval(intervalRef.current!);
          intervalRef.current = setInterval(() => {
            ticks++;
            if (ticks > FAST_TICKS + SLOW_TICKS) {
              clearInterval(intervalRef.current!);
              setDisplayed(occupation);
              setSpinPhase("locked");
            } else {
              setDisplayed(ALL_OCCUPATIONS[ticks % ALL_OCCUPATIONS.length]);
            }
          }, speed);
        }
      }, ms);
    }

    spin(speed);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [occupation]);

  const icon = OCCUPATION_ICON[displayed] ?? "🎭";
  const isLocked = spinPhase === "locked";

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      {/* Eyebrow */}
      <div className="flex items-center gap-3 w-full">
        <div className="h-px flex-1" style={{ background: "linear-gradient(to right, transparent, rgba(201,169,110,0.3))" }} />
        <span className="text-[10px] tracking-[0.25em] uppercase" style={{ color: "rgba(201,169,110,0.5)" }}>職業抽籤</span>
        <div className="h-px flex-1" style={{ background: "linear-gradient(to left, transparent, rgba(201,169,110,0.3))" }} />
      </div>

      {/* Slot display */}
      <div className="w-full rounded-xl py-6 flex flex-col items-center gap-2 transition-all"
        style={isLocked
          ? { background: "rgba(201,169,110,0.07)", border: "1px solid rgba(201,169,110,0.45)", boxShadow: "0 0 28px rgba(201,169,110,0.18)" }
          : { background: "rgba(14,12,8,0.7)", border: "1px solid #2a2010" }}>
        <span
          className="text-6xl transition-all select-none"
          style={{ filter: isLocked ? "drop-shadow(0 0 12px rgba(201,169,110,0.6))" : "none",
            transform: spinPhase === "spinning" ? "scale(0.9)" : "scale(1)",
            transition: "transform 0.2s, filter 0.3s" }}
        >
          {icon}
        </span>
        <span
          className="font-serif text-2xl tracking-wide transition-all"
          style={{ color: isLocked ? "#e4d8be" : "rgba(201,169,110,0.4)",
            textShadow: isLocked ? "0 0 18px rgba(201,169,110,0.45)" : "none",
            letterSpacing: "0.08em" }}
        >
          {displayed}
        </span>
        {!isLocked && (
          <span className="text-[10px] tracking-[0.2em] uppercase animate-pulse"
            style={{ color: "rgba(201,169,110,0.4)" }}>抽籤中…</span>
        )}
      </div>

      {/* Buffed skills reveal — only shown once locked */}
      {isLocked && (
        <div className="w-full">
          <p className="text-[10px] tracking-[0.2em] uppercase text-center mb-2"
            style={{ color: "rgba(201,169,110,0.55)" }}>職業加成技能 +10</p>
          <div className="grid grid-cols-2 gap-2">
            {buffedSkills.map((key) => (
              <div key={key} className="rounded-lg px-3 py-2.5 flex items-center gap-2"
                style={{ background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.35)" }}>
                <span className="text-gold text-sm">★</span>
                <span className="text-sm font-medium" style={{ color: "#e4d8be" }}>
                  {SKILL_ZH_MAP[key] ?? key}
                </span>
                <span className="ml-auto text-xs font-bold" style={{ color: "#c9a96e" }}>+10</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLocked && (
        <button
          onClick={onDone}
          className="w-full py-2.5 rounded-lg font-serif text-sm transition-all hover:brightness-110"
          style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 16px rgba(201,169,110,0.2)" }}
        >
          查看屬性總覽 →
        </button>
      )}

      {!isLocked && (
        <button onClick={() => { if (intervalRef.current) clearInterval(intervalRef.current); setDisplayed(occupation); setSpinPhase("locked"); }}
          className="text-xs text-zinc-600 hover:text-zinc-400">
          跳過
        </button>
      )}
    </div>
  );
}

// ─── Die face ─────────────────────────────────────────────────────────────────

type DieState = "idle" | "rolling" | "settled";

function Die({ value, state, sides, delay = 0 }: { value: number; state: DieState; sides: number; delay?: number }) {
  const [display, setDisplay] = useState(value);
  // Per-die settle stagger: while the stat is "rolling", each die keeps tumbling
  // a touch longer than the previous one, then locks onto its real face.
  const [locked, setLocked] = useState(state === "settled");

  useEffect(() => {
    if (state === "idle") { setLocked(false); return; }
    if (state === "settled") { setLocked(true); setDisplay(value); return; }
    // rolling
    setLocked(false);
    const spin = setInterval(() => setDisplay(Math.floor(Math.random() * sides) + 1), 70);
    const stop = setTimeout(() => { setDisplay(value); setLocked(true); clearInterval(spin); }, 520 + delay);
    return () => { clearInterval(spin); clearTimeout(stop); };
  }, [state, value, sides, delay]);

  const tumbling = state === "rolling" && !locked;
  const showSettled = locked && state !== "idle";

  return (
    <span
      className="inline-flex items-center justify-center w-14 h-14 rounded-xl text-2xl font-bold select-none"
      style={
        state === "idle"
          ? { background: "#0e0c08", border: "1.5px solid rgba(201,169,110,0.25)", color: "rgba(201,169,110,0.4)",
              boxShadow: "inset 0 0 8px rgba(0,0,0,0.5)" }
          : tumbling
          ? { background: "#1a150e", border: "1.5px solid rgba(201,169,110,0.3)", color: "rgba(201,169,110,0.6)",
              boxShadow: "inset 0 0 8px rgba(0,0,0,0.4)",
              animation: "dieWobble 0.22s linear infinite" }
          : showSettled
          ? { background: "linear-gradient(150deg,#1c1813,#0f0c08)", border: "1.5px solid rgba(201,169,110,0.6)",
              color: "#e4d8be", boxShadow: "0 0 14px rgba(201,169,110,0.45), inset 0 0 8px rgba(0,0,0,0.4)",
              transition: "box-shadow 0.3s, border-color 0.3s" }
          : {}
      }>
      {state === "idle" ? "✦" : display}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CardRollReveal({ card, onDone }: { card: RevealCard; onDone: () => void }) {
  const steps = useRef(buildSteps(card)).current;
  const [index, setIndex] = useState(0);
  const [rollState, setRollState] = useState<DieState>("idle");
  const [phase, setPhase] = useState<"rolling" | "occupation" | "summary" | "skills">("rolling");
  const [confirmSkip, setConfirmSkip] = useState(false);
  const completed = steps.slice(0, index).map((s) => ({ label: s.labelZh, total: s.total }));
  const rarity = RARITY_ACCENT[card.rarity];

  // Derive the two buffed skill keys from the card's seeded skills (if any)
  const buffedSkillKeys: string[] = card.skills
    ? Object.keys(card.skills).filter((k) => {
        const s = SKILLS.find((sk) => sk.key === k);
        if (!s) return false;
        const base = baseForSkill(s, card.dex, card.app);
        return (card.skills![k] ?? 0) > base;
      })
    : [];

  // The stat roll is now fully click-driven. When "rolling" begins we let the
  // dice tumble, then settle the stat total a beat after the last die locks.
  useEffect(() => {
    if (rollState !== "rolling") return;
    const settle = setTimeout(() => setRollState("settled"), 900);
    return () => clearTimeout(settle);
  }, [rollState]);

  function nextStat() {
    if (index + 1 >= steps.length) {
      setPhase(card.occupation ? "occupation" : "summary");
    } else {
      setIndex((i) => i + 1);
      setRollState("idle");
    }
  }

  const step = steps[index];
  const lastStat = index + 1 >= steps.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(5,4,2,0.88)", backdropFilter: "blur(6px)" }}
      onClick={phase === "skills" ? undefined : onDone}>

      <div className="relative w-full max-w-md rounded-2xl"
        style={{ ...PANEL, boxShadow: `0 0 60px rgba(0,0,0,0.7), 0 0 28px ${rarity.glow}` }}
        onClick={(e) => e.stopPropagation()}>

        {/* Ornate inner frame */}
        <div className="absolute inset-[6px] rounded-xl pointer-events-none"
          style={{ border: `1px solid ${rarity.glow}` }} />

        {/* Paper clip */}
        <div className="absolute -top-2 left-8 w-4 h-8 rounded-full pointer-events-none -rotate-12"
          style={{ border: "2px solid rgba(201,169,110,0.30)", borderBottom: "none" }} />

        {/* Faint dot texture */}
        <div className="absolute inset-0 rounded-2xl pointer-events-none opacity-[0.04]"
          style={{ backgroundImage: "radial-gradient(circle, #c9a96e 1px, transparent 1px)", backgroundSize: "18px 18px" }} />

        <div className="relative p-6">
          {/* Card header */}
          <div className="text-center mb-5">
            <div className="flex items-center justify-center gap-2 mb-1">
              <div className="h-px flex-1" style={{ background: "linear-gradient(to right, transparent, rgba(201,169,110,0.3))" }} />
              <span className="text-[10px] tracking-[0.25em] uppercase" style={{ color: "rgba(201,169,110,0.5)" }}>調查員檔案</span>
              <div className="h-px flex-1" style={{ background: "linear-gradient(to left, transparent, rgba(201,169,110,0.3))" }} />
            </div>
            <div className="flex items-center gap-3 mt-1">
              {card.occupation && (phase === "summary" || phase === "skills") && (
                <span className="text-3xl leading-none shrink-0">
                  {OCCUPATION_ICON[card.occupation] ?? "🎭"}
                </span>
              )}
              <div>
                <h2 className="font-serif text-xl" style={{ color: "#e4d8be", letterSpacing: "0.04em" }}>{card.name}</h2>
                {card.occupation && (phase === "summary" || phase === "skills") && (
                  <p className="text-[11px] mt-0.5" style={{ color: "rgba(201,169,110,0.65)" }}>{card.occupation}</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Rolling phase ── */}
          {phase === "rolling" && step ? (
            <div>
              {/* progress pip */}
              <p className="text-center text-[10px] tracking-[0.2em] mb-2" style={{ color: "rgba(201,169,110,0.45)" }}>
                {index + 1} / {steps.length}
              </p>

              <div className="text-center py-4 px-3 rounded-xl mb-4"
                style={{ background: "rgba(14,12,8,0.6)", border: "1px solid #2a2010" }}>
                <p className="text-xs mb-0.5 tracking-[0.2em] uppercase" style={{ color: "rgba(201,169,110,0.6)" }}>{step.label}</p>
                <p className="text-zinc-300 text-base font-serif mb-1">{step.labelZh}</p>
                {/* what this stat affects */}
                <p className="text-[11px] leading-snug mb-4 px-2" style={{ color: "rgba(201,169,110,0.5)" }}>
                  {STAT_DESC[step.key] ?? ""}
                </p>

                <div className="flex items-center justify-center gap-2.5 mb-4 flex-wrap">
                  {step.dice.map((d, i) => (
                    <Die key={i} value={d} state={rollState} sides={step.sides} delay={i * 130} />
                  ))}
                </div>

                <div className="h-10 flex items-center justify-center">
                  {rollState === "settled" ? (
                    <span className="text-3xl font-bold" style={{ color: "#c9a96e", textShadow: "0 0 18px rgba(201,169,110,0.4)" }}>
                      {step.base > 0 && (
                        <span className="text-lg mr-1" style={{ color: "rgba(201,169,110,0.5)" }}>
                          {step.base} + {step.total - step.base} =
                        </span>
                      )}
                      {step.total}
                    </span>
                  ) : (
                    <span className="text-3xl font-bold" style={{ color: "rgba(201,169,110,0.2)" }}>
                      {rollState === "rolling" ? "…" : "?"}
                    </span>
                  )}
                </div>
              </div>

              {/* Action button: roll, then advance */}
              {rollState === "idle" ? (
                <button onClick={() => setRollState("rolling")}
                  className="w-full py-2.5 rounded-lg font-serif text-sm tracking-wide transition-all hover:brightness-110"
                  style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 16px rgba(201,169,110,0.2)" }}>
                  擲骰！
                </button>
              ) : rollState === "settled" ? (
                <button onClick={nextStat}
                  className="w-full py-2.5 rounded-lg font-serif text-sm tracking-wide transition-all hover:brightness-110"
                  style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 16px rgba(201,169,110,0.2)" }}>
                  {lastStat ? (card.occupation ? "抽取職業 →" : "查看屬性總覽 →") : "下一項 →"}
                </button>
              ) : (
                <div className="w-full py-2.5 text-center text-sm font-serif" style={{ color: "rgba(201,169,110,0.5)" }}>
                  擲骰中…
                </div>
              )}

              {/* Running tally */}
              {completed.length > 0 && (
                <div className="grid grid-cols-5 gap-1.5 mt-4 mb-2">
                  {completed.map((c) => (
                    <div key={c.label} className="rounded-lg px-1 py-1.5 text-center"
                      style={{ background: "rgba(14,12,8,0.6)", border: "1px solid #2a2010" }}>
                      <div className="text-[9px] tracking-wide mb-0.5" style={{ color: "rgba(201,169,110,0.5)" }}>{c.label}</div>
                      <div className="text-sm font-bold" style={{ color: "#e4d8be" }}>{c.total}</div>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => setPhase(card.occupation ? "occupation" : "summary")}
                className="w-full text-xs text-zinc-600 hover:text-zinc-400 py-1 mt-1">
                跳過動畫
              </button>
            </div>

          /* ── Occupation reveal phase ── */
          ) : phase === "occupation" && card.occupation ? (
            <OccupationReveal
              occupation={card.occupation}
              buffedSkills={buffedSkillKeys}
              onDone={() => setPhase("summary")}
            />

          /* ── Summary phase ── */
          ) : phase === "summary" ? (
            <div>
              <div className="text-center py-5 rounded-xl mb-4"
                style={{ background: "rgba(14,12,8,0.6)", border: `1px solid ${rarity.glow}`, boxShadow: `0 0 20px ${rarity.glow}` }}>
                <p className="text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "rgba(201,169,110,0.5)" }}>屬性總計</p>
                <div className="text-5xl font-bold mb-1" style={{ color: "#c9a96e", textShadow: `0 0 24px ${rarity.glow}` }}>
                  {card.total_stats}
                </div>
                <div className="text-lg font-semibold tracking-widest" style={{ color: rarity.color }}>
                  {rarity.label}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                {[{ label: "生命", value: card.hp }, { label: "理智", value: card.san }, { label: "魔力", value: card.mp }].map((d) => (
                  <div key={d.label} className="rounded-lg px-2 py-2 text-center"
                    style={{ background: "rgba(14,12,8,0.6)", border: "1px solid #2a2010" }}>
                    <div className="text-[10px] mb-0.5" style={{ color: "rgba(201,169,110,0.5)" }}>{d.label}</div>
                    <div className="text-lg font-bold" style={{ color: "#e4d8be" }}>{d.value}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-5 gap-1.5 mb-4">
                {steps.map((s) => (
                  <div key={s.key} className="rounded-lg px-1 py-1.5 text-center"
                    style={{ background: "rgba(14,12,8,0.6)", border: "1px solid #2a2010" }}>
                    <div className="text-[9px] tracking-wide mb-0.5" style={{ color: "rgba(201,169,110,0.5)" }}>{s.labelZh}</div>
                    <div className="text-sm font-bold" style={{ color: "#e4d8be" }}>{s.total}</div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-center mb-4" style={{ color: "rgba(201,169,110,0.55)" }}>
                技能點：<span className="font-bold" style={{ color: "#c9a96e" }}>{card.edu * 2 + card.int * 2}</span>
                <span className="ml-1 opacity-60">(EDU×2 + INT×2)</span>
              </p>

              <button onClick={() => setPhase("skills")}
                className="w-full py-2.5 rounded-lg font-serif text-sm transition-all hover:brightness-110"
                style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 16px rgba(201,169,110,0.2)" }}>
                分配技能點數 →
              </button>
              <button onClick={() => setConfirmSkip(true)} className="mt-2 w-full text-xs text-zinc-600 hover:text-zinc-400">
                跳過，直接加入收藏
              </button>
            </div>

          /* ── Skill allocation phase ── */
          ) : (
            <SkillAllocator card={card} onSaved={onDone} onRequestSkip={() => setConfirmSkip(true)} />
          )}
        </div>

        {/* Skip-allocation warning */}
        {confirmSkip && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl p-6"
            style={{ background: "rgba(5,4,2,0.82)", backdropFilter: "blur(2px)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="w-full rounded-xl p-5 text-center" style={{ ...PANEL, border: "1px solid rgba(201,169,110,0.4)" }}>
              <div className="text-3xl mb-2">⚠️</div>
              <h3 className="font-serif text-base mb-2" style={{ color: "#e4d8be" }}>尚未分配技能點數</h3>
              <p className="text-xs leading-relaxed mb-4" style={{ color: "rgba(201,169,110,0.6)" }}>
                你還有 <span className="font-bold" style={{ color: "#c9a96e" }}>{card.edu * 2 + card.int * 2}</span> 點技能點數未使用。
                跳過後角色將只保留基礎值，且<span style={{ color: "#e0b0b0" }}>無法再重新分配</span>。確定要跳過嗎？
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmSkip(false)}
                  className="flex-1 py-2 rounded-lg font-serif text-sm transition-all hover:brightness-110"
                  style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07" }}>
                  返回分配
                </button>
                <button onClick={() => { setConfirmSkip(false); onDone(); }}
                  className="flex-1 py-2 rounded-lg text-sm transition-all hover:brightness-110"
                  style={{ background: "rgba(14,12,8,0.8)", border: "1px solid #2e2416", color: "#a1a1aa" }}>
                  仍要跳過
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* die tumble animation */}
      <style>{`
        @keyframes dieWobble {
          0%   { transform: translateY(0) rotate(-4deg) scale(0.96); }
          50%  { transform: translateY(-3px) rotate(4deg) scale(1.02); }
          100% { transform: translateY(0) rotate(-4deg) scale(0.96); }
        }
      `}</style>
    </div>
  );
}
