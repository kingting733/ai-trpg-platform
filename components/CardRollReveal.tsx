"use client";
import { useRef, useState } from "react";
import { Drama, Star, ArrowRight, AlertTriangle } from "lucide-react";
import { GachaSummon, TIER, gold, buildStatSteps } from "@/components/GachaSummon";
import { OccupationRoulette } from "@/components/OccupationRoulette";
import { SKILL_ALLOC_CAP } from "@/lib/game/skills";

const OCCUPATION_ICON: Record<string, string> = {
  "記者":     "/reporter.png",
  "警探":     "/detective.png",
  "大學生":   "/student.png",
  "醫生":     "/doctor.png",
  "黑幫成員": "/gangster.png",
  "風水師":   "/fengshui.png",
  "退役軍人": "/veteran.png",
  "YouTuber": "/youtuber.png",
  "前邪教成員":"/cultist.png",
  "賭徒":     "/gambler.png",
  "走私司機": "/smuggler.png",
};

function OccupationImg({ name, className, size = 40 }: { name: string; className?: string; size?: number }) {
  const src = OCCUPATION_ICON[name];
  if (!src) return <span className={className} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Drama size={size * 0.7} strokeWidth={2} /></span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={name} width={size} height={size} className={className} style={{ objectFit: "contain" }} />;
}

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

