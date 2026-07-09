// 幕間任務 / Interlude Missions — pure rules (no I/O).
//
// A card goes on a 24h off-screen mission. Success rate and points are
// snapshotted at DISPATCH from the card's skills (later growth never changes an
// in-flight mission). The claim route rolls the outcome ONCE and stores it.
// Success → full points + one growth check (+1 skill, max 2 interlude growths
// per card per week). Fail → 10% of points (rounded up), no growth. No fatigue,
// nothing permanent is ever lost.

import { currentSkillValue, SKILL_ZH_BY_KEY, SKILL_CAP } from "@/lib/game/skills";

export interface InterludeMission {
  key: string;
  name: string;           // zh-TW display name
  desc: string;           // one-line player-facing flavor
  /** Skill keys that count; the card's BEST of these drives rate/points/growth. */
  skills: string[];
  emoji: string;
}

export const INTERLUDE_MISSIONS: InterludeMission[] = [
  {
    key: "night_patrol",
    name: "巡樓值夜",
    desc: "整夜留意大廈裡的動靜，眼明耳靈的人收穫最多。",
    skills: ["spot_hidden", "listen"],
    emoji: "🌙",
  },
  {
    key: "case_research",
    name: "資料整理",
    desc: "埋首舊檔案與剪報之間，把零碎線索整理成冊。",
    skills: ["library_use", "occult"],
    emoji: "📚",
  },
  {
    key: "rumor_gathering",
    name: "街坊打探",
    desc: "在茶餐廳與街市之間攀談，聽街坊們不經意說漏的事。",
    skills: ["persuade", "fast_talk", "psychology"],
    emoji: "🗣",
  },
  {
    key: "physical_training",
    name: "體能訓練",
    desc: "跑步、對打、攀爬——把身體鍛鍊到隨時能應付意外。",
    skills: ["fighting", "dodge", "stealth"],
    emoji: "🥊",
  },
];

export function missionByKey(key: string): InterludeMission | null {
  return INTERLUDE_MISSIONS.find((m) => m.key === key) ?? null;
}

/** Mission duration. Overridable via env for playtesting (dev only). */
export function missionDurationMs(): number {
  const override = Number(process.env.INTERLUDE_DURATION_MS);
  return Number.isFinite(override) && override > 0 ? override : 24 * 60 * 60 * 1000;
}

export interface CardSkillsLike {
  skills: Record<string, number> | null;
  dex?: number | null;
  app?: number | null;
}

/** The card's best relevant skill for a mission: { key, value }. */
export function bestRelevantSkill(card: CardSkillsLike, mission: InterludeMission): { key: string; value: number } {
  const attrs = { dex: card.dex ?? 50, app: card.app ?? 50 };
  let best = { key: mission.skills[0], value: -1 };
  for (const key of mission.skills) {
    const value = currentSkillValue(key, card.skills, attrs);
    if (value > best.value) best = { key, value };
  }
  return best;
}

/** Success rate %, clamped 30–90: even a bad fit can succeed; nobody is safe. */
export function successRate(bestSkill: number): number {
  return Math.max(30, Math.min(90, Math.round(bestSkill)));
}

/** Full points on success = 100 × (skill / 50), clamped 40–300. */
export function pointsFor(bestSkill: number): number {
  return Math.max(40, Math.min(300, Math.round((bestSkill / 50) * 100)));
}

/** Points paid on a FAILED mission: 10% of the full reward, rounded up. */
export function failPoints(fullPoints: number): number {
  return Math.ceil(fullPoints * 0.1);
}

/** Max interlude growth gains per card per rolling 7 days. */
export const INTERLUDE_WEEKLY_GROWTH_CAP = 2;

/** Interlude growth: CoC experience check, but the gain is a flat +1 (real
 *  games keep the bigger 1d10 — interludes must stay strictly weaker). */
export function interludeGrowth(
  skillKey: string,
  oldValue: number,
  d100: number
): { skill: string; skillName: string; d100: number; old: number; gain: number; new: number } {
  const improved = d100 > oldValue && oldValue < SKILL_CAP;
  const gain = improved ? 1 : 0;
  return {
    skill: skillKey,
    skillName: SKILL_ZH_BY_KEY[skillKey] ?? skillKey,
    d100,
    old: oldValue,
    gain,
    new: Math.min(SKILL_CAP, oldValue + gain),
  };
}

/** Template narrations used when the AI call fails — a claim must never come
 *  back storyless. Keyed by mission, success/fail variants. */
export function fallbackNarration(mission: InterludeMission, characterName: string, success: boolean): string {
  const ok: Record<string, string> = {
    night_patrol: `${characterName}值了一整夜的班。走廊的燈閃過幾次，${characterName}把每一次聲響都記進了筆記。天亮時，一切平安。`,
    case_research: `${characterName}在檔案堆裡熬了一夜，指尖沾滿灰塵，總算把散落的線索整理出眉目。`,
    rumor_gathering: `${characterName}在茶餐廳坐了一下午，幾杯奶茶下肚，街坊的閒話裡漏出了些有意思的東西。`,
    physical_training: `${characterName}練到汗流浹背，收拳的那一刻，覺得身體比昨天更聽使喚了。`,
  };
  const bad: Record<string, string> = {
    night_patrol: `${characterName}值夜到半途，在後樓梯打了個盹。醒來時什麼也沒記住，只有頸子痠痛。`,
    case_research: `${characterName}對著檔案坐到深夜，字都糊成一片，最後只整理出一疊沒有用的剪報。`,
    rumor_gathering: `${characterName}搭話搭得太急，街坊們笑而不語，一下午只換來幾句天氣話。`,
    physical_training: `${characterName}訓練時拉傷了點筋，早早收工。休息一晚就沒事，但今天算是白練了。`,
  };
  return (success ? ok : bad)[mission.key] ?? `${characterName}完成了${mission.name}，${success ? "頗有收穫。" : "但收穫寥寥。"}`;
}
