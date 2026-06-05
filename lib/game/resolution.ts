// Rule-based action resolution — CoC d100 roll-under system.
// Skill-first: match action to a named skill and roll against its full stored
// value. Raw stats are fallbacks only when no skill applies.

import type { SkillPoints } from "@/lib/cards/dice";

export type StatKey = "str" | "con" | "dex" | "app" | "int" | "pow" | "edu" | "luck";
export type Category = "physical" | "mental" | "social" | "luck" | "sanity";
export type Outcome = "critical_success" | "success" | "failure" | "critical_failure";

export interface RollResult {
  requires_check:      boolean;
  stat_used:           string | null;   // skill name or stat key, for display
  target:              number | null;   // roll-under value
  d100_roll:           number | null;
  outcome:             Outcome | null;
  hp_change:           number;
  san_change:          number;
  consequence_summary: string;
}

export interface CheckCharacter {
  hp: number; san: number; mp: number;
  str: number; con: number; siz: number; dex: number; app: number;
  int: number; pow: number; edu: number; luck: number;
  skills?: SkillPoints | null;
}

// ─── Skill rules (checked first, in priority order) ──────────────────────────

interface SkillRule {
  skillKey:     string;           // key in char.skills
  displayName:  string;           // shown in dice result UI & GM prompt
  category:     Category;
  baseValue:    (c: CheckCharacter) => number;  // fallback when skill not allocated
  keywords:     string[];
}

const SKILL_RULES: SkillRule[] = [
  {
    skillKey: "spot_hidden", displayName: "偵查", category: "mental",
    baseValue: () => 10,
    keywords: [
      "search", "investigate", "spot", "notice", "observe", "inspect", "examine",
      "look for", "look around", "look through",
      "搜查", "搜索", "調查", "偵查", "察看", "觀察", "檢查", "審視",
      "尋找", "找線索", "找證據", "找東西", "翻找",
    ],
  },
  {
    skillKey: "listen", displayName: "聆聽", category: "mental",
    baseValue: () => 10,
    keywords: [
      "listen", "hear", "eavesdrop",
      "聆聽", "傾聽", "聽聲音", "聽動靜",
    ],
  },
  {
    skillKey: "library_use", displayName: "圖書館使用", category: "mental",
    baseValue: () => 10,
    keywords: [
      "library", "research", "archives", "look it up", "look up",
      "圖書館", "查資料", "查閱", "翻閱資料", "研究資料",
    ],
  },
  {
    skillKey: "psychology", displayName: "心理學", category: "mental",
    baseValue: () => 1,
    keywords: [
      "psychology", "read the person", "sense motive", "read their expression",
      "心理學", "讀人", "判斷對方", "觀察對方神情",
    ],
  },
  {
    skillKey: "persuade", displayName: "說服", category: "social",
    baseValue: () => 5,
    keywords: [
      "persuade", "convince", "negotiate", "bargain", "plead", "appeal",
      "說服", "勸說", "勸導", "談判", "懇求",
    ],
  },
  {
    skillKey: "fast_talk", displayName: "話術", category: "social",
    baseValue: () => 5,
    keywords: [
      "bluff", "lie", "deceive", "fast talk", "trick", "mislead",
      "話術", "欺騙", "撒謊", "虛張聲勢", "哄騙",
    ],
  },
  {
    skillKey: "charm", displayName: "魅惑", category: "social",
    baseValue: (c) => Math.floor((c.app ?? 50) / 2),
    keywords: [
      "charm", "seduce", "flatter", "impress", "comfort", "reassure",
      "魅惑", "奉承", "吹捧", "哄", "安慰",
    ],
  },
  {
    skillKey: "intimidate", displayName: "恐嚇", category: "social",
    baseValue: (c) => Math.floor((100 - (c.app ?? 50)) / 5),
    keywords: [
      "intimidate", "threaten", "scare", "menace",
      "恐嚇", "威脅", "嚇", "恫嚇",
    ],
  },
  {
    skillKey: "dodge", displayName: "閃避", category: "physical",
    baseValue: (c) => Math.floor((c.dex ?? 50) / 2),
    keywords: [
      "dodge", "evade", "duck", "sidestep",
      "閃避", "躲避", "閃開",
    ],
  },
  {
    skillKey: "first_aid", displayName: "急救", category: "mental",
    baseValue: () => 1,
    keywords: [
      "first aid", "heal", "bandage", "treat", "patch up",
      "急救", "治療", "包紮", "處理傷口",
    ],
  },
  {
    skillKey: "stealth", displayName: "潛行", category: "physical",
    baseValue: () => 1,
    keywords: [
      "sneak", "hide", "stealth", "move quietly", "creep", "tiptoe",
      "潛行", "潛入", "偷偷", "悄悄",
    ],
  },
  {
    skillKey: "lockpick", displayName: "開鎖", category: "physical",
    baseValue: () => 1,
    keywords: [
      "lockpick", "pick the lock", "pick the door", "open the lock",
      "開鎖", "撬鎖", "撬門",
    ],
  },
  {
    skillKey: "drive_auto", displayName: "駕駛汽車", category: "physical",
    baseValue: () => 0,
    keywords: [
      "drive", "steer", "pilot the car",
      "駕駛", "開車",
    ],
  },
];

// ─── Raw stat fallback rules (used when no skill matches) ─────────────────────

interface StatRule {
  stat:     StatKey;
  category: Category;
  keywords: string[];
}

