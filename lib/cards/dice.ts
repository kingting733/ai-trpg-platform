import { skillBase, SKILL_CATALOGUE } from "@/lib/game/skills";
import { randomOccupation, OCCUPATION_BUFF } from "./occupations";

export type Rarity = "Common" | "Rare" | "Epic" | "Legendary";

export type SkillKey =
  | "spot_hidden" | "listen" | "library_use" | "psychology"
  | "persuade" | "fast_talk" | "charm" | "intimidate"
  | "dodge" | "first_aid" | "stealth" | "lockpick" | "drive_auto"
  | "firearms" | "occult" | "fighting";

export type SkillPoints = Partial<Record<SkillKey, number>>;

export interface RollDetails {
  str:  { dice: number[] };
  con:  { dice: number[] };
  siz:  { base: number; dice: number[] };
  dex:  { dice: number[] };
  app:  { dice: number[] };
  int:  { base: number; dice: number[] };
  pow:  { dice: number[] };
  edu:  { base: number; dice: number[] };
  luck: { dice: number[] };
}

export interface RolledCard {
  name:        string;
  str:         number;  // 3d6×5 — 力量
  con:         number;  // 3d6×5 — 體質
  siz:         number;  // (2d6+6)×5 — 體型
  dex:         number;  // 3d6×5 — 敏捷 (turn order)
  app:         number;  // 3d6×5 — 外貌
  int:         number;  // (2d6+6)×5 — 智力
  pow:         number;  // 3d6×5 — 意志
  edu:         number;  // (2d6+6)×5 — 教育
  luck:        number;  // 3d6×5 — 幸運
  hp:          number;  // (CON+SIZ)÷10
  san:         number;  // = POW (starting sanity)
  mp:          number;  // POW÷5
  total_stats: number;  // sum of 9 base stats (rarity gate)
  rarity:      Rarity;
  roll_details: RollDetails;
  skill_points: number; // EDU×2 + INT×2 — pool to allocate to skills
  skills:      SkillPoints; // pre-seeded with the occupation's two +10 buffs
  occupation:  string;      // random occupation; grants the seeded skill buffs
}

function rollDice(count: number, sides: number): number[] {
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(Math.floor(Math.random() * sides) + 1);
  return rolls;
}

const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

export function rarityForTotal(totalStats: number): Rarity {
  if (totalStats >= 650) return "Legendary";
  if (totalStats >= 570) return "Epic";
  if (totalStats >= 470) return "Rare";
  return "Common";
}

const NAME_PREFIXES = [
  "Wanderer", "Agent", "Seeker", "Drifter", "Sentinel",
  "Nomad", "Ranger", "Warden", "Scout", "Pilgrim",
];

function generateName(): string {
  const prefix = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${num}`;
}

export function rollCharacterCard(): RolledCard {
  // 3d6×5 stats
  const strDice  = rollDice(3, 6);
  const conDice  = rollDice(3, 6);
  const dexDice  = rollDice(3, 6);
  const appDice  = rollDice(3, 6);
  const powDice  = rollDice(3, 6);
  const luckDice = rollDice(3, 6);
  // (2d6+6)×5 stats
  const sizDice  = rollDice(2, 6);
  const intDice  = rollDice(2, 6);
  const eduDice  = rollDice(2, 6);

  const str  = sum(strDice) * 5;
  const con  = sum(conDice) * 5;
  const siz  = (sum(sizDice) + 6) * 5;
  const dex  = sum(dexDice) * 5;
  const app  = sum(appDice) * 5;
  const int  = (sum(intDice) + 6) * 5;
  const pow  = sum(powDice) * 5;
  const edu  = (sum(eduDice) + 6) * 5;
  const luck = sum(luckDice) * 5;

  const hp          = Math.floor((con + siz) / 10);
  const san         = pow;
  const mp          = Math.floor(pow / 5);
  const total_stats = str + con + siz + dex + app + int + pow + edu + luck;
  const skill_points = edu * 2 + int * 2;

  const roll_details: RollDetails = {
    str:  { dice: strDice },
    con:  { dice: conDice },
    siz:  { base: 6, dice: sizDice },
    dex:  { dice: dexDice },
    app:  { dice: appDice },
    int:  { base: 6, dice: intDice },
    pow:  { dice: powDice },
    edu:  { base: 6, dice: eduDice },
    luck: { dice: luckDice },
  };

  // Assign a random occupation and bake its two +10 starting-skill buffs into
  // `skills` so they apply in-game even if the player never opens the allocator.
  const occupation = randomOccupation();
  const skills: SkillPoints = {};
  for (const key of occupation.buffs) {
    const meta = SKILL_CATALOGUE.find((s) => s.key === key);
    const base = meta ? skillBase(meta.base, { dex, app }) : 0;
    skills[key] = base + OCCUPATION_BUFF;
  }

  return {
    name: generateName(),
    str, con, siz, dex, app, int, pow, edu, luck,
    hp, san, mp,
    total_stats,
    rarity: rarityForTotal(total_stats),
    roll_details,
    skill_points,
    skills,
    occupation: occupation.name,
  };
}
