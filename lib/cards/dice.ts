export type Rarity = "Common" | "Rare" | "Epic" | "Legendary";

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
}

/** Roll `count` dice each with `sides` faces and sum the results. */
function rollDice(count: number, sides: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += Math.floor(Math.random() * sides) + 1;
  }
  return sum;
}

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

/** Roll a brand-new character card per the MVP dice rules. */
export function rollCharacterCard(): RolledCard {
  const hp = 20 + rollDice(1, 10);
  const san = 20 + rollDice(1, 10);
  const str = rollDice(3, 6);
  const agi = rollDice(3, 6);
  const int = rollDice(3, 6);
  const cha = rollDice(3, 6);
  const luck = rollDice(3, 6);
  const speed = rollDice(3, 6);

  const total_stats = str + agi + int + cha + luck + speed;

  return {
    name: generateName(),
    hp, san, str, agi, int, cha, luck, speed,
    total_stats,
    rarity: rarityForTotal(total_stats),
  };
}