const STAT_RULES: StatRule[] = [
  { stat: "str", category: "physical", keywords: [
    "attack", "fight", "strike", "hit", "punch", "smash", "break", "force",
    "push", "lift", "bash", "swing", "slam", "kill", "stab", "shoot",
    "tackle", "wrestle", "tear", "rip",
    "攻擊", "打擊", "揮拳", "格鬥", "扭打", "推開", "舉起", "砸",
  ]},
  { stat: "con", category: "physical", keywords: [
    "endure", "withstand", "tough out", "ignore the pain", "resist the poison",
    "硬撐", "忍痛", "抵抗毒", "撐住",
  ]},
  { stat: "dex", category: "physical", keywords: [
    "climb", "run", "escape", "flee", "jump", "leap", "dash", "sprint",
    "tumble", "crawl", "chase",
    "攀爬", "奔跑", "逃跑", "逃走", "逃離", "跳躍", "爬行", "追趕",
  ]},
  { stat: "pow", category: "sanity", keywords: [
    "resist the horror", "withstand the fear", "steel my mind", "face the horror",
    "抵抗恐懼", "面對恐懼", "穩住心神", "抵抗瘋狂",
  ]},
  { stat: "luck", category: "luck", keywords: [
    "gamble", "bet", "guess", "by chance", "pray", "hope", "take a risk",
    "賭", "猜", "祈禱", "碰運氣",
  ]},
];

function rollD100(): number {
  return Math.floor(Math.random() * 100) + 1;
}

function matchSkill(text: string): SkillRule | null {
  const t = text.toLowerCase();
  let best: { rule: SkillRule; score: number } | null = null;
  for (const rule of SKILL_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (t.includes(kw)) score++;
    }
    if (score > 0 && (!best || score > best.score)) best = { rule, score };
  }
  return best?.rule ?? null;
}

function matchStat(text: string): StatRule | null {
  const t = text.toLowerCase();
  let best: { rule: StatRule; score: number } | null = null;
  for (const rule of STAT_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (t.includes(kw)) score++;
    }
    if (score > 0 && (!best || score > best.score)) best = { rule, score };
  }
  return best?.rule ?? null;
}

// Skills are stored as full values (base+allocated). If not allocated (null),
// fall back to the skill's base formula.
function skillTarget(rule: SkillRule, char: CheckCharacter): number {
  const stored = (char.skills ?? {})[rule.skillKey as keyof SkillPoints] as number | undefined;
  const value = (stored != null && stored > 0) ? stored : rule.baseValue(char);
  return Math.min(99, value);
}

function decideOutcome(roll: number, target: number): Outcome {
  if (roll >= 96)                      return "critical_failure";
  if (roll <= Math.floor(target / 5)) return "critical_success";
  if (roll <= target)                  return "success";
  return "failure";
}

function consequences(category: Category, outcome: Outcome): { hp: number; san: number; flavor: string } {
  const isSanity = category === "sanity";
  switch (outcome) {
    case "critical_success":
      return { hp: 0, san: 0, flavor: "大成功 — 超乎預期的完美結果。" };
    case "success":
      return { hp: 0, san: 0, flavor: "成功。" };
    case "failure":
      return isSanity
        ? { hp: 0, san: -2, flavor: "失敗 — 恐懼侵蝕心神（SAN −2）。" }
        : { hp: 0, san: 0,  flavor: "失敗 — 行動受挫，但未受傷。" };
    case "critical_failure":
      return isSanity
        ? { hp: 0, san: -4, flavor: "大失敗 — 心神瀕臨崩潰（SAN −4）。" }
        : { hp: -4, san: 0,  flavor: "大失敗 — 嚴重失誤，後果慘重（HP −4）。" };
  }
}

export function resolveAction(actionText: string, char: CheckCharacter): RollResult {
  // 1. Try skill-first match
  const skillRule = matchSkill(actionText);
  if (skillRule) {
    const target  = skillTarget(skillRule, char);
    const roll    = rollD100();
    const outcome = decideOutcome(roll, target);
    const cons    = consequences(skillRule.category, outcome);
    return {
      requires_check: true,
      stat_used:  skillRule.displayName,
      target, d100_roll: roll, outcome,
      hp_change:  Math.max(cons.hp,  -char.hp),
      san_change: Math.max(cons.san, -char.san),
      consequence_summary: cons.flavor,
    };
  }

  // 2. Fallback to raw stat
  const statRule = matchStat(actionText);
  if (statRule) {
    const target  = Math.min(99, char[statRule.stat as keyof CheckCharacter] as number);
    const roll    = rollD100();
    const outcome = decideOutcome(roll, target);
    const cons    = consequences(statRule.category, outcome);
    return {
      requires_check: true,
      stat_used:  statRule.stat.toUpperCase(),
      target, d100_roll: roll, outcome,
      hp_change:  Math.max(cons.hp,  -char.hp),
      san_change: Math.max(cons.san, -char.san),
      consequence_summary: cons.flavor,
    };
  }

  // 3. No check needed
  return {
    requires_check: false,
    stat_used: null, target: null, d100_roll: null, outcome: null,
    hp_change: 0, san_change: 0,
    consequence_summary: "No dice check required.",
  };
}

export function outcomeLabel(outcome: Outcome): string {
  return {
    critical_success: "大成功",
    success:          "成功",
    failure:          "失敗",
    critical_failure: "大失敗",
  }[outcome];
}
