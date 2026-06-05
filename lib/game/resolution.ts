// Rule-based action resolution. The SYSTEM decides outcomes via dice + stats;
// the AI GM only narrates the resolved result.

import type { SkillPoints } from "@/lib/cards/dice";

export type StatKey = "str" | "con" | "dex" | "app" | "int" | "pow" | "edu" | "luck";
export type Category = "physical" | "mental" | "social" | "luck" | "sanity";
export type Outcome =
  | "critical_success"
  | "success"
  | "partial_success"
  | "failure"
  | "critical_failure";

export interface RollResult {
  requires_check:       boolean;
  stat_used:            StatKey | null;
  stat_value:           number | null;
  modifier:             number | null;
  skill_bonus:          number | null;
  d20_roll:             number | null;
  dc:                   number | null;
  total:                number | null;
  outcome:              Outcome | null;
  hp_change:            number;
  san_change:           number;
  consequence_summary:  string;
}

export interface CheckCharacter {
  hp: number; san: number; mp: number;
  str: number; con: number; siz: number; dex: number; app: number;
  int: number; pow: number; edu: number; luck: number;
  skills?: SkillPoints | null;
}

interface StatRule {
  stat: StatKey;
  category: Category;
  baseDc: number;
  keywords: string[];
}

const STAT_RULES: StatRule[] = [
  { stat: "str", category: "physical", baseDc: 14, keywords: [
    "attack", "fight", "strike", "hit", "punch", "smash", "break", "force", "pry",
    "push", "lift", "bash", "swing", "slam", "kill", "slay", "stab", "shoot",
    "tackle", "wrestle", "tear", "rip",
  ]},
  { stat: "con", category: "physical", baseDc: 12, keywords: [
    "endure", "withstand", "tough out", "hold on", "stay conscious", "ignore the pain",
    "survive the", "outlast", "steel my body", "resist the poison", "resist the disease",
  ]},
  { stat: "dex", category: "physical", baseDc: 12, keywords: [
    "dodge", "sneak", "climb", "run", "escape", "flee", "jump", "evade", "slip",
    "dash", "sprint", "duck", "tumble", "leap", "crawl", "hide", "chase",
    "intercept", "react", "catch", "lockpick", "pick the lock", "open the lock",
    "drive", "steer", "move quietly",
  ]},
  { stat: "app", category: "social", baseDc: 12, keywords: [
    "persuade", "convince", "lie", "deceive", "intimidate", "threaten", "negotiate",
    "bargain", "comfort", "charm", "seduce", "plead", "bluff", "reassure",
    "impress", "flatter",
  ]},
  { stat: "int", category: "mental", baseDc: 12, keywords: [
    "investigate", "inspect", "analyze", "solve", "decipher", "study", "figure out",
    "search", "understand", "examine", "decode", "translate", "deduce",
    "spot", "notice", "observe",
  ]},
  { stat: "pow", category: "sanity", baseDc: 13, keywords: [
    "resist the horror", "withstand the fear", "steel my mind", "calm mind",
    "endure the darkness", "face the horror", "fight the fear", "keep sane",
    "hold sanity", "resist insanity",
  ]},
  { stat: "edu", category: "mental", baseDc: 11, keywords: [
    "recall", "remember", "identify", "recognize", "know about", "expertise",
    "diagnose", "research", "library", "archives", "look it up",
    "first aid", "heal", "bandage", "treat the wound",
  ]},
  { stat: "luck", category: "luck", baseDc: 13, keywords: [
    "gamble", "bet", "guess", "random", "by chance", "pray", "hope", "take a risk",
  ]},
];

const HARDER_WORDS = [
  "heavily", "massive", "huge", "ancient", "reinforced", "powerful",
  "deadly", "impossible", "armored", "fortified",
];

function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

// Stats are on a 15–90 scale (×5 system); center at 50.
export function statModifier(stat: number): number {
  return Math.floor((stat - 50) / 10);
}

function classify(text: string): { stat: StatKey; category: Category; dc: number } | null {
  const t = text.toLowerCase();
  let best: { rule: StatRule; score: number } | null = null;
  for (const rule of STAT_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (t.includes(kw)) score++;
    }
    if (score > 0 && (!best || score > best.score)) best = { rule, score };
  }
  if (!best) return null;
  let dc = best.rule.baseDc;
  if (HARDER_WORDS.some((w) => t.includes(w))) dc = Math.min(25, dc + 4);
  return { stat: best.rule.stat, category: best.rule.category, dc };
}

// Skill bonus: every 25 points in a skill = +1 to the d20 roll, max +4.
function skillBonus(v: number): number {
  if (v <= 0) return 0;
  return Math.min(4, Math.floor(v / 25));
}