const PANEL = {
  background: "linear-gradient(150deg,#1c1813 0%,#13100b 55%,#0f0c08 100%)",
  border: "1px solid #2e2416",
  boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
};

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
      if (base + next > SKILL_ALLOC_CAP) return prev;
      return { ...prev, [key]: next };
    });
  }

  function setDirect(key: SkillKey, raw: string) {
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 0) { setAllocated((prev) => ({ ...prev, [key]: 0 })); return; }
    const base = floorFor(SKILLS.find((s) => s.key === key)!);
    const cur = allocated[key] ?? 0;
    const headroom = remaining + cur;
    const capped = Math.max(0, Math.min(n, headroom, SKILL_ALLOC_CAP - base));
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
        <span className="text-zinc-400 text-sm">分配技能點數<span className="text-zinc-600 text-xs ml-1.5">每項最高 {SKILL_ALLOC_CAP}</span></span>
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
                {buffed && (
                  <span className="ml-1 text-[10px] inline-flex items-center gap-0.5" style={{ color: "#c9a96e" }}>
                    <Star size={9} strokeWidth={2} fill="currentColor" />職業
                  </span>
                )}
              </span>
              <span className="text-[10px] text-zinc-600 w-5 text-right shrink-0">{base}</span>
              <span className="text-zinc-700 text-xs">+</span>
              <button onClick={() => adjust(s.key, -1)} disabled={add <= 0}
                className="w-5 h-5 rounded flex items-center justify-center text-xs disabled:opacity-25 hover:brightness-125"
                style={{ background: "#1a150e", border: "1px solid #2e2416", color: "#c9a96e" }}>−</button>
              <input type="number" min={0} max={Math.max(0, SKILL_ALLOC_CAP - base)} value={add}
                onChange={(e) => setDirect(s.key, e.target.value)}
                className="w-9 rounded text-center text-xs py-0.5 focus:outline-none"
                style={{ background: "#0e0c08", border: "1px solid rgba(201,169,110,0.3)", color: "#e4d8be" }} />
              <button onClick={() => adjust(s.key, 1)} disabled={remaining <= 0 || base + add >= SKILL_ALLOC_CAP}
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
  const [locked, setLocked] = useState(false);

  return (
    <div className="flex flex-col items-center gap-4 py-1">
      {/* Eyebrow */}
      <div className="flex items-center gap-3 w-full">
        <div className="h-px flex-1" style={{ background: "linear-gradient(to right, transparent, rgba(201,169,110,0.3))" }} />
        <span className="text-[10px] tracking-[0.25em] uppercase" style={{ color: "rgba(201,169,110,0.5)" }}>職業抽籤</span>
        <div className="h-px flex-1" style={{ background: "linear-gradient(to left, transparent, rgba(201,169,110,0.3))" }} />
      </div>

      <OccupationRoulette occupation={occupation} icons={OCCUPATION_ICON} onLocked={() => setLocked(true)} />

      {/* Buffed skills reveal — only shown once the wheel stops */}
      {locked && (
        <div className="w-full gacha-fade-in">
          <p className="text-[10px] tracking-[0.2em] uppercase text-center mb-2"
            style={{ color: "rgba(201,169,110,0.55)" }}>職業加成技能 +10</p>
          <div className="grid grid-cols-2 gap-2">
            {buffedSkills.map((key) => (
              <div key={key} className="rounded-lg px-3 py-2.5 flex items-center gap-2"
                style={{ background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.35)" }}>
                <Star size={14} strokeWidth={2} fill="currentColor" className="text-gold" />
                <span className="text-sm font-medium" style={{ color: "#e4d8be" }}>
                  {SKILL_ZH_MAP[key] ?? key}
                </span>
                <span className="ml-auto text-xs font-bold" style={{ color: "#c9a96e" }}>+10</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {locked && (
        <button
          onClick={onDone}
          className="w-full py-2.5 rounded-lg font-serif text-sm transition-all hover:brightness-110 gacha-fade-in"
          style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 16px rgba(201,169,110,0.2)" }}
        >
          <span className="inline-flex items-center gap-1">查看屬性總覽 <ArrowRight size={16} strokeWidth={2} /></span>
        </button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CardRollReveal({ card, onDone }: { card: RevealCard; onDone: () => void }) {
  const steps = useRef(buildStatSteps(card)).current;
  const [phase, setPhase] = useState<"summon" | "occupation" | "summary" | "skills">("summon");
  const [confirmSkip, setConfirmSkip] = useState(false);
  const tier = TIER[card.rarity];
  const rarity = { glow: gold(tier.glow), label: tier.zh };

  // Derive the two buffed skill keys from the card's seeded skills (if any)
  const buffedSkillKeys: string[] = card.skills
    ? Object.keys(card.skills).filter((k) => {
        const s = SKILLS.find((sk) => sk.key === k);
        if (!s) return false;
        const base = baseForSkill(s, card.dex, card.app);
        return (card.skills![k] ?? 0) > base;
      })
    : [];

  // 調查員召喚: seal → 3D dice with the rarity meter → reveal (components/GachaSummon.tsx).
  if (phase === "summon") {
    return <GachaSummon card={card} onComplete={() => setPhase(card.occupation ? "occupation" : "summary")} />;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(5,4,2,0.88)", backdropFilter: "blur(6px)" }}
      // A stray backdrop click used to close the overlay outright, silently
      // skipping skill allocation; route it through the same warning as 跳過.
      onClick={phase === "skills" ? undefined : () => setConfirmSkip(true)}>

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
                <OccupationImg name={card.occupation} size={56} className="shrink-0 rounded-xl" />
              )}
              <div>
                <h2 className="font-serif text-xl" style={{ color: "#e4d8be", letterSpacing: "0.04em" }}>{card.name}</h2>
                {card.occupation && (phase === "summary" || phase === "skills") && (
                  <p className="text-[11px] mt-0.5" style={{ color: "rgba(201,169,110,0.65)" }}>{card.occupation}</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Occupation reveal phase ── */}
          {phase === "occupation" && card.occupation ? (
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
                <div className="text-lg font-semibold tracking-widest font-serif"
                  style={{ color: card.rarity === "Legendary" ? "#e4d8be" : "#c9a96e", textShadow: `0 0 14px ${rarity.glow}` }}>
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
                    <div className="text-[9px] tracking-wide mb-0.5" style={{ color: "rgba(201,169,110,0.5)" }}>{s.zh}</div>
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
                <span className="inline-flex items-center gap-1">分配技能點數 <ArrowRight size={16} strokeWidth={2} /></span>
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
              <div className="mb-2 flex justify-center text-amber-400"><AlertTriangle size={32} strokeWidth={2} /></div>
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

    </div>
  );
}
