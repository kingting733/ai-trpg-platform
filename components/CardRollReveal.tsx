"use client";
import { useEffect, useRef, useState } from "react";

type Rarity = "Common" | "Rare" | "Epic" | "Legendary";

interface RollDetails {
  hp: { base: number; dice: number[] };
  san: { base: number; dice: number[] };
  str: { dice: number[] };
  agi: { dice: number[] };
  int: { dice: number[] };
  cha: { dice: number[] };
  luck: { dice: number[] };
  speed: { dice: number[] };
}

export interface RevealCard {
  name: string;
  hp: number; san: number;
  str: number; agi: number; int: number; cha: number; luck: number; speed: number;
  total_stats: number;
  rarity: Rarity;
  roll_details: RollDetails | null;
}

const RARITY_TEXT: Record<Rarity, string> = {
  Common: "text-slate-300",
  Rare: "text-sky-300",
  Epic: "text-purple-300",
  Legendary: "text-amber-300",
};

interface Step {
  key: string;
  label: string;
  sides: number;
  base: number;
  dice: number[];
  total: number;
}

function buildSteps(card: RevealCard): Step[] {
  const rd = card.roll_details;
  // Fallback for older cards without roll_details — synthesize a single "die".
  if (!rd) {
    const mk = (label: string, total: number): Step => ({ key: label, label, sides: 6, base: 0, dice: [total], total });
    return [
      mk("HP", card.hp), mk("SAN", card.san), mk("STR", card.str), mk("AGI", card.agi),
      mk("INT", card.int), mk("CHA", card.cha), mk("LUCK", card.luck), mk("SPEED", card.speed),
    ];
  }
  return [
    { key: "HP", label: "HP", sides: 10, base: rd.hp.base, dice: rd.hp.dice, total: card.hp },
    { key: "SAN", label: "SAN", sides: 10, base: rd.san.base, dice: rd.san.dice, total: card.san },
    { key: "STR", label: "STR", sides: 6, base: 0, dice: rd.str.dice, total: card.str },
    { key: "AGI", label: "AGI", sides: 6, base: 0, dice: rd.agi.dice, total: card.agi },
    { key: "INT", label: "INT", sides: 6, base: 0, dice: rd.int.dice, total: card.int },
    { key: "CHA", label: "CHA", sides: 6, base: 0, dice: rd.cha.dice, total: card.cha },
    { key: "LUCK", label: "LUCK", sides: 6, base: 0, dice: rd.luck.dice, total: card.luck },
    { key: "SPEED", label: "SPEED", sides: 6, base: 0, dice: rd.speed.dice, total: card.speed },
  ];
}

function Die({ value, rolling, sides }: { value: number; rolling: boolean; sides: number }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (!rolling) { setDisplay(value); return; }
    const t = setInterval(() => setDisplay(Math.floor(Math.random() * sides) + 1), 70);
    return () => clearInterval(t);
  }, [rolling, value, sides]);
  return (
    <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg border text-lg font-bold transition-colors ${
      rolling ? "bg-slate-700 border-slate-500 text-slate-300 animate-pulse" : "bg-purple-900/40 border-purple-500 text-white"
    }`}>
      {display}
    </span>
  );
}

export function CardRollReveal({ card, onDone }: { card: RevealCard; onDone: () => void }) {
  const steps = useRef(buildSteps(card)).current;
  const [index, setIndex] = useState(0);
  const [rolling, setRolling] = useState(true);
  const [finished, setFinished] = useState(false);
  const completed = steps.slice(0, index).map((s) => ({ label: s.label, total: s.total }));

  useEffect(() => {
    if (index >= steps.length) { setFinished(true); return; }
    setRolling(true);
    const rollTime = setTimeout(() => setRolling(false), 650);   // tumble
    const advance = setTimeout(() => setIndex((i) => i + 1), 1250); // settle then next
    return () => { clearTimeout(rollTime); clearTimeout(advance); };
  }, [index, steps.length]);

  const step = steps[index];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={finished ? onDone : undefined}>
      <div className="bg-slate-900 border border-purple-700 rounded-2xl shadow-2xl shadow-purple-900/50 w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="text-center mb-4">
          <p className="text-xs text-purple-400 uppercase tracking-widest">抽取你的角色卡</p>
          <h2 className="text-xl font-bold text-white mt-1">{card.name}</h2>
        </div>

        {!finished && step ? (
          <div className="text-center py-6">
            <p className="text-sm text-slate-400 uppercase tracking-wider mb-4">{step.label}</p>
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
        ) : (
          <div className="text-center py-6">
            <p className="text-sm text-slate-400 uppercase tracking-wider mb-1">屬性總計</p>
            <div className="text-5xl font-extrabold text-white mb-3">{card.total_stats}</div>
            <div className={`text-2xl font-bold ${RARITY_TEXT[card.rarity]}`}>{card.rarity}</div>
            <button
              onClick={onDone}
              className="mt-6 w-full bg-purple-600 hover:bg-purple-500 text-white py-2.5 rounded-lg font-medium"
            >
              加入收藏
            </button>
          </div>
        )}

        {/* Running tally of settled stats */}
        {completed.length > 0 && (
          <div className="grid grid-cols-4 gap-1.5 mt-2 pt-4 border-t border-slate-800">
            {completed.map((c) => (
              <div key={c.label} className="bg-slate-800/60 rounded px-1.5 py-1 text-center">
                <div className="text-[10px] text-slate-500">{c.label}</div>
                <div className="text-sm font-bold text-slate-200">{c.total}</div>
              </div>
            ))}
          </div>
        )}

        {!finished && (
          <button onClick={onDone} className="mt-4 w-full text-xs text-slate-500 hover:text-slate-300">
            跳過動畫
          </button>
        )}
      </div>
    </div>
  );
}
