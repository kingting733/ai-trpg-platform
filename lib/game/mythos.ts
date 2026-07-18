// Mythos Skills v1 — 克蘇魯神話法術（禁咒）. Pure rules, no I/O.
//
// CoC Mythos-magic-flavored spells: every cast costs 1d4 SAN + 3 MP (paid even
// on failure), succeeds on 30 + 克蘇魯知識 (card stat, clamped 0–40 ⇒ ceiling
// 70%), and NEVER grows — spell keys live in `character_cards.mythos_skills`,
// a namespace deliberately disjoint from `skills`/SKILL_CATALOGUE so the
// ending-growth route and interlude missions are structurally blind to them.
// Design: docs/design/mythos-skills-v1.md.

export type MythosEffectKind = "damage" | "calm" | "reveal";

export interface MythosSpell {
  key: string;
  zh: string;
  /** What a successful cast does, mechanically (server-applied). */
  effect: MythosEffectKind;
  /** Whether the cast needs an NPC target resolved BEFORE any cost is paid. */
  needsTarget: boolean;
  /** Player-facing one-line description (shown in the picker). */
  desc: string;
}

export const MYTHOS_SPELLS: MythosSpell[] = [
  { key: "shrivelling", zh: "萎縮術", effect: "damage", needsTarget: true,
    desc: "凋萎之力灼穿血肉——對一名目標造成傷害。" },
  { key: "elder_sign", zh: "遠古印記", effect: "calm", needsTarget: true,
    desc: "遠古的封印之紋——連言語無法觸及之物也將退避。" },
  { key: "contact_dead", zh: "死者絮語", effect: "reveal", needsTarget: false,
    desc: "向死者低語叩問——換取一則此地的真相。" },
];

export function mythosSpellByKey(key: string | null | undefined): MythosSpell | null {
  if (!key) return null;
  return MYTHOS_SPELLS.find((s) => s.key === key) ?? null;
}

export const MYTHOS_ZH_BY_KEY: Record<string, string> =
  Object.fromEntries(MYTHOS_SPELLS.map((s) => [s.key, s.zh]));

export const MYTHOS_KEY_BY_ZH: Record<string, string> =
  Object.fromEntries(MYTHOS_SPELLS.map((s) => [s.zh, s.key]));

const CAST_VERB_RE = /(施展|施放|發動|使用|吟唱|唸出|念出|唸誦|念誦|詠唱|唱誦)/;
// Negated intent (「不要使用萎縮術」「不敢施展」) must NOT cast.
const CAST_NEGATION_RE = /(不|別|莫|勿|沒|未)(要|敢|能|可|想|會|再)?\s*(施展|施放|發動|使用|吟唱|唸|念|詠唱|唱誦)/;

/**
 * Deterministic free-text cast detection. The picker sends the key directly,
 * but players also legitimately TYPE the spell (「對屍鬼施展萎縮術」) or a
 * tagged form (「[萎縮術] 對準它」). Without this, a typed cast would fall
 * through to plain narration — no cost, no server effect — and the GM would
 * narrate magic that mechanically never happened ("server decides" violated).
 *
 * Conservative on purpose (repo rule: prefer declining over guessing): fires
 * only when the actor OWNS the spell AND the text (a) pairs its zh name with a
 * cast verb, (b) IS essentially just the name, or (c) leads with a [名] tag.
 * A mere mention (「我想起萎縮術，但不敢用」) has a verb... so note: (a) also
 * requires the verb — a no-verb mention never casts; a verbed sentence is
 * accepted as intent, matching how players actually phrase casts.
 */
export function detectMythosCastIntent(
  actionText: string,
  ownedKeys: string[] | null | undefined,
): string | null {
  if (!actionText || !Array.isArray(ownedKeys) || ownedKeys.length === 0) return null;
  const text = actionText.trim();
  for (const key of ownedKeys) {
    const zh = MYTHOS_ZH_BY_KEY[key];
    if (!zh || !text.includes(zh)) continue;
    const bare = text.replace(/[\s。！？!?，,、~～]/g, "");
    if (
      (CAST_VERB_RE.test(text) && !CAST_NEGATION_RE.test(text)) ||
      bare === zh ||
      text.startsWith(`[${zh}]`) ||
      text.startsWith(`【${zh}】`)
    ) {
      return key;
    }
  }
  return null;
}

/** Every cast burns this much 魔力. No MP → the cast is blocked outright. */
export const MYTHOS_MP_COST = 3;

/** 克蘇魯知識 ceiling — success rate tops out at 30 + 40 = 70%. */
export const KNOWLEDGE_CAP = 40;

/** Success chance: base 30 + 克蘇魯知識 (clamped 0..KNOWLEDGE_CAP). */
export function mythosSuccessRate(knowledge: number | null | undefined): number {
  const k = typeof knowledge === "number" ? knowledge : 0;
  return 30 + Math.min(KNOWLEDGE_CAP, Math.max(0, k));
}

export type MythosOutcome = "critical_success" | "success" | "failure" | "fumble";

export type MythosCastResult =
  | { ok: false; reason: "no_mp" }
  | {
      ok: true;
      outcome: MythosOutcome;
      /** d100 vs target (= mythosSuccessRate). */
      roll: number;
      target: number;
      mpCost: number;
      /** The 1d4 cast price — paid on every attempt, success or not. */
      sanCost: number;
      /** Fumble backlash: extra 1d6 SAN. 0 otherwise. */
      extraSan: number;
      /** sanCost + extraSan, clamped so SAN never goes below 0. */
      sanLoss: number;
    };

/**
 * Resolve one cast. Costs are decided here but APPLIED by the caller (route).
 * rng draws, in order: d4 SAN cost → d100 → (fumble only) d6 extra SAN.
 * Low SAN never blocks a cast — SAN is the price, MP is the fuel.
 */
export function resolveMythosCast(
  spell: MythosSpell,
  char: { mp: number; san: number; cthulhu_knowledge?: number | null },
  rng: () => number = Math.random,
): MythosCastResult {
  if ((char.mp ?? 0) < MYTHOS_MP_COST) return { ok: false, reason: "no_mp" };

  const d = (sides: number) => Math.min(sides, Math.floor(rng() * sides) + 1);
  const sanCost = d(4);
  const target = mythosSuccessRate(char.cthulhu_knowledge);
  const roll = d(100);

  let outcome: MythosOutcome;
  if (roll >= 96) outcome = "fumble";
  else if (roll <= 5) outcome = "critical_success";
  else if (roll <= target) outcome = "success";
  else outcome = "failure";

  const extraSan = outcome === "fumble" ? d(6) : 0;
  const sanLoss = Math.min(char.san, sanCost + extraSan);
  return { ok: true, outcome, roll, target, mpCost: MYTHOS_MP_COST, sanCost, extraSan, sanLoss };
}

/** Damage of a successful 萎縮術: 2d6, +6 on a critical success (no dodge —
 *  the flesh itself is the battlefield). */
export function rollShrivellingDamage(outcome: MythosOutcome, rng: () => number = Math.random): number {
  if (outcome !== "success" && outcome !== "critical_success") return 0;
  const d6 = () => Math.min(6, Math.floor(rng() * 6) + 1);
  return d6() + d6() + (outcome === "critical_success" ? 6 : 0);
}
