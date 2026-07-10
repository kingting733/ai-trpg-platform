// 舊神祈願 / Old God Prayer — meta item system (pure rules, no I/O).
//
// Players burn 調查點 to pray; the Old Gods answer with a PERMANENT item that
// can be equipped to one character card (one slot). MVP effects touch ONLY the
// interlude mission numbers (success rate / points / failure floor / growth
// roll) — never main-game dice. 禁物 (epic) items are dormant placeholders:
// owned and collectible now, effects awaken in a future version.
//
// No pity, no fragments, no duplicates: a prayer always grants an item the
// player does NOT own (rarity is rolled, then an unowned item of that rarity
// is picked; an exhausted rarity spills to the nearest rarity that still has
// unowned items). When the player owns everything, the altar refuses.

export type ItemRarity = "common" | "rare" | "epic" | "legendary";

export type ItemEffect =
  /** +N percentage points to interlude success rate (optionally one mission only). */
  | { type: "mission_success_rate_bonus"; mission?: string; value: number }
  /** Multiply interlude points (success AND the failure share derives from it). */
  | { type: "mission_points_bonus"; mission?: string; value: number } // value = multiplier, e.g. 1.10
  /** Raise the failed-mission payout share above the base 10%. */
  | { type: "failure_points_floor_bonus"; value: number }             // value = new floor, e.g. 0.15
  /** +N to the growth-check d100 roll. */
  | { type: "interlude_growth_bonus"; value: number }
  /** 禁物 placeholder — no effect yet（效果尚未覺醒）. */
  | { type: "dormant" };

export interface ItemDef {
  id: string;
  name: string;
  rarity: ItemRarity;
  /** Player-facing flavor line. */
  flavor: string;
  effect: ItemEffect;
}

export const RARITY_ZH: Record<ItemRarity, string> = {
  common: "殘物",
  rare: "遺物",
  epic: "禁物",
  legendary: "舊神契約",
};

/** Cost of one prayer, in 調查點. Deliberately high (≈2–3 successful missions)
 *  to slow meta-progression. */
export const PRAY_COST = 300;

export const ITEM_POOL: ItemDef[] = [
  // ── Common / 殘物 — one per mission, +3% success rate ──
  { id: "old_flashlight", name: "舊手電筒", rarity: "common",
    flavor: "光圈裡總有一角照不亮。它以前的主人也發現了。",
    effect: { type: "mission_success_rate_bonus", mission: "night_patrol", value: 3 } },
  { id: "yellowed_clipping", name: "發黃剪報", rarity: "common",
    flavor: "某段被全城遺忘的舊聞，邊角用鉛筆圈了三次。",
    effect: { type: "mission_success_rate_bonus", mission: "case_research", value: 3 } },
  { id: "red_string_half", name: "半截紅繩", rarity: "common",
    flavor: "另一半在誰手上，最好不要知道。",
    effect: { type: "mission_success_rate_bonus", mission: "physical_training", value: 3 } },
  { id: "old_cassette", name: "舊錄音帶", rarity: "common",
    flavor: "B面錄著半段對話，說話的人聽起來像在笑。",
    effect: { type: "mission_success_rate_bonus", mission: "rumor_gathering", value: 3 } },

  // ── Rare / 遺物 ──
  { id: "black_thread_compass", name: "黑線羅盤", rarity: "rare",
    flavor: "指針不指北，指向大廈裡最安靜的那一層。",
    effect: { type: "mission_success_rate_bonus", mission: "night_patrol", value: 5 } },
  { id: "moldy_roster", name: "發霉住戶名冊", rarity: "rare",
    flavor: "每一頁都有人搬走，每一頁都有人沒搬走。",
    effect: { type: "mission_points_bonus", mission: "case_research", value: 1.10 } },
  { id: "night_shift_pass", name: "夜班證件", rarity: "rare",
    flavor: "相片模糊得剛剛好，誰戴上都像本人。",
    effect: { type: "mission_success_rate_bonus", mission: "rumor_gathering", value: 5 } },
  { id: "cracked_bell", name: "破裂銅鈴", rarity: "rare",
    flavor: "已經不會響了。但有些東西還是會聽見。",
    effect: { type: "failure_points_floor_bonus", value: 0.15 } },

  // ── Epic / 禁物 — dormant placeholders (效果尚未覺醒) ──
  { id: "blood_reading", name: "血痕解讀", rarity: "epic",
    flavor: "禁術。讀懂乾涸血跡排列的那一刻，它也在讀你。（效果尚未覺醒）",
    effect: { type: "dormant" } },
  { id: "door_crack_peek", name: "門縫窺視", rarity: "epic",
    flavor: "禁術。從門縫望進去三秒以內是安全的，大概。（效果尚未覺醒）",
    effect: { type: "dormant" } },
  { id: "omen_smelling", name: "聞兆", rarity: "epic",
    flavor: "禁術。壞事發生之前，空氣會先變甜。（效果尚未覺醒）",
    effect: { type: "dormant" } },

  // ── Legendary / 舊神契約 ──
  { id: "floor14_nameplate", name: "第十四層的名牌", rarity: "legendary",
    flavor: "這棟樓沒有十四層。名牌卻擦得很新。",
    effect: { type: "failure_points_floor_bonus", value: 0.25 } },
  { id: "nameless_contract", name: "無名住戶契約", rarity: "legendary",
    flavor: "簽名欄是空的，但租金每月照付，從未遲過。",
    effect: { type: "mission_points_bonus", value: 1.05 } },
  { id: "old_god_seal", name: "門背後的舊神印", rarity: "legendary",
    flavor: "印在門背，向內。不是防止什麼進來，是防止什麼出去。",
    effect: { type: "interlude_growth_bonus", value: 5 } },
];

