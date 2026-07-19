"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rarityForTotal = rarityForTotal;
exports.rollCharacterCard = rollCharacterCard;
const skills_1 = require("@/lib/game/skills");
const occupations_1 = require("./occupations");
function rollDice(count, sides) {
    const rolls = [];
    for (let i = 0; i < count; i++)
        rolls.push(Math.floor(Math.random() * sides) + 1);
    return rolls;
}
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
function rarityForTotal(totalStats) {
    if (totalStats >= 650)
        return "Legendary";
    if (totalStats >= 570)
        return "Epic";
    if (totalStats >= 470)
        return "Rare";
    return "Common";
}
const NAME_PREFIXES = [
    "Wanderer", "Agent", "Seeker", "Drifter", "Sentinel",
    "Nomad", "Ranger", "Warden", "Scout", "Pilgrim",
];
function generateName() {
    const prefix = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)];
    const num = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${num}`;
}
function rollCharacterCard() {
    // 3d6×5 stats
    const strDice = rollDice(3, 6);
    const conDice = rollDice(3, 6);
    const dexDice = rollDice(3, 6);
    const appDice = rollDice(3, 6);
    const powDice = rollDice(3, 6);
    const luckDice = rollDice(3, 6);
    // (2d6+6)×5 stats
    const sizDice = rollDice(2, 6);
    const intDice = rollDice(2, 6);
    const eduDice = rollDice(2, 6);
    const str = sum(strDice) * 5;
    const con = sum(conDice) * 5;
    const siz = (sum(sizDice) + 6) * 5;
    const dex = sum(dexDice) * 5;
    const app = sum(appDice) * 5;
    const int = (sum(intDice) + 6) * 5;
    const pow = sum(powDice) * 5;
    const edu = (sum(eduDice) + 6) * 5;
    const luck = sum(luckDice) * 5;
    const hp = Math.floor((con + siz) / 10);
    const san = pow;
    const mp = Math.floor(pow / 5);
    const total_stats = str + con + siz + dex + app + int + pow + edu + luck;
    const skill_points = edu * 2 + int * 2;
    const roll_details = {
        str: { dice: strDice },
        con: { dice: conDice },
        siz: { base: 6, dice: sizDice },
        dex: { dice: dexDice },
        app: { dice: appDice },
        int: { base: 6, dice: intDice },
        pow: { dice: powDice },
        edu: { base: 6, dice: eduDice },
        luck: { dice: luckDice },
    };
    // Assign a random occupation and bake its two +10 starting-skill buffs into
    // `skills` so they apply in-game even if the player never opens the allocator.
    const occupation = (0, occupations_1.randomOccupation)();
    const skills = {};
    for (const key of occupation.buffs) {
        const meta = skills_1.SKILL_CATALOGUE.find((s) => s.key === key);
        const base = meta ? (0, skills_1.skillBase)(meta.base, { dex, app }) : 0;
        skills[key] = base + occupations_1.OCCUPATION_BUFF;
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
