"use client";
import { useEffect, useRef, useState } from "react";
import type { SkillKey, SkillPoints } from "@/lib/cards/dice";

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
  // skill_points is computed on the fly as EDU×2 + INT×2, not stored in DB
}

const RARITY_TEXT: Record<Rarity, string> = {
  Common:    "text-slate-300",
  Rare:      "text-sky-300",
  Epic:      "text-white",
  Legendary: "text-amber-300",
};

interface Step {
  key: string;
  label: string;
  labelZh: string;
  sides: number;
  base: number;
  dice: number[];
  total: number;
}

function buildSteps(card: RevealCard): Step[] {
  const rd = card.roll_details;
  if (!rd) {
    const mk = (key: string, label: string, labelZh: string, total: number): Step =>
      ({ key, label, labelZh, sides: 6, base: 0, dice: [total], total });
    return [
      mk("str",  "STR",  "力量", card.str),
      mk("con",  "CON",  "體質", card.con),
      mk("siz",  "SIZ",  "體型", card.siz),
      mk("dex",  "DEX",  "敏捷", card.dex),
      mk("app",  "APP",  "外貌", card.app),
      mk("int",  "INT",  "智力", card.int),
      mk("pow",  "POW",  "意志", card.pow),
      mk("edu",  "EDU",  "教育", card.edu),
      mk("luck", "LUCK", "幸運", card.luck),
    ];
  }
  return [
    { key: "str",  label: "STR",  labelZh: "力量", sides: 6, base: 0,  dice: rd.str.dice,  total: card.str  },
    { key: "con",  label: "CON",  labelZh: "體質", sides: 6, base: 0,  dice: rd.con.dice,  total: card.con  },
    { key: "siz",  label: "SIZ",  labelZh: "體型", sides: 6, base: rd.siz.base * 5, dice: rd.siz.dice,  total: card.siz  },
    { key: "dex",  label: "DEX",  labelZh: "敏捷", sides: 6, base: 0,  dice: rd.dex.dice,  total: card.dex  },
    { key: "app",  label: "APP",  labelZh: "外貌", sides: 6, base: 0,  dice: rd.app.dice,  total: card.app  },
    { key: "int",  label: "INT",  labelZh: "智力", sides: 6, base: rd.int.base * 5, dice: rd.int.dice,  total: card.int  },
    { key: "pow",  label: "POW",  labelZh: "意志", sides: 6, base: 0,  dice: rd.pow.dice,  total: card.pow  },
    { key: "edu",  label: "EDU",  labelZh: "教育", sides: 6, base: rd.edu.base * 5, dice: rd.edu.dice,  total: card.edu  },
    { key: "luck", label: "LUCK", labelZh: "幸運", sides: 6, base: 0,  dice: rd.luck.dice, total: card.luck },
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
  { key: "charm",        zh: "魅惑",      base: "app2" },     // floor(APP÷2)
  { key: "intimidate",   zh: "恐嚇",      base: "inv_app" },  // floor((100−APP)÷5)
  { key: "dodge",        zh: "閃避",      base: "dex2" },     // floor(DEX÷2)
  { key: "first_aid",    zh: "急救",      base:  1 },
  { key: "stealth",      zh: "潛行",      base:  1 },
  { key: "lockpick",     zh: "開鎖",      base:  1 },
  { key: "drive_auto",   zh: "駕駛汽車",  base:  0 },
];

function baseForSkill(s: typeof SKILLS[number], dex: number, app: number = 50): number {
  if (s.base === "dex2")    return Math.floor(dex / 2);
  if (s.base === "app2")    return Math.floor(app / 2);
  if (s.base === "inv_app") return Math.floor((100 - app) / 5);
  return s.base;
}

function SkillAllocator({
  card,
  onSaved,
}: {
  card: RevealCard;
  onSaved: () => void;
}) {
  const totalPool = card.edu * 2 + card.int * 2;
  const [allocated, setAllocated] = useState<Partial<Record<SkillKey, number>>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const spent = Object.values(allocated).reduce((s, v) => s + (v ?? 0), 0);
  const remaining = totalPool - spent;

  function adjust(key: SkillKey, delta: number) {
    setAllocated((prev) => {
      const cur = prev[key] ?? 0;
      const next = cur + delta;
      if (next < 0) return prev;
      if (delta > 0 && remaining <= 0) return prev;
      const base = baseForSkill(SKILLS.find((s) => s.key === key)!, card.dex, card.app);
      if (base + next > 95) return prev;
      return { ...prev, [key]: next };
    });
  }

  function setDirect(key: SkillKey, raw: string) {
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 0) { setAllocated((prev) => ({ ...prev, [key]: 0 })); return; }
    const base = baseForSkill(SKILLS.find((s) => s.key === key)!, card.dex, card.app);
    const cur = allocated[key] ?? 0;
    const headroom = remaining + cur; // points we can reassign from this skill
    const capped = Math.min(n, headroom, 95 - base);
    setAllocated((prev) => ({ ...prev, [key]: capped }));
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/characters/${card.id}/skills`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Store base+allocated as the full final skill value
        body: JSON.stringify({
          skills: Object.fromEntries(
            SKILLS.map((s) => {
              const base = baseForSkill(s, card.dex, card.app);
              const add = allocated[s.key] ?? 0;
              return [s.key, base + add];
            })
          ),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? "儲存失敗"); setSaving(false); return; }
      onSaved();
    } catch {
      setErr("網路錯誤，請重試。");
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-300">分配技能點數</p>
        <span className={`text-sm font-bold px-2 py-0.5 rounded ${remaining === 0 ? "text-green-300" : "text-white"}`}>
          剩餘 {remaining} / {totalPool}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-1.5 max-h-72 overflow-y-auto pr-1">
        {SKILLS.map((s) => {
          const base = baseForSkill(s, card.dex, card.app);
          const add  = allocated[s.key] ?? 0;
          const total = base + add;
          return (
            <div key={s.key} className="flex items-center gap-2 bg-slate-800/60 rounded px-2 py-1.5">
              <span className="flex-1 text-xs text-slate-200">{s.zh}</span>
              <span className="text-xs text-slate-500 w-6 text-right shrink-0">{base}</span>
              <span className="text-xs text-slate-600">+</span>
              <button
                onClick={() => adjust(s.key, -1)}
                disabled={add <= 0}
                className="w-5 h-5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 text-white text-xs flex items-center justify-center shrink-0"
              >−</button>
              <input
                type="number"
                min={0}
                max={95 - base}
                value={add}
                onChange={(e) => setDirect(s.key, e.target.value)}
                className="w-10 bg-slate-900 border border-slate-700 focus:border-zinc-500 rounded text-center text-xs text-white py-0.5 focus:outline-none"
              />
              <button
                onClick={() => adjust(s.key, 1)}
                disabled={remaining <= 0 || base + add >= 95}
                className="w-5 h-5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 text-white text-xs flex items-center justify-center shrink-0"
              >+</button>
              <span className={`w-8 text-right text-xs font-bold shrink-0 ${total >= 80 ? "text-amber-300" : total >= 60 ? "text-green-300" : "text-slate-200"}`}>
                {total}%
              </span>
            </div>
          );
        })}
      </div>
      {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
      <button
        onClick={save}
        disabled={saving}
        className="mt-3 w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium text-sm"
      >
        {saving ? "儲存中…" : "確認技能並加入收藏"}
      </button>
      <button
        onClick={onSaved}
        className="mt-1 w-full text-xs text-slate-500 hover:text-slate-300"
      >
        跳過（使用基礎值）
      </button>
    </div>
  );
}

// ─── Die animation ────────────────────────────────────────────────────────────

function Die({ value, rolling, sides }: { value: number; rolling: boolean; sides: number }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (!rolling) { setDisplay(value); return; }
    const t = setInterval(() => setDisplay(Math.floor(Math.random() * sides) + 1), 70);
    return () => clearInterval(t);
  }, [rolling, value, sides]);
  return (
    <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg border text-lg font-bold transition-colors ${
      rolling ? "bg-slate-700 border-slate-500 text-slate-300 animate-pulse" : "bg-zinc-800/60 border-zinc-500 text-white"
    }`}>
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
  const completed = steps.slice(0, index).map((s) => ({ label: s.label, total: s.total }));

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
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={phase === "skills" ? undefined : onDone}
    >
      <div
        className="bg-slate-900 border border-zinc-600 rounded-2xl shadow-2xl shadow-black/50 w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-4">
          <p className="text-xs text-zinc-100 uppercase tracking-widest">抽取你的調查員</p>
          <h2 className="text-xl font-bold text-white mt-1">{card.name}</h2>
        </div>

        {phase === "rolling" && step ? (
          <div className="text-center py-6">
            <p className="text-slate-400 text-xs mb-0.5 uppercase tracking-wider">{step.label}</p>
            <p className="text-slate-500 text-xs mb-4">{step.labelZh}</p>
            <div className="flex items-center justify-center gap-2 mb-4 flex-wrap">
              {step.dice.map((d, i) => (
                <Die key={i} value={d} rolling={rolling} sides={step.sides} />
              ))}
            </div>
            <div className="text-3xl font-extrabold text-white h-9">
              {rolling ? <span className="text-slate-600">…</span> : (
                <>
                  {step.base > 0 && <span className="text-slate-500 text-lg">{step.base} + {step.total - step.base} = </span>}
                  {step.total}
                </>
              )}
            </div>
          </div>
        ) : phase === "summary" ? (
          <div className="text-center py-4">
            <p className="text-sm text-slate-400 uppercase tracking-wider mb-1">屬性總計</p>
            <div className="text-5xl font-extrabold text-white mb-1">{card.total_stats}</div>
            <div className={`text-2xl font-bold mb-3 ${RARITY_TEXT[card.rarity]}`}>{card.rarity}</div>
            <div className="grid grid-cols-3 gap-1.5 text-xs mb-3">
              {[
                { label: "HP", value: card.hp },
                { label: "SAN", value: card.san },
                { label: "MP", value: card.mp },
              ].map((d) => (
                <div key={d.label} className="bg-slate-800 rounded px-2 py-1">
                  <div className="text-slate-500">{d.label}</div>
                  <div className="text-white font-bold">{d.value}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mb-1">
              技能點：<span className="text-white font-bold">{card.edu * 2 + card.int * 2}</span>
              <span className="text-slate-500"> (EDU×2 + INT×2)</span>
            </p>
            <button
              onClick={() => setPhase("skills")}
              className="mt-2 w-full bg-zinc-800 hover:bg-zinc-700 text-white py-2.5 rounded-lg font-medium"
            >
              分配技能點數 →
            </button>
            <button onClick={onDone} className="mt-1 w-full text-xs text-slate-500 hover:text-slate-300">
              跳過，直接加入收藏
            </button>
          </div>
        ) : (
          <SkillAllocator card={card} onSaved={onDone} />
        )}

        {/* Running tally during roll */}
        {phase === "rolling" && completed.length > 0 && (
          <div className="grid grid-cols-4 gap-1.5 mt-2 pt-4 border-t border-slate-800">
            {completed.map((c) => (
              <div key={c.label} className="bg-slate-800/60 rounded px-1.5 py-1 text-center">
                <div className="text-[10px] text-slate-500">{c.label}</div>
                <div className="text-sm font-bold text-slate-200">{c.total}</div>
              </div>
            ))}
          </div>
        )}

        {phase === "rolling" && (
          <button onClick={() => setPhase("summary")} className="mt-4 w-full text-xs text-slate-500 hover:text-slate-300">
            跳過動畫
          </button>
        )}
      </div>
    </div>
  );
}
