// The free starter investigator every new account receives.
//
// Purpose: a brand-new player must be able to press "play" immediately. The
// daily draw is capped at 3/UTC-day, so without this a new sign-up could land
// on an empty roster and have nothing to do.
//
// Design: deliberately AVERAGE, never better than a lucky draw. Every stat is
// 50 (the mean of the 3d6×5 curve), giving total_stats 450 → Common rarity, so
// the gacha keeps its value. The skills are a competent generalist spread that
// covers the core gameplay loop — investigate, listen, talk, dodge, patch
// yourself up — so a first session actually works, rather than a character who
// fails every roll and concludes the game is broken.

import type { SkillPoints } from "@/lib/cards/dice";

/** Fixed value used for every base attribute (the mean of 3d6×5). */
export const STARTER_STAT = 50;

/**
 * Starter skills. Values are FULL values (base + allocation), matching how
 * character_cards.skills is stored everywhere else.
 *
 * Reference bases for an all-50 card (lib/game/skills.ts): 偵查 10, 聆聽 10,
 * 圖書館使用 10, 心理學 1, 說服 5, 閃避 25 (DEX/2), 急救 1, 潛行 1,
 * 搏鬥 25, 神秘學 5. So this is a real but modest investment — roughly the
 * shape of a starting CoC investigator, well short of what a good roll plus
 * full point allocation can reach.
 */
export const STARTER_SKILLS: SkillPoints = {
  spot_hidden: 50,  // 偵查 — the single most-used skill in play
  listen:      40,  // 聆聽
  library_use: 40,  // 圖書館使用
  psychology:  30,  // 心理學
  persuade:    30,  // 說服
  dodge:       30,  // 閃避 — survivability
  first_aid:   30,  // 急救
  stealth:     25,  // 潛行
  fighting:    25,  // 搏鬥 — at base; this is not a combat build
  occult:      10,  // 神秘學 — a toe in the mythos door
};

/** Player-facing default name. Everyone starts with the same one, so the
 *  rename route (/api/characters/[id]/rename) matters — the UI points at it. */
export const STARTER_NAME = "無名調查員";

/** Occupation drives the portrait art on the card; 大學生 is the classic
 *  everyman entry point and already has an icon in /public. */
export const STARTER_OCCUPATION = "大學生";

/** The exact row inserted into character_cards for a new account.
 *  `user_id` is added by the caller from the authenticated session. */
export function buildStarterCard() {
  const s = STARTER_STAT;
  return {
    name: STARTER_NAME,
    str: s, con: s, siz: s, dex: s, app: s,
    int: s, pow: s, edu: s, luck: s,
    // Derived exactly as lib/cards/dice.ts derives them, so the starter obeys
    // the same rules as a rolled card.
    hp: Math.floor((s + s) / 10), // (CON+SIZ)/10 = 10
    san: s,                        // = POW
    mp: Math.floor(s / 5),         // POW/5 = 10
    total_stats: s * 9,            // 450 → Common
    rarity: "Common" as const,
    skills: STARTER_SKILLS,
    // Skills are pre-chosen, so the allocation UI must not prompt for them.
    skills_allocated: true,
    occupation: STARTER_OCCUPATION,
    // No dice were rolled — the reveal UI already treats this as nullable.
    roll_details: null,
  };
}
