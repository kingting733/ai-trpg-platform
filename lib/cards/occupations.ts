// Occupation system. Each newly rolled card is assigned ONE random occupation,
// which grants exactly two +10 starting-skill buffs. The buffs are baked into
// the card's `skills` JSON at creation time (see lib/cards/dice.ts) and therefore
// flow naturally into the in-game character and the dice-resolution engine.
//
// Occupation only affects STARTING skill values — nothing else.

import type { SkillKey } from "./dice";

export interface Occupation {
  name: string;              // Chinese display name
  buffs: [SkillKey, SkillKey]; // exactly two skills, each +10 to its base
}

export const OCCUPATION_BUFF = 10;

export const OCCUPATIONS: Occupation[] = [
  { name: "記者",       buffs: ["library_use", "fast_talk"] },
  { name: "警探",       buffs: ["spot_hidden", "psychology"] },
  { name: "大學生",     buffs: ["library_use", "spot_hidden"] },
  { name: "醫生",       buffs: ["first_aid", "psychology"] },
  { name: "黑幫成員",   buffs: ["intimidate", "fighting"] },
  { name: "風水師",     buffs: ["occult", "psychology"] },
  { name: "退役軍人",   buffs: ["firearms", "dodge"] },
  { name: "YouTuber",   buffs: ["charm", "fast_talk"] },
  { name: "前邪教成員", buffs: ["occult", "stealth"] },
  { name: "賭徒",       buffs: ["fast_talk", "psychology"] },
  { name: "走私司機",   buffs: ["drive_auto", "stealth"] },
];

export function randomOccupation(): Occupation {
  return OCCUPATIONS[Math.floor(Math.random() * OCCUPATIONS.length)];
}

export const OCCUPATION_BY_NAME: Record<string, Occupation> =
  Object.fromEntries(OCCUPATIONS.map((o) => [o.name, o]));
