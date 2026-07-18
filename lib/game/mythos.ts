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
