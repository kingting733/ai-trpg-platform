export type Rarity = "Common" | "Rare" | "Epic" | "Legendary";

/** Per-stat breakdown of the individual dice that produced each stat. */
export interface RollDetails {
  hp: { base: number; dice: number[] };    // base 20 + 1d10
  san: { base: number; dice: number[] };   // base 20 + 1d10
  str: { dice: number[] };                  // 3d6
  agi: { dice: number[] };
  int: { dice: number[] };
  cha: { dice: number[] };
  luck: { dice: number[] };
  speed: { dice: number[] };
}

export interface RolledCard {
  name: string;
  hp: number;
  san: number;
  str: number;
  agi: number;
  int: number;
  cha: number;
  luck: number;
  speed: number;
  total_stats: number;
  rarity: Rarity;
  roll_details: RollDetails;
}

/** Roll `count` dice each with `sides` faces, returning the individual results. */
function rollDice(count: number, sides: number): number[] {
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }
  return rolls;
}

const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

export function rarityForTotal(totalStats: number): Rarity {
  if (totalStats >= 86) return "Legendary";
  if (totalStats >= 71) return "Epic";
  if (totalStats >= 56) return "Rare";
  return "Common";
}

const NAME_PREFIXES = [
  "Wanderer", "Agent", "Seeker", "Drifter", "Sentinel",
  "Nomad", "Ranger", "Warden", "Scout", "Pilgrim",
];

function generateName(): string {
  const prefix = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)];
  const num = Math.floor(1000 + Math.random() * 9000); // 1000–9999
  return `${prefix}-${num}`;
}

/** Roll a brand-new character card per the MVP dice rules, capturing dice detail. */
export function rollCharacterCard(): RolledCard {
  const hpDie = rollDice(1, 10);
  const sanDie = rollDice(1, 10);
  const strDice = rollDice(3, 6);
  const agiDice = rollDice(3, 6);
  const intDice = rollDice(3, 6);
  const chaDice = rollDice(3, 6);
  const luckDice = rollDice(3, 6);
  const speedDice = rollDice(3, 6);

  const hp = 20 + sum(hpDie);
  const san = 20 + sum(sanDie);
  const str = sum(strDice);
  const agi = sum(agiDice);
  const int = sum(intDice);
  const cha = sum(chaDice);
  const luck = sum(luckDice);
  const speed = sum(speedDice);

  const total_stats = str + agi + int + cha + luck + speed;

  const roll_details: RollDetails = {
    hp: { base: 20, dice: hpDie },
    san: { base: 20, dice: sanDie },
    str: { dice: strDice },
    agi: { dice: agiDice },
    int: { dice: intDice },
    cha: { dice: chaDice },
    luck: { dice: luckDice },
    speed: { dice: speedDice },
  };

  return {
    name: generateName(),
    hp, san, str, agi, int, cha, luck, speed,
    total_stats,
    rarity: rarityForTotal(total_stats),
    roll_details,
  };
}
