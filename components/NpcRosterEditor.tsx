"use client";
import type { NpcEntry } from "@/lib/ai/gm";

// Humanized NPC roster editor shared by the create & edit scenario pages.
//
// Design goals (UI/UX):
//  - The fields a creator actually thinks about — name, personality, goal —
//    stay front and centre. HP/MP (the values that change in play) sit right
//    under the name.
//  - The 8 Call-of-Cthulhu characteristics are intimidating as a raw 3×4 grid
//    of numbers, so they live behind a "戰鬥屬性" disclosure that is collapsed
//    by default. Each carries a plain-language tooltip.
//  - Preset templates fill sensible stat blocks in one click so a creator never
//    has to hand-tune eleven numbers to get a "normal person" or "monster".

const inputCls =
  "w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500";
const taCls = `${inputCls} resize-none`;

// label + one-line tooltip for every stat, so numbers stop being cryptic.
const STAT_META: Record<string, { label: string; hint: string }> = {
  hp: { label: "HP 生命值", hint: "生命值 — 歸零即倒下／死亡" },
  mp: { label: "MP 魔法", hint: "魔法／意志力 — 施法或特殊能力的資源" },
  str: { label: "STR 力量", hint: "力量 — 近戰傷害與搬抬重物" },
  con: { label: "CON 體質", hint: "體質 — 耐力與生命值上限的依據" },
  siz: { label: "SIZ 體型", hint: "體型 — 身材高矮胖瘦，影響傷害與生命" },
  dex: { label: "DEX 敏捷", hint: "敏捷 — 影響行動順序與閃避攻擊" },
  app: { label: "APP 外貌", hint: "外貌 — 第一印象與社交魅力" },
  int: { label: "INT 智力", hint: "智力 — 推理、靈感與識破詭計" },
  pow: { label: "POW 意志", hint: "意志 — 精神力，抵抗恐懼與魔法" },
  edu: { label: "EDU 教育", hint: "教育 — 知識與學識的廣度" },
  luck: { label: "LUCK 幸運", hint: "幸運 — 在沒有對應技能時的運氣判定" },
};

const COMBAT_STATS: (keyof NpcEntry)[] = [
  "str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck",
];

// One-click stat blocks. Each preset sets HP/MP + the 8 characteristics but
// never touches name / personality / goal / social_immune / id.
type NumericStat = "hp" | "mp" | "str" | "con" | "siz" | "dex" | "app" | "int" | "pow" | "edu" | "luck";
type Preset = { label: string; emoji: string; stats: Partial<Record<NumericStat, number>> };
const PRESETS: Preset[] = [
  { label: "普通人", emoji: "🙂", stats: { hp: 10, mp: 5, str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50 } },
  { label: "強壯戰士", emoji: "⚔️", stats: { hp: 15, mp: 8, str: 70, con: 70, siz: 60, dex: 60, app: 50, int: 50, pow: 55, edu: 45, luck: 50 } },
  { label: "兇猛怪物", emoji: "👹", stats: { hp: 22, mp: 5, str: 85, con: 80, siz: 80, dex: 55, app: 25, int: 25, pow: 65, edu: 10, luck: 40 } },
  { label: "孱弱平民", emoji: "🧎", stats: { hp: 6, mp: 4, str: 35, con: 40, siz: 45, dex: 45, app: 50, int: 55, pow: 45, edu: 55, luck: 50 } },
];

export function NpcRosterEditor({
  npcs,
  onChange,
  makeEmpty,
}: {
  npcs: NpcEntry[];
  onChange: (next: NpcEntry[]) => void;
  makeEmpty: () => NpcEntry;
}) {
  function update(i: number, patch: Partial<NpcEntry>) {
    const next = [...npcs];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      {npcs.map((npc, i) => (
        <div key={npc.id || i} className="relative border border-slate-600 rounded-lg p-4 bg-slate-900/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-slate-400 font-medium">NPC {i + 1}</span>
            <button
              type="button"
              onClick={() => onChange(npcs.filter((_, j) => j !== i))}
              className="text-slate-500 hover:text-red-400 text-sm"
            >
              ×
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <input
              value={npc.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="姓名"
              className={inputCls}
            />

            {/* HP / MP up front — these are the values that move during play. */}
            <div className="grid grid-cols-2 gap-2">
              {(["hp", "mp"] as (keyof NpcEntry)[]).map((stat) => (
                <label key={stat} className="flex flex-col gap-1" title={STAT_META[stat].hint}>
                  <span className="text-xs text-slate-500">{STAT_META[stat].label}</span>
                  <input
                    type="number"
                    value={npc[stat] as number}
                    onChange={(e) => update(i, { [stat]: Number(e.target.value) } as Partial<NpcEntry>)}
                    min={stat === "mp" ? 0 : 1}
                    max={99}
                    className={inputCls}
                  />
                </label>
              ))}
            </div>

            <textarea
              value={npc.personality}
              onChange={(e) => update(i, { personality: e.target.value })}
              rows={2}
              placeholder="個性、說話方式、行為習慣"
              className={taCls}
            />
            <textarea
              value={npc.goal}
              onChange={(e) => update(i, { goal: e.target.value })}
              rows={2}
              placeholder="他們想要什麼？在意什麼？隱藏著什麼秘密？"
              className={taCls}
            />

            {/* Advanced characteristics — collapsed by default. */}
            <details className="group mt-1 border border-slate-700/60 rounded-lg bg-slate-900/40">
              <summary className="cursor-pointer select-none list-none px-3 py-2 text-xs text-slate-400 hover:text-slate-200 flex items-center justify-between">
                <span>⚔️ 戰鬥屬性（選填，預設 50 即可）</span>
                <span className="opacity-60 group-open:rotate-90 transition-transform">▸</span>
              </summary>
              <div className="px-3 pb-3 pt-1">
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="text-[11px] text-slate-500 self-center mr-1">套用範本：</span>
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => update(i, p.stats)}
                      title={`一鍵套用「${p.label}」的數值`}
                      className="text-[11px] text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-md px-2 py-1"
                    >
                      {p.emoji} {p.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {COMBAT_STATS.map((stat) => (
                    <label key={stat} className="flex flex-col gap-1" title={STAT_META[stat].hint}>
                      <span className="text-xs text-slate-500">{STAT_META[stat].label}</span>
                      <input
                        type="number"
                        value={npc[stat] as number}
                        onChange={(e) => update(i, { [stat]: Number(e.target.value) } as Partial<NpcEntry>)}
                        min={1}
                        max={99}
                        className={inputCls}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </details>

            <label className="flex items-center gap-2 cursor-pointer select-none mt-1">
              <input
                type="checkbox"
                checked={!!npc.social_immune}
                onChange={(e) => update(i, { social_immune: e.target.checked })}
                className="accent-amber-500 w-4 h-4"
              />
              <span className="text-xs text-amber-300/80">🛡 對社交技能免疫（怪物、無意識存在、終極敵人）</span>
            </label>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...npcs, makeEmpty()])}
        className="text-sm text-zinc-100 hover:text-white border border-dashed border-slate-600 hover:border-zinc-400 rounded-lg py-2 transition-colors"
      >
        + 新增 NPC
      </button>
    </div>
  );
}
