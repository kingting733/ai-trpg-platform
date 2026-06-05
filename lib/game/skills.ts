// Single source of truth for the named-skill catalogue: skill key, Chinese
// display name, and base-value rule. Mirrors lib/game/resolution.ts SKILL_RULES
// and app/api/characters/[id]/skills/route.ts SKILL_BASES.

export type SkillBaseSpec = number | "dex2" | "app2" | "inv_app";

export interface SkillMeta {
  key: string;
  zh: string;        // display name (matches roll_result.stat_used for skills)
  base: SkillBaseSpec;
}

export const SKILL_CATALOGUE: SkillMeta[] = [
  { key: "spot_hidden", zh: "偵查",       base: 10 },
  { key: "listen",      zh: "聆聽",       base: 10 },
  { key: "library_use", zh: "圖書館使用", base: 10 },
  { key: "psychology",  zh: "心理學",     base: 1 },
  { key: "persuade",    zh: "說服",       base: 5 },
  { key: "fast_talk",   zh: "話術",       base: 5 },
  { key: "charm",       zh: "魅惑",       base: "app2" },
  { key: "intimidate",  zh: "恐嚇",       base: "inv_app" },
  { key: "dodge",       zh: "閃避",       base: "dex2" },
  { key: "first_aid",   zh: "急救",       base: 1 },
  { key: "stealth",     zh: "潛行",       base: 1 },
  { key: "lockpick",    zh: "開鎖",       base: 1 },
  { key: "drive_auto",  zh: "駕駛汽車",   base: 0 },
];

export const SKILL_KEY_BY_ZH: Record<string, string> =
  Object.fromEntries(SKILL_CATALOGUE.map((s) => [s.zh, s.key]));

export const SKILL_ZH_BY_KEY: Record<string, string> =
  Object.fromEntries(SKILL_CATALOGUE.map((s) => [s.key, s.zh]));

/** Highest a skill can reach via growth (CoC convention). */
export const SKILL_CAP = 99;

/** Resolve a skill's base value for a given card's attributes. */
export function skillBase(
  spec: SkillBaseSpec,
  attrs: { dex?: number; app?: number },
): number {
  const dex = attrs.dex ?? 50;
  const app = attrs.app ?? 50;
  if (spec === "dex2") return Math.floor(dex / 2);
  if (spec === "app2") return Math.floor(app / 2);
  if (spec === "inv_app") return Math.floor((100 - app) / 5);
  return spec;
}

/** Current full value of a skill on a card (stored value, or computed base). */
export function currentSkillValue(
  key: string,
  skills: Record<string, number> | null | undefined,
  attrs: { dex?: number; app?: number },
): number {
  const stored = skills?.[key];
  if (typeof stored === "number") return stored;
  const meta = SKILL_CATALOGUE.find((s) => s.key === key);
  return meta ? skillBase(meta.base, attrs) : 0;
}
