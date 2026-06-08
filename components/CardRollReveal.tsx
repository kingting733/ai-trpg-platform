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

function SkillAllocator({ card, onSaved }: { card: RevealCard; onSaved: () => void }) {
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
      <button onClick={onSaved} className="mt-2 w-full text-xs text-zinc-600 hover:text-zinc-400">
        跳過（使用基礎值）
      </button>
    </div>
  );
}

// ─── Die face ─────────────────────────────────────────────────────────────────

function Die({ value, rolling, sides }: { value: number; rolling: boolean; sides: number }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (!rolling) { setDisplay(value); return; }
    const t = setInterval(() => setDisplay(Math.floor(Math.random() * sides) + 1), 70);
    return () => clearInterval(t);
  }, [rolling, value, sides]);

  return (
    <span className="inline-flex items-center justify-center w-12 h-12 rounded-lg text-xl font-bold select-none transition-all"
      style={rolling
        ? { background: "#1a150e", border: "1px solid rgba(201,169,110,0.20)", color: "rgba(201,169,110,0.45)", transform: "scale(0.95)" }
        : { background: "linear-gradient(150deg,#1c1813,#0f0c08)", border: "1px solid rgba(201,169,110,0.55)", color: "#e4d8be", boxShadow: "0 0 12px rgba(201,169,110,0.15)" }
      }>
      {display}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CardRollReveal({ card, onDone }: { card: RevealCard; onDone: () => void }) {
  const steps = useRef(buildSteps(card)).current;
  const [index, setIndex] = useState(0);
  const [rolling, setRolling] = useState(true);
  const [phase, setPhase] = useState<"rolling" | "summary" | "skills">("rolling");
  const completed = steps.slice(0, index).map((s) => ({ label: s.labelZh, total: s.total }));
  const rarity = RARITY_ACCENT[card.rarity];

  useEffect(() => {
    if (phase !== "rolling") return;
    if (index >= steps.length) { setPhase("summary"); return; }
    setRolling(true);
    const rollTime = setTimeout(() => setRolling(false), 650);
    const advance  = setTimeout(() => setIndex((i) => i + 1), 1250);
    return () => { clearTimeout(rollTime); clearTimeout(advance); };
  }, [index, steps.length, phase]);

  const step = steps[index];

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
              {card.occupation && (
                <span className="text-3xl leading-none shrink-0">
                  {OCCUPATION_ICON[card.occupation] ?? "🎭"}
                </span>
              )}
              <div>
                <h2 className="font-serif text-xl" style={{ color: "#e4d8be", letterSpacing: "0.04em" }}>{card.name}</h2>
                {card.occupation && (
                  <p className="text-[11px] mt-0.5" style={{ color: "rgba(201,169,110,0.65)" }}>{card.occupation}</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Rolling phase ── */}
          {phase === "rolling" && step ? (
            <div>
              <div className="text-center py-4 rounded-xl mb-4"
                style={{ background: "rgba(14,12,8,0.6)", border: "1px solid #2a2010" }}>
                <p className="text-xs mb-0.5 tracking-[0.2em] uppercase" style={{ color: "rgba(201,169,110,0.6)" }}>{step.label}</p>
                <p className="text-zinc-500 text-xs mb-4">{step.labelZh}</p>
                <div className="flex items-center justify-center gap-2 mb-4 flex-wrap">
                  {step.dice.map((d, i) => (
                    <Die key={i} value={d} rolling={rolling} sides={step.sides} />
                  ))}
                </div>
                <div className="h-10 flex items-center justify-center">
                  {rolling ? (
                    <span className="text-3xl font-bold" style={{ color: "rgba(201,169,110,0.25)" }}>…</span>
                  ) : (
                    <span className="text-3xl font-bold" style={{ color: "#c9a96e" }}>
                      {step.base > 0 && (
                        <span className="text-lg mr-1" style={{ color: "rgba(201,169,110,0.5)" }}>
                          {step.base} + {step.total - step.base} =
                        </span>
                      )}
                      {step.total}
                    </span>
                  )}
                </div>
              </div>

              {/* Running tally */}
              {completed.length > 0 && (
                <div className="grid grid-cols-5 gap-1.5 mb-4">
                  {completed.map((c) => (
                    <div key={c.label} className="rounded-lg px-1 py-1.5 text-center"
                      style={{ background: "rgba(14,12,8,0.6)", border: "1px solid #2a2010" }}>
                      <div className="text-[9px] tracking-wide mb-0.5" style={{ color: "rgba(201,169,110,0.5)" }}>{c.label}</div>
                      <div className="text-sm font-bold" style={{ color: "#e4d8be" }}>{c.total}</div>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => setPhase("summary")}
                className="w-full text-xs text-zinc-600 hover:text-zinc-400 py-1">
                跳過動畫
              </button>
            </div>

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
              <button onClick={onDone} className="mt-2 w-full text-xs text-zinc-600 hover:text-zinc-400">
                跳過，直接加入收藏
              </button>
            </div>

          /* ── Skill allocation phase ── */
          ) : (
            <SkillAllocator card={card} onSaved={onDone} />
          )}
        </div>
      </div>
    </div>
  );
}
