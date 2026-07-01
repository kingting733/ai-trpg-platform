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
  san_check?:          SanCheckResult | null;  // horror-triggered SAN check
  attack?:             AttackResult | null;    // contested-attack detail (dodge + damage)
}

export type SanSeverity = "obvious" | "strong" | "core" | "final";

export interface SanCheckResult {
  severity:       SanSeverity;
  severity_label: string;   // Chinese label for UI/GM
  trigger_text:   string;   // the horror keyword that fired this check (what they saw)
  pow:            number;    // roll-under target
  roll:           number;    // d100
  success:        boolean;   // roll <= pow
  san_loss:       number;    // points lost this check
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
  {
    skillKey: "firearms", displayName: "射擊", category: "physical",
    baseValue: () => 20,
    keywords: [
      "shoot", "fire", "gun", "pistol", "revolver", "rifle", "shotgun",
      "aim", "open fire", "take aim", "shoot at", "fire at",
      "射擊", "開槍", "開火", "射", "瞄準", "射死", "槍",
    ],
  },
  {
    skillKey: "occult", displayName: "神秘學", category: "mental",
    baseValue: () => 5,
    keywords: [
      "occult", "ritual", "arcane", "esoteric", "symbol", "rune", "incantation",
      "tome", "grimoire", "supernatural lore", "identify the symbol",
      "神秘學", "神祕學", "儀式", "符文", "符號", "咒語", "魔法書", "禁書", "邪教",
    ],
  },
  {
    skillKey: "fighting", displayName: "搏鬥", category: "physical",
    baseValue: () => 25,
    keywords: [
      "punch", "brawl", "fight", "grapple", "wrestle", "strike", "melee",
      "hit", "knife", "stab", "swing at", "tackle", "beat up",
      "搏鬥", "打鬥", "肉搏", "毆打", "揮拳", "出拳", "扭打", "近身", "刺", "捅", "打架",
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
    // Combat & clearly forceful actions only — trivial pushes/lifts should NOT
    // trigger a check, so generic "push"/"lift"/"推開"/"舉起" are excluded.
    "attack", "fight", "strike", "punch", "smash", "bash", "slam",
    "kill", "stab", "shoot", "tackle", "wrestle",
    "break down", "force open", "force the door", "pry open",
    "攻擊", "打擊", "揮拳", "格鬥", "扭打", "砸", "撞開", "破門",
    "用力推", "強行推", "用力扳", "踹開", "猛拉", "扯開",
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

function rollDice(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

function rollDiceN(n: number, sides: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += rollDice(sides);
  return sum;
}

// ─── Injury system (GM flags target+severity; SERVER rolls & applies) ───────
// Separate from the deterministic action-check consequences above. Lets the AI
// narrate "hit by an enemy / trap / monster" injuries to ANY roster member or
// NPC, while keeping the actual HP math (and thus tamper-resistance) server-side.

export type InjurySeverity = "minor" | "moderate" | "serious" | "severe";

const INJURY_TIERS: Record<InjurySeverity, { label: string; roll: () => number }> = {
  minor:    { label: "輕微", roll: () => rollDiceN(1, 2) },
  moderate: { label: "中度", roll: () => rollDiceN(1, 3) },
  serious:  { label: "重度", roll: () => rollDiceN(1, 6) },
  severe:   { label: "致命", roll: () => rollDiceN(1, 8) },
};

export function rollInjuryDamage(severity: InjurySeverity): { amount: number; label: string } {
  const tier = INJURY_TIERS[severity] ?? INJURY_TIERS.minor;
  return { amount: tier.roll(), label: tier.label };
}

// ─── Contested attack system ─────────────────────────────────────────────────
// When a character attacks another combatant (player OR npc), the ATTACKER rolls
// STR or 搏鬥, the DEFENDER rolls 閃避, then the server rolls damage. 搏鬥 (trained
// fighting) deals more damage than raw STR. A critical hit cannot be dodged.
//
// Damage tables (scaled to the small HP pool ≈ 5–18):
//   STR    — hit 1d3,  crit 1d6+1
//   搏鬥   — hit 1d6,  crit 2d6

export type AttackType = "str" | "fighting" | "ranged";

/** Default 閃避 value for NPCs/monsters that have no character sheet. */
export const NPC_DEFAULT_DODGE = 25;

// Ranged / firearm verbs → roll 射擊. Checked FIRST (most specific). Guns are
// modelled separately from melee: they use the firearms skill, gain NO strength
// damage bonus, and are hard to dodge (the defender's 閃避 is halved vs a gun).
// Bare "射" is excluded — it false-positives on 注射/發射/射門.
const RANGED_ATTACK_KEYWORDS = [
  "shoot", "shot at", "gun down", "fire at", "open fire",
  "射擊", "開槍", "射殺", "轟", "扣下扳機",
];

// Trained-fighting verbs → roll 搏鬥 (higher damage). Includes the generic
// "attack" verbs. NOTE: bare "打" is intentionally EXCLUDED — it false-positives
// on 打開/打掃/打字/打電話/打聽 — so only unambiguous compounds are listed.
const FIGHTING_ATTACK_KEYWORDS = [
  "attack", "kill",
  "punch", "brawl", "fight", "grapple", "wrestle", "strike", "melee",
  "knife", "stab", "swing at", "tackle", "beat up", "slash", "kick",
  "搏鬥", "打鬥", "肉搏", "毆打", "揮拳", "出拳", "扭打", "近身", "刺", "捅", "打架",
  "攻擊", "攻打", "襲擊", "撲向", "砍", "斬", "劈", "踢", "揍", "咬", "痛打",
  "打死", "打傷", "殺",
];

// Raw brute-force verbs → roll STR (lower damage).
const STR_ATTACK_KEYWORDS = [
  "smash", "bash", "slam", "crush", "choke", "strangle", "throw at", "headbutt",
  "砸", "撞擊", "掐", "扼", "勒", "摔", "猛力", "撕", "壓制", "扳斷",
];

/**
 * Decide whether an action is an attack and, if so, which skill it uses.
 * Returns null when the wording isn't an attack at all. Most specific wins:
 * ranged (firearms) → fighting (trained melee) → str (raw brute force).
 */
export function detectAttackType(text: string): AttackType | null {
  const t = text.toLowerCase();
  if (RANGED_ATTACK_KEYWORDS.some((k) => t.includes(k))) return "ranged";
  if (FIGHTING_ATTACK_KEYWORDS.some((k) => t.includes(k))) return "fighting";
  if (STR_ATTACK_KEYWORDS.some((k) => t.includes(k))) return "str";
  return null;
}

function attackSkillValue(type: AttackType, char: CheckCharacter): number {
  if (type === "ranged") {
    const stored = (char.skills ?? {}).firearms as number | undefined;
    return Math.min(99, stored != null && stored > 0 ? stored : 20);
  }
  if (type === "fighting") {
    const stored = (char.skills ?? {}).fighting as number | undefined;
    return Math.min(99, stored != null && stored > 0 ? stored : 25);
  }
  return Math.min(99, char.str);
}

/** A character's 閃避 value (stored skill, else DEX÷2). */
export function dodgeValueOf(char: CheckCharacter): number {
  const stored = (char.skills ?? {}).dodge as number | undefined;
  return Math.min(99, stored != null && stored > 0 ? stored : Math.floor((char.dex ?? 50) / 2));
}

/** Base weapon damage before any damage bonus (DB). */
function rollBaseAttackDamage(type: AttackType, crit: boolean): number {
  if (type === "ranged")   return crit ? rollDiceN(1, 10) + 2 : rollDiceN(1, 8);
  if (type === "fighting") return crit ? rollDiceN(2, 6)      : rollDiceN(1, 6);
  return crit ? rollDiceN(1, 6) + 1 : rollDiceN(1, 3); // str
}

/**
 * CoC 7e damage bonus from STR+SIZ (×5 percentile scale). Applied to melee
 * attacks (STR / 搏鬥) only — firearms never gain it. May be negative for a
 * frail attacker; callers floor the final landed-hit damage at 1.
 */
export function rollDamageBonus(str: number, siz: number): number {
  const t = (str || 0) + (siz || 0);
  if (t <= 64)  return -1;
  if (t <= 124) return 0;
  if (t <= 164) return rollDiceN(1, 4);
  if (t <= 204) return rollDiceN(1, 6);
  return rollDiceN(2, 6);
}

export interface AttackResult {
  type:          AttackType;
  skill_label:   string;        // 搏鬥 / 力量 (for display)
  target_name:   string;
  is_npc:        boolean;
  attack_target: number;        // attacker's roll-under value
  attack_roll:   number;
  attack_outcome: Outcome;
  hit:           boolean;       // attacker succeeded
  crit:          boolean;       // critical hit (undodgeable, crit damage)
  dodge_target:  number | null; // defender 閃避 value (null if no dodge attempted)
  dodge_roll:    number | null;
  dodged:        boolean;       // defender avoided the hit
  damage:        number;        // HP damage to apply (0 if miss/dodge)
  target_hp_after?: number;     // filled in by the route after applying
  target_died?:  boolean;       // filled in by the route after applying
}

/**
 * Resolve a contested attack. Rolls the attacker's 射擊/搏鬥/STR to hit. A hit
 * that isn't a crit lets the defender roll 閃避 — at HALF value against firearms
 * (harder to dodge a bullet); a crit can't be dodged. Melee damage adds the
 * STR+SIZ damage bonus; firearms never do. Any landed hit deals ≥1. The route
 * applies the damage to the target's HP and fills target_hp_after/died.
 */
export function resolveAttack(
  attacker: CheckCharacter,
  defenderDodgeValue: number,
  type: AttackType,
  targetName: string,
  isNpc: boolean,
): AttackResult {
  const attack_target = attackSkillValue(type, attacker);
  const attack_roll = rollD100();
  const attack_outcome = decideOutcome(attack_roll, attack_target);
  const hit = attack_outcome === "success" || attack_outcome === "critical_success";
  const crit = attack_outcome === "critical_success";
  const isRanged = type === "ranged";

  let dodge_target: number | null = null;
  let dodge_roll: number | null = null;
  let dodged = false;
  let damage = 0;

  if (hit) {
    if (crit) {
      damage = rollBaseAttackDamage(type, true); // critical hits cannot be dodged
    } else {
      // Firearms can still be evaded by diving for cover, but 閃避 is HALVED —
      // a fired gun is far harder to dodge than a swung fist.
      dodge_target = Math.min(99, isRanged ? Math.floor(defenderDodgeValue / 2) : defenderDodgeValue);
      dodge_roll = rollD100();
      const dodgeOutcome = decideOutcome(dodge_roll, dodge_target);
      dodged = dodgeOutcome === "success" || dodgeOutcome === "critical_success";
      if (!dodged) damage = rollBaseAttackDamage(type, false);
    }
    if (damage > 0) {
      // Damage bonus is muscle-driven: melee only, never firearms.
      if (!isRanged) damage += rollDamageBonus(attacker.str, attacker.siz);
      damage = Math.max(1, damage); // a hit that connects always costs ≥1 HP
    }
  }

  return {
    type,
    skill_label: type === "ranged" ? "射擊" : type === "fighting" ? "搏鬥" : "力量",
    target_name: targetName,
    is_npc: isNpc,
    attack_target,
    attack_roll,
    attack_outcome,
    hit,
    crit,
    dodge_target,
    dodge_roll,
    dodged,
    damage,
  };
}


// ─── Conservative fuzzy NPC-name matching (attack targeting) ─────────────────
// Deterministic, no LLM. Only ever ranks a room's KNOWN living NPCs, and the
// caller gates it behind a confirmed attack verb — so the surface is tiny. Edit
// distance tolerance is fixed at ≤1 (single-char typos / homophones only). Every
// accepted match must clear a score floor AND clearly beat the runner-up, so an
// ambiguous input never silently targets the wrong NPC.

/** True iff Levenshtein(a, b) ≤ 1. Fast two-pointer, no full DP matrix. */
export function withinEditDistance1(a: string, b: string): boolean {
  if (a === b) return true;
  let sa = a, sb = b;
  if (sa.length > sb.length) { const t = sa; sa = sb; sb = t; } // sa = shorter
  if (sb.length - sa.length > 1) return false;
  let i = 0, j = 0;
  let diffUsed = false;
  while (i < sa.length && j < sb.length) {
    if (sa[i] === sb[j]) { i++; j++; continue; }
    if (diffUsed) return false;
    diffUsed = true;
    if (sa.length === sb.length) { i++; j++; } // substitution
    else { j++; }                              // deletion from the longer string
  }
  return true; // at most one unmatched trailing char remains → distance ≤ 1
}

/** Distinctive Latin word-tokens of a name (length ≥ 4), lower-cased. */
function latinNameSegments(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
}

/** Score how strongly an action text refers to one NPC name. 0 = no match. */
function scoreNpcNameMatch(actionLower: string, name: string): number {
  const n = name.trim().toLowerCase();
  if (!n) return 0;

  // Tier 1 — full name appears verbatim (case-insensitive).
  if (n.length >= 2 && actionLower.includes(n)) return 1000 + n.length;

  let best = 0;

  // Tier 2 — a distinctive Latin word-segment appears (e.g. surname alone).
  for (const seg of latinNameSegments(name)) {
    if (actionLower.includes(seg)) best = Math.max(best, 100 + seg.length);
  }

  // Tier 3 — single-char typo / homophone (distance ≤ 1).
  //   Latin: compare word tokens of comparable length.
  const latinUnits = [n.replace(/[^a-z0-9]/g, ""), ...latinNameSegments(name)].filter((u) => u.length >= 4);
  if (latinUnits.length) {
    const tokens = actionLower.split(/[^a-z0-9]+/).filter(Boolean);
    for (const unit of latinUnits) {
      for (const tok of tokens) {
        if (Math.abs(tok.length - unit.length) <= 1 && withinEditDistance1(tok, unit)) {
          best = Math.max(best, 50);
        }
      }
    }
  }
  //   CJK: slide a window (name length ±1) over Han runs of the action.
  const cjk = name.replace(/[^㐀-鿿]/g, "");
  if (cjk.length >= 2) {
    const runs = actionLower.match(/[㐀-鿿]+/g) ?? [];
    for (const run of runs) {
      for (const wl of [cjk.length, cjk.length - 1, cjk.length + 1]) {
        if (wl < 2) continue;
        for (let i = 0; i + wl <= run.length; i++) {
          if (withinEditDistance1(run.slice(i, i + wl), cjk)) { best = Math.max(best, 50); break; }
        }
      }
    }
  }

  return best;
}

/**
 * Resolve which known NPC an attack action refers to, tolerating single-char
 * typos and distinctive partial/nickname mentions. Returns null when nothing
 * clears the floor OR when the top two candidates are too close to call (so an
 * ambiguous input never guesses). Candidates should already be filtered to
 * LIVING NPCs by the caller.
 */
export function resolveFuzzyNpcTarget(actionText: string, candidateNames: string[]): string | null {
  const action = actionText.trim().toLowerCase();
  if (!action || candidateNames.length === 0) return null;

  const MIN_SCORE = 50;
  const scored = candidateNames
    .map((name) => ({ name, score: scoreNpcNameMatch(action, name) }))
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  const [best, second] = scored;
  // Ambiguity guard: the winner must clearly beat the runner-up.
  if (second && best.score < second.score * 2) return null;
  return best.name;
}

/** First-aid heal amount — tied to the 急救 skill check outcome. */
export function rollFirstAidHeal(outcome: Outcome): number {
  if (outcome === "critical_success") return rollDiceN(1, 3) + 1;
  if (outcome === "success") return rollDiceN(1, 3);
  return 0;
}

// ─── SAN check system ────────────────────────────────────────────────────────
// When a character witnesses horror, supernatural, gore, or incomprehensible
// truths, roll d100 <= POW. Success limits SAN loss; failure inflicts more.

interface SanTier {
  severity:    SanSeverity;
  label:       string;
  keywords:    string[];
  successLoss: () => number;
  failLoss:    () => number;
}

// Ordered from most severe to least so the strongest match wins.
const SAN_TIERS: SanTier[] = [
  {
    severity: "final", label: "終局級恐怖",
    keywords: [
      "舊日支配者", "舊神", "克蘇魯", "外神", "神明降臨", "神祇現身",
      "宇宙的真相", "世界的盡頭", "終焉", "湮滅",
    ],
    successLoss: () => rollDiceN(1, 10),
    failLoss:    () => rollDiceN(1, 20),
  },
  {
    severity: "core", label: "核心真相／邪神",
    keywords: [
      "邪神", "儀式", "不可理解", "真相", "異界", "觸手", "祭品", "獻祭",
      "古老的存在", "禁忌知識", "瘋狂的真相", "扭曲的維度",
    ],
    successLoss: () => rollDiceN(1, 3),
    failLoss:    () => rollDiceN(1, 10),
  },
  {
    severity: "strong", label: "強烈恐怖",
    keywords: [
      "血腥", "殘骸", "分屍", "腐爛", "幻覺", "黑白無常", "厲鬼", "怨靈",
      "支離破碎", "內臟", "斷肢", "精神衝擊", "扭曲的臉", "尖叫",
    ],
    successLoss: () => 1,
    failLoss:    () => rollDiceN(1, 6),
  },
  {
    severity: "obvious", label: "明顯鬼異",
    keywords: [
      "鬼", "幽靈", "鬼魂", "屍體", "亡魂", "童鬼", "死屍", "遺體",
      "靈異", "超自然", "鬼影", "陰魂",
    ],
    successLoss: () => 0,
    failLoss:    () => 1,
  },
];

function matchSanTier(text: string): { tier: SanTier; keyword: string } | null {
  const t = text.toLowerCase();
  for (const tier of SAN_TIERS) {
    const hit = tier.keywords.find((kw) => t.includes(kw));
    if (hit) return { tier, keyword: hit };
  }
  return null;
}

// Runs a SAN check if horror content is detected in the given text.
export function resolveSanCheck(text: string, char: CheckCharacter): SanCheckResult | null {
  const matched = matchSanTier(text);
  if (!matched) return null;
  const { tier, keyword } = matched;

  const pow     = char.pow;
  const roll    = rollD100();
  const success = roll <= pow;
  const rawLoss = success ? tier.successLoss() : tier.failLoss();
  const san_loss = Math.min(rawLoss, char.san); // never below 0

  return {
    severity:       tier.severity,
    severity_label: tier.label,
    trigger_text:   keyword,
    pow,
    roll,
    success,
    san_loss,
  };
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

/** Look up a skill rule by its stored key (e.g. "spot_hidden") — used when the
 *  player explicitly picks a skill instead of relying on keyword detection. */
function skillRuleByKey(key: string): SkillRule | null {
  return SKILL_RULES.find((r) => r.skillKey === key) ?? null;
}

/** Player-facing skill list (key + display name + category) for the picker UI. */
export const PLAYER_SKILL_LIST: { key: string; zh: string; category: Category }[] =
  SKILL_RULES.map((r) => ({ key: r.skillKey, zh: r.displayName, category: r.category }));

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
  if (roll >= 95) return "critical_failure";
  if (roll <= 5)  return "critical_success";
  if (roll <= target) return "success";
  return "failure";
}

// ─── Result descriptions ─────────────────────────────────────────────────────
// Plain-language hint of WHAT the check meant, shown in the dice box so players
// understand the outcome before the GM's full narration loads. Purely rule-based
// (no AI), keyed by the kind of action so "success" reads as "found something"
// for investigation but "convinced them" for a social roll, etc.

type ResultKind =
  | "investigate" | "social" | "evade" | "manipulate" | "heal"
  | "force" | "physical" | "sanity" | "luck" | "generic";

const SKILL_RESULT_KIND: Record<string, ResultKind> = {
  spot_hidden: "investigate", listen: "investigate",
  library_use: "investigate", psychology: "investigate",
  persuade: "social", fast_talk: "social", charm: "social", intimidate: "social",
  dodge: "evade", stealth: "evade",
  first_aid: "heal",
  lockpick: "manipulate", drive_auto: "manipulate",
  firearms: "force", occult: "investigate", fighting: "force",
};

const STAT_RESULT_KIND: Record<StatKey, ResultKind> = {
  str: "force", con: "physical", dex: "evade", pow: "sanity",
  app: "social", int: "investigate", edu: "investigate", luck: "luck",
};

const RESULT_HINTS: Record<ResultKind, Record<Outcome, string>> = {
  investigate: {
    critical_success: "大成功 — 發現了關鍵線索，看到比預期更多的細節。",
    success:          "成功 — 找到了有用的線索。",
    failure:          "失敗 — 仔細查探，但一無所獲。",
    critical_failure: "大失敗 — 被假象誤導，得出了錯誤的判斷。",
  },
  social: {
    critical_success: "大成功 — 對方完全被打動，超乎預期地配合。",
    success:          "成功 — 達到了想要的效果。",
    failure:          "失敗 — 沒能打動對方，毫無進展。",
    critical_failure: "大失敗 — 適得其反，反而激怒了對方。",
  },
  evade: {
    critical_success: "大成功 — 身手俐落，完美避開。",
    success:          "成功 — 及時避開了危險。",
    failure:          "失敗 — 未能及時反應，但未受傷。",
    critical_failure: "大失敗 — 嚴重失誤，陷入更糟的處境（生命 −4）。",
  },
  manipulate: {
    critical_success: "大成功 — 乾淨俐落地辦到了。",
    success:          "成功 — 順利完成。",
    failure:          "失敗 — 嘗試失敗，沒有進展。",
    critical_failure: "大失敗 — 弄巧成拙，造成了麻煩（生命 −4）。",
  },
  heal: {
    critical_success: "大成功 — 處理得當，傷勢明顯好轉。",
    success:          "成功 — 止住了血，穩定了傷勢。",
    failure:          "失敗 — 手忙腳亂，沒能處理好傷口。",
    critical_failure: "大失敗 — 處理失當，情況更糟了。",
  },
  force: {
    critical_success: "大成功 — 一擊命中，力道完美。",
    success:          "成功 — 成功施力。",
    failure:          "失敗 — 用力落空，未能奏效。",
    critical_failure: "大失敗 — 嚴重失誤，後果慘重（生命 −4）。",
  },
  physical: {
    critical_success: "大成功 — 動作完美，超乎預期。",
    success:          "成功 — 順利完成。",
    failure:          "失敗 — 行動受挫，但未受傷。",
    critical_failure: "大失敗 — 嚴重失誤，後果慘重（生命 −4）。",
  },
  sanity: {
    critical_success: "大成功 — 心神穩固，毫不動搖。",
    success:          "成功 — 穩住了心神。",
    failure:          "失敗 — 恐懼侵蝕心神（理智 −2）。",
    critical_failure: "大失敗 — 心神瀕臨崩潰（理智 −4）。",
  },
  luck: {
    critical_success: "大成功 — 運氣好得驚人。",
    success:          "成功 — 運氣站在這一邊。",
    failure:          "失敗 — 運氣不站在這邊。",
    critical_failure: "大失敗 — 運氣徹底用盡，雪上加霜（生命 −4）。",
  },
  generic: {
    critical_success: "大成功 — 超乎預期的完美結果。",
    success:          "成功。",
    failure:          "失敗 — 行動受挫，但未受傷。",
    critical_failure: "大失敗 — 嚴重失誤，後果慘重（生命 −4）。",
  },
};

function describeResult(kind: ResultKind, outcome: Outcome): string {
  return (RESULT_HINTS[kind] ?? RESULT_HINTS.generic)[outcome];
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

// `sceneContext` lets horror in the surrounding scene (e.g. recent GM narration)
// also trigger a SAN check, not just the player's own action wording.
export function resolveAction(
  actionText: string,
  char: CheckCharacter,
  sceneContext = "",
  forcedSkill?: string | null,
): RollResult {
  // SAN check runs independently and STACKS on top of any action check.
  // SAN check is a SEPARATE roll. Its loss lives ONLY in `san_check` (not folded
  // into san_change) so the UI can show it as its own dice box. The route applies
  // both san_change (action) and san_check.san_loss to the character.
  const sanCheck = resolveSanCheck(`${actionText}\n${sceneContext}`, char);

  // 1. Try skill-first match. A player-chosen skill overrides keyword detection.
  const skillRule = (forcedSkill ? skillRuleByKey(forcedSkill) : null) ?? matchSkill(actionText);
  if (skillRule) {
    const target  = skillTarget(skillRule, char);
    const roll    = rollD100();
    const outcome = decideOutcome(roll, target);
    const cons    = consequences(skillRule.category, outcome);
    const kind    = SKILL_RESULT_KIND[skillRule.skillKey] ?? "generic";
    return {
      requires_check: true,
      stat_used:  skillRule.displayName,
      target, d100_roll: roll, outcome,
      hp_change:  Math.max(cons.hp,  -char.hp),
      san_change: Math.max(cons.san, -char.san),
      consequence_summary: describeResult(kind, outcome),
      san_check: sanCheck,
    };
  }

  // 2. Fallback to raw stat
  const statRule = matchStat(actionText);
  if (statRule) {
    const target  = Math.min(99, char[statRule.stat as keyof CheckCharacter] as number);
    const roll    = rollD100();
    const outcome = decideOutcome(roll, target);
    const cons    = consequences(statRule.category, outcome);
    const kind    = STAT_RESULT_KIND[statRule.stat] ?? "generic";
    return {
      requires_check: true,
      stat_used:  statRule.stat.toUpperCase(),
      target, d100_roll: roll, outcome,
      hp_change:  Math.max(cons.hp,  -char.hp),
      san_change: Math.max(cons.san, -char.san),
      consequence_summary: describeResult(kind, outcome),
      san_check: sanCheck,
    };
  }

  // 3. No action check — but a SAN check alone may still apply (only the SAN box).
  if (sanCheck) {
    return {
      requires_check: true,
      stat_used: null, target: null, d100_roll: null, outcome: null,
      hp_change: 0, san_change: 0,
      consequence_summary: `面對${sanCheck.severity_label}。`,
      san_check: sanCheck,
    };
  }

  // 4. No check needed
  return {
    requires_check: false,
    stat_used: null, target: null, d100_roll: null, outcome: null,
    hp_change: 0, san_change: 0,
    consequence_summary: "No dice check required.",
    san_check: null,
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
