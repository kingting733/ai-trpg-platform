// Rule-based action resolution — CoC d100 roll-under system.
// The SYSTEM decides outcomes via dice + skills/stats; the AI GM only narrates.

import type { SkillPoints } from "@/lib/cards/dice";

export type StatKey = "str" | "con" | "dex" | "app" | "int" | "pow" | "edu" | "luck";
export type Category = "physical" | "mental" | "social" | "luck" | "sanity";
export type Outcome = "critical_success" | "success" | "failure" | "critical_failure";

export interface RollResult {
  requires_check:      boolean;
  stat_used:           StatKey | null;
  target:              number | null;  // roll-under value (skill or raw stat)
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

interface StatRule {
  stat: StatKey;
  category: Category;
  keywords: string[];
}

const STAT_RULES: StatRule[] = [
  { stat: "str", category: "physical", keywords: [
    "attack", "fight", "strike", "hit", "punch", "smash", "break", "force", "pry",
    "push", "lift", "bash", "swing", "slam", "kill", "slay", "stab", "shoot",
    "tackle", "wrestle", "tear", "rip",
  ]},
  { stat: "con", category: "physical", keywords: [
    "endure", "withstand", "tough out", "hold on", "stay conscious", "ignore the pain",
    "survive the", "outlast", "steel my body", "resist the poison", "resist the disease",
  ]},
  { stat: "dex", category: "physical", keywords: [
    "dodge", "sneak", "climb", "run", "escape", "flee", "jump", "evade", "slip",
    "dash", "sprint", "duck", "tumble", "leap", "crawl", "hide", "chase",
    "intercept", "react", "catch", "lockpick", "pick the lock", "open the lock",
    "drive", "steer", "move quietly",
  ]},
  { stat: "app", category: "social", keywords: [
    "persuade", "convince", "lie", "deceive", "intimidate", "threaten", "negotiate",
    "bargain", "comfort", "charm", "seduce", "plead", "bluff", "reassure",
    "impress", "flatter",
  ]},
  { stat: "int", category: "mental", keywords: [
    "investigate", "inspect", "analyze", "solve", "decipher", "study", "figure out",
    "search", "understand", "examine", "decode", "translate", "deduce",
    "spot", "notice", "observe",
  ]},
  { stat: "pow", category: "sanity", keywords: [
    "resist the horror", "withstand the fear", "steel my mind", "calm mind",
    "endure the darkness", "face the horror", "fight the fear", "keep sane",
    "hold sanity", "resist insanity",
  ]},
  { stat: "edu", category: "mental", keywords: [
    "recall", "remember", "identify", "recognize", "know about", "expertise",
    "diagnose", "research", "library", "archives", "look it up",
    "first aid", "heal", "bandage", "treat the wound",
  ]},
  { stat: "luck", category: "luck", keywords: [
    "gamble", "bet", "guess", "random", "by chance", "pray", "hope", "take a risk",
  ]},
];

function rollD100(): number {
  return Math.floor(Math.random() * 100) + 1;
}

function classify(text: string): { stat: StatKey; category: Category } | null {
  const t = text.toLowerCase();
  let best: { rule: StatRule; score: number } | null = null;
  for (const rule of STAT_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (t.includes(kw)) score++;
    }
    if (score > 0 && (!best || score > best.score)) best = { rule, score };
  }
  return best ? { stat: best.rule.stat, category: best.rule.category } : null;
}

// Returns the roll-under target: named skill value (base + allocated) when
// applicable, otherwise the raw stat value. Capped at 99.
function getTarget(actionText: string, stat: StatKey, char: CheckCharacter): number {
  const t  = char[stat as keyof CheckCharacter] as number;
  const s  = char.skills ?? {};
  const tx = actionText.toLowerCase();
  const dex = char.dex ?? 50;

  const candidate = (() => {
    switch (stat) {
      case "dex":
        if (tx.includes("dodge") || tx.includes("evade") || tx.includes("duck"))
          return Math.floor(dex / 2) + (s.dodge ?? 0);
        if (tx.includes("sneak") || tx.includes("hide") || tx.includes("stealth") || tx.includes("quietly"))
          return 20 + (s.stealth ?? 0);
        if (tx.includes("drive") || tx.includes("steer"))
          return 20 + (s.drive_auto ?? 0);
        if (tx.includes("lock") || tx.includes("lockpick") || tx.includes("pick the lock"))
          return 1 + (s.lockpick ?? 0);
        return null;

      case "app":
        if (tx.includes("intimidate") || tx.includes("threaten") || tx.includes("scare"))
          return 15 + (s.intimidate ?? 0);
        if (tx.includes("charm") || tx.includes("seduce") || tx.includes("flatter"))
          return 15 + (s.charm ?? 0);
        if (tx.includes("bluff") || tx.includes("lie") || tx.includes("deceive"))
          return 5 + (s.fast_talk ?? 0);
        return 25 + (s.persuade ?? 0); // default social

      case "int":
        if (tx.includes("library") || tx.includes("research") || tx.includes("archives"))
          return 20 + (s.library_use ?? 0);
        if (tx.includes("psychology") || tx.includes("read the person") || tx.includes("sense motive"))
          return 10 + (s.psychology ?? 0);
        return 25 + (s.spot_hidden ?? 0); // default investigation

      case "edu":
        if (tx.includes("heal") || tx.includes("bandage") || tx.includes("treat") || tx.includes("first aid"))
          return 30 + (s.first_aid ?? 0);
        return 20 + (s.library_use ?? 0);

      default:
        return null; // str, con, pow, luck → use raw stat
    }
  })();

  return Math.min(99, candidate ?? t);
}

// d100 roll-under: roll ≤ target/5 → crit success, roll ≤ target → success,
// roll ≥ 96 → crit failure (always, regardless of skill), else → failure.
function decideOutcome(roll: number, target: number): Outcome {
  if (roll >= 96)                          return "critical_failure";
  if (roll <= Math.floor(target / 5))     return "critical_success";
  if (roll <= target)                      return "success";
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
    case "failure":
      return mental
        ? { hp: 0, san: -2, flavor: failFlavor(category) + " (SAN −2)." }
        : { hp: -2, san: 0,  flavor: failFlavor(category) + " (HP −2)." };
    case "critical_failure":
      return mental
        ? { hp: 0, san: -4, flavor: "Disaster — the mind nearly shatters (SAN −4)." }
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
      stat_used: null, target: null, d100_roll: null, outcome: null,
      hp_change: 0, san_change: 0,
      consequence_summary: "No dice check required.",
    };
  }

  const { stat, category } = classified;
  const target   = getTarget(actionText, stat, char);
  const roll     = rollD100();
  const outcome  = decideOutcome(roll, target);
  const cons     = consequences(category, outcome);

  return {
    requires_check: true,
    stat_used:  stat,
    target,
    d100_roll:  roll,
    outcome,
    hp_change:  Math.max(cons.hp,  -char.hp),
    san_change: Math.max(cons.san, -char.san),
    consequence_summary: cons.flavor,
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