export function itemById(id: string | null | undefined): ItemDef | null {
  if (!id) return null;
  return ITEM_POOL.find((i) => i.id === id) ?? null;
}

/** Rarity odds: common 60% / rare 30% / epic 8% / legendary 2%. */
const RARITY_TABLE: { rarity: ItemRarity; upTo: number }[] = [
  { rarity: "common", upTo: 0.6 },
  { rarity: "rare", upTo: 0.9 },
  { rarity: "epic", upTo: 0.98 },
  { rarity: "legendary", upTo: 1.0 },
];

export function rollRarity(rng: () => number = Math.random): ItemRarity {
  const x = rng();
  for (const row of RARITY_TABLE) if (x < row.upTo) return row.rarity;
  return "legendary";
}

/** Spill order when the rolled rarity has no unowned items left: prefer the
 *  next rarity DOWN (cheaper consolation), then up. */
const SPILL: Record<ItemRarity, ItemRarity[]> = {
  common: ["common", "rare", "epic", "legendary"],
  rare: ["rare", "common", "epic", "legendary"],
  epic: ["epic", "rare", "common", "legendary"],
  legendary: ["legendary", "epic", "rare", "common"],
};

/** Pick the prayer's reward: an item the player does NOT own, of the rolled
 *  rarity (or the nearest rarity with anything left). Null = owns everything. */
export function pickPrayReward(ownedIds: Set<string>, rng: () => number = Math.random): ItemDef | null {
  const rolled = rollRarity(rng);
  for (const rarity of SPILL[rolled]) {
    const candidates = ITEM_POOL.filter((i) => i.rarity === rarity && !ownedIds.has(i.id));
    if (candidates.length > 0) {
      return candidates[Math.floor(rng() * candidates.length) % candidates.length];
    }
  }
  return null;
}

/** The four numbers an equipped item can change on an interlude mission.
 *  Neutral when no/unknown/dormant/off-mission item. */
export interface MissionModifiers {
  /** Added to the success rate (percentage points). */
  rateBonus: number;
  /** Multiplier on points_on_success. */
  pointsMult: number;
  /** Fraction of full points paid on FAILURE (base 0.10). */
  failFloor: number;
  /** Added to the growth-check d100. */
  growthBonus: number;
}

export const BASE_FAIL_FLOOR = 0.10;

export function computeMissionModifiers(itemId: string | null | undefined, missionKey: string): MissionModifiers {
  const mods: MissionModifiers = { rateBonus: 0, pointsMult: 1, failFloor: BASE_FAIL_FLOOR, growthBonus: 0 };
  const item = itemById(itemId);
  if (!item) return mods;
  const e = item.effect;
  switch (e.type) {
    case "mission_success_rate_bonus":
      if (!e.mission || e.mission === missionKey) mods.rateBonus = e.value;
      break;
    case "mission_points_bonus":
      if (!e.mission || e.mission === missionKey) mods.pointsMult = e.value;
      break;
    case "failure_points_floor_bonus":
      mods.failFloor = Math.max(BASE_FAIL_FLOOR, e.value);
      break;
    case "interlude_growth_bonus":
      mods.growthBonus = e.value;
      break;
    case "dormant":
      break;
  }
  return mods;
}

/** Success rate with an item bonus, hard-capped at 95 (never a sure thing). */
export function applyRateBonus(rate: number, bonus: number): number {
  return Math.min(95, rate + bonus);
}

export function applyPointsMult(points: number, mult: number): number {
  return Math.round(points * mult);
}

/** Player-facing effect description. */
export function effectText(item: ItemDef): string {
  const e = item.effect;
  const missionName: Record<string, string> = {
    night_patrol: "巡樓值夜", case_research: "資料整理",
    rumor_gathering: "街坊打探", physical_training: "體能訓練",
  };
  switch (e.type) {
    case "mission_success_rate_bonus":
      return `${e.mission ? `「${missionName[e.mission] ?? e.mission}」` : "所有幕間任務"}成功率 +${e.value}%`;
    case "mission_points_bonus":
      return `${e.mission ? `「${missionName[e.mission] ?? e.mission}」` : "所有幕間任務"}點數 ×${e.value.toFixed(2)}`;
    case "failure_points_floor_bonus":
      return `任務失敗時改獲得 ${Math.round(e.value * 100)}% 點數（原 10%）`;
    case "interlude_growth_bonus":
      return `幕間成長檢定骰 +${e.value}`;
    case "dormant":
      return "效果尚未覺醒";
  }
}