function getSkillBonus(actionText: string, stat: StatKey, skills: SkillPoints): number {
  const t = actionText.toLowerCase();
  const s = skills;
  let best = 0;

  if (stat === "dex") {
    if (t.includes("dodge") || t.includes("evade") || t.includes("duck"))
      best = Math.max(best, skillBonus(s.dodge ?? 0));
    if (t.includes("sneak") || t.includes("hide") || t.includes("crawl") || t.includes("quietly"))
      best = Math.max(best, skillBonus(s.stealth ?? 0));
    if (t.includes("drive") || t.includes("steer"))
      best = Math.max(best, skillBonus(s.drive_auto ?? 0));
    if (t.includes("lock") || t.includes("lockpick"))
      best = Math.max(best, skillBonus(s.lockpick ?? 0));
  } else if (stat === "app") {
    if (t.includes("persuade") || t.includes("convince") || t.includes("negotiate"))
      best = Math.max(best, skillBonus(s.persuade ?? 0));
    if (t.includes("charm") || t.includes("seduce") || t.includes("flatter"))
      best = Math.max(best, skillBonus(s.charm ?? 0));
    if (t.includes("bluff") || t.includes("lie") || t.includes("deceive"))
      best = Math.max(best, skillBonus(s.fast_talk ?? 0));
    if (t.includes("intimidate") || t.includes("threaten") || t.includes("scare"))
      best = Math.max(best, skillBonus(s.intimidate ?? 0));
    // social default: take highest social skill
    best = Math.max(best,
      skillBonus(s.persuade ?? 0),
      skillBonus(s.charm ?? 0),
      skillBonus(s.fast_talk ?? 0),
      skillBonus(s.intimidate ?? 0));
  } else if (stat === "int") {
    if (t.includes("search") || t.includes("spot") || t.includes("investigate") ||
        t.includes("inspect") || t.includes("examine") || t.includes("notice"))
      best = Math.max(best, skillBonus(s.spot_hidden ?? 0));
    if (t.includes("psychology") || t.includes("sense motive") || t.includes("read the person"))
      best = Math.max(best, skillBonus(s.psychology ?? 0));
    if (t.includes("library") || t.includes("research") || t.includes("look it up"))
      best = Math.max(best, skillBonus(s.library_use ?? 0));
    best = Math.max(best, skillBonus(s.spot_hidden ?? 0));
  } else if (stat === "edu") {
    if (t.includes("library") || t.includes("research") || t.includes("archives"))
      best = Math.max(best, skillBonus(s.library_use ?? 0));
    if (t.includes("heal") || t.includes("bandage") || t.includes("treat") || t.includes("first aid"))
      best = Math.max(best, skillBonus(s.first_aid ?? 0));
    best = Math.max(best, skillBonus(s.library_use ?? 0), skillBonus(s.first_aid ?? 0));
  }

  return best;
}

function decideOutcome(d20: number, total: number, dc: number): Outcome {
  if (d20 === 20) return "critical_success";
  if (d20 === 1)  return "critical_failure";
  if (total >= dc + 8) return "critical_success";
  if (total >= dc)     return "success";
  if (total >= dc - 4) return "partial_success";
  return "failure";
}

function consequences(
  category: Category,
  outcome: Outcome,
): { hp: number; san: number; flavor: string } {
  const mental = category === "sanity";
  switch (outcome) {
    case "critical_success":
      return { hp: 0, san: 0, flavor: "A flawless result — momentum is yours." };
    case "success":
      return { hp: 0, san: 0, flavor: "The action succeeds." };
    case "partial_success":
      return mental
        ? { hp: 0, san: -1, flavor: "Achieved, but the strain frays the mind (SAN −1)." }
        : { hp: -1, san: 0, flavor: "Achieved, but at a cost (HP −1)." };
    case "failure":
      return mental
        ? { hp: 0, san: -2, flavor: failFlavor(category) + " (SAN −2)." }
        : { hp: -2, san: 0,  flavor: failFlavor(category) + " (HP −2)." };
    case "critical_failure":
      return mental
        ? { hp: 0, san: -3, flavor: "Disaster — the mind nearly shatters (SAN −3)." }
        : { hp: -4, san: 0,  flavor: "Disaster — a grievous setback (HP −4)." };
  }
}

function failFlavor(category: Category): string {
  switch (category) {
    case "physical": return "The attempt fails and danger strikes back";
    case "mental":   return "The clue is misread and the moment is wasted";
    case "social":   return "The words fall flat and trust erodes";
    case "luck":     return "Luck abandons the attempt";
    case "sanity":   return "Dread floods in";
  }
}

export function resolveAction(actionText: string, char: CheckCharacter): RollResult {
  const classified = classify(actionText);
  if (!classified) {
    return {
      requires_check: false,
      stat_used: null, stat_value: null, modifier: null, skill_bonus: null,
      d20_roll: null, dc: null, total: null, outcome: null,
      hp_change: 0, san_change: 0,
      consequence_summary: "No dice check required.",
    };
  }

  const { stat, category, dc } = classified;
  const statValue = char[stat as keyof CheckCharacter] as number;
  const modifier   = statModifier(statValue);
  const skillBon   = getSkillBonus(actionText, stat, char.skills ?? {});
  const d20        = rollD20();
  const total      = d20 + modifier + skillBon;
  const outcome    = decideOutcome(d20, total, dc);
  const cons       = consequences(category, outcome);

  const hp_change  = Math.max(cons.hp, -char.hp);
  const san_change = Math.max(cons.san, -char.san);

  return {
    requires_check: true,
    stat_used: stat,
    stat_value: statValue,
    modifier,
    skill_bonus: skillBon,
    d20_roll: d20,
    dc,
    total,
    outcome,
    hp_change,
    san_change,
    consequence_summary: cons.flavor,
  };
}

export function outcomeLabel(outcome: Outcome): string {
  return {
    critical_success: "Critical Success",
    success:          "Success",
    partial_success:  "Partial Success",
    failure:          "Failure",
    critical_failure: "Critical Failure",
  }[outcome];
}
