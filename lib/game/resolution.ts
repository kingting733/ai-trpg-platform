// Rule-based action resolution. The SYSTEM decides outcomes via dice + stats;
// the AI GM only narrates the resolved result.

export type StatKey = "str" | "agi" | "int" | "cha" | "luck" | "speed" | "san";
export type Category = "physical" | "mental" | "social" | "luck" | "sanity";
export type Outcome =
  | "critical_success"
  | "success"
  | "partial_success"
  | "failure"
  | "critical_failure";

export interface RollResult {
  requires_check: boolean;
  stat_used: StatKey | null;
  stat_value: number | null;
  modifier: number | null;
  d20_roll: number | null;
  dc: number | null;
  total: number | null;
  outcome: Outcome | null;
  hp_change: number;
  san_change: number;
  consequence_summary: string;
}

export interface CheckCharacter {
  hp: number; san: number;
  str: number; agi: number; int: number; cha: number; luck: number; speed: number;
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
    "push", "lift", "bash", "swing", "slam", "kill", "slay", "stab", "shoot", "tackle", "wrestle",
  ] },
  { stat: "agi", category: "physical", baseDc: 12, keywords: [
    "dodge", "sneak", "climb", "run", "escape", "flee", "jump", "evade", "slip",
    "dash", "sprint", "duck", "tumble", "leap", "crawl", "hide",
  ] },
  { stat: "speed", category: "physical", baseDc: 12, keywords: [
    "chase", "intercept", "interrupt", "react", "catch", "outrun", "rush", "grab first",
  ] },
  { stat: "int", category: "mental", baseDc: 12, keywords: [
    "investigate", "inspect", "analyze", "solve", "decipher", "study", "figure out",
    "search", "understand", "examine the", "decode", "unlock the puzzle", "translate",
  ] },
  { stat: "cha", category: "social", baseDc: 12, keywords: [
    "persuade", "convince", "lie", "deceive", "intimidate", "threaten", "negotiate",
    "bargain", "comfort", "charm", "seduce", "plead", "bluff", "reassure",
  ] },
  { stat: "luck", category: "luck", baseDc: 13, keywords: [
    "gamble", "bet", "guess", "random", "by chance", "pray", "hope", "take a risk",
  ] },
  { stat: "san", category: "sanity", baseDc: 13, keywords: [
    "resist", "withstand", "steel", "calm mind", "endure", "face the horror",
    "fight the fear", "keep sane", "hold sanity",
  ] },
];

// Words that push the difficulty up a tier.
const HARDER_WORDS = ["heavily", "massive", "huge", "ancient", "reinforced", "powerful", "deadly", "impossible"];

function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

export function statModifier(stat: number): number {
  return Math.floor((stat - 10) / 2);
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

function decideOutcome(d20: number, total: number, dc: number): Outcome {
  if (d20 === 20) return "critical_success";
  if (d20 === 1) return "critical_failure";
  if (total >= dc + 8) return "critical_success";
  if (total >= dc) return "success";
  if (total >= dc - 4) return "partial_success";
  return "failure";
}

function consequences(category: Category, outcome: Outcome): { hp: number; san: number; flavor: string } {
  const mental = category === "sanity";
  switch (outcome) {
    case "critical_success":
      return { hp: 0, san: 0, flavor: "A flawless result — momentum is yours." };
    case "success":
      return { hp: 0, san: 0, flavor: "The action succeeds." };
    case "partial_success":
      return mental
        ? { hp: 0, san: -1, flavor: "Achieved, but the strain frays the mind (SAN -1)." }
        : { hp: -1, san: 0, flavor: "Achieved, but at a cost (HP -1)." };
    case "failure":
      return mental
        ? { hp: 0, san: -2, flavor: failFlavor(category) + " (SAN -2)." }
        : { hp: -2, san: 0, flavor: failFlavor(category) + " (HP -2)." };
    case "critical_failure":
      return mental
        ? { hp: 0, san: -3, flavor: "Disaster — the mind nearly shatters (SAN -3)." }
        : { hp: -4, san: 0, flavor: "Disaster — a grievous setback (HP -4)." };
  }
}

function failFlavor(category: Category): string {
  switch (category) {
    case "physical": return "The attempt fails and danger strikes back";
    case "mental": return "The clue is misread and the moment is wasted";
    case "social": return "The words fall flat and trust erodes";
    case "luck": return "Luck abandons the attempt";
    case "sanity": return "Dread floods in";
  }
}

/** Resolve an action against a character. Returns a full roll result. */
export function resolveAction(actionText: string, char: CheckCharacter): RollResult {
  const classified = classify(actionText);
  if (!classified) {
    return {
      requires_check: false,
      stat_used: null, stat_value: null, modifier: null,
      d20_roll: null, dc: null, total: null, outcome: null,
      hp_change: 0, san_change: 0,
      consequence_summary: "No dice check required.",
    };
  }

  const { stat, category, dc } = classified;
  const statValue = stat === "san" ? char.san : char[stat];
  const modifier = statModifier(statValue);
  const d20 = rollD20();
  const total = d20 + modifier;
  const outcome = decideOutcome(d20, total, dc);
  const cons = consequences(category, outcome);

  // Clamp so changes never push a stat below 0.
  const hp_change = Math.max(cons.hp, -char.hp);
  const san_change = Math.max(cons.san, -char.san);

  return {
    requires_check: true,
    stat_used: stat,
    stat_value: statValue,
    modifier,
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
    success: "Success",
    partial_success: "Partial Success",
    failure: "Failure",
    critical_failure: "Critical Failure",
  }[outcome];
}
