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

/** Mission duration. The INTERLUDE_DURATION_MS override is honored ONLY outside
 *  production, so a value left set after a playtest can never shrink real 24h
 *  missions in prod (which would inflate the whole economy). */
export function missionDurationMs(): number {
  // On Vercel, preview builds also set NODE_ENV=production, so VERCEL_ENV is the
  // authoritative signal when present; fall back to NODE_ENV off-Vercel.
  const isProd = process.env.VERCEL_ENV
    ? process.env.VERCEL_ENV === "production"
    : process.env.NODE_ENV === "production";
  if (!isProd) {
    const override = Number(process.env.INTERLUDE_DURATION_MS);
    if (Number.isFinite(override) && override > 0) return override;
  }
  return 24 * 60 * 60 * 1000;
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

// Preset mission narrations — 10 win + 10 fail per mission. No AI call is made
// for interlude rewards; the claim route picks one of these at random. `{name}`
// is replaced with the character's name.
export const MISSION_NARRATIONS: Record<string, { win: string[]; fail: string[] }> = {
  night_patrol: {
    win: [
      "{name}值了一整夜的班，走廊的燈閃過幾次，每一聲響動都記進了筆記。天亮時，一切平安。",
      "{name}沿住樓梯逐層巡查，喺後樓梯撞見一隻夜歸的貓，此外再無異樣。",
      "三點鐘，{name}聽見天台傳來腳步聲，上去卻只有晾衫竹在風中搖。虛驚一場，記錄卻詳實。",
      "{name}守到天光，把每一扇未閂好的鐵閘都記低，順手替三樓的婆婆關好了門。",
      "走廊盡頭的聲控燈總在{name}背後亮起。{name}沒有回頭，只把時間一一寫進值夜簿。",
      "{name}巡樓時發現地庫水管在滴水，順藤摸瓜，記下了幾處早該修的裂縫。",
      "夜深人靜，{name}在信箱旁執到一封無人認領的舊信，收好，留待白天再問。",
      "{name}整晚繞住大廈走，數清了每一盞壞掉的燈。交更時眼皮很重，心裡很踏實。",
      "二樓有戶人家整夜亮著燈，{name}遠遠望著，沒有打擾，只在簿上記下一行。",
      "{name}值夜到尾聲，晨光爬上牆身，昨夜的所有不安都散進了晨霧裡。",
    ],
    fail: [
      "{name}值夜到半途，喺後樓梯打咗個盹。醒來時什麼也沒記住，只有頸子痠痛。",
      "{name}被走廊的聲控燈嚇了一跳，之後整晚疑神疑鬼，什麼都沒巡好。",
      "大廈太靜，{name}的手電筒偏偏冇電，摸黑走了半層就折返，一夜無功。",
      "{name}守到三點就撐不住，靠在牆邊迷糊過去，天光才驚醒，值夜簿一片空白。",
      "{name}整晚被樓上不明的拖拉聲擾得心神不寧，最後躲進看更亭，什麼也沒查。",
      "落雨了，{name}困在門口避雨，半棟樓都沒巡到，只換來一身濕。",
      "{name}走錯了樓層，繞了半天才發現，天已快亮，什麼線索都沒記下。",
      "{name}被隔壁單位的爭吵聲牽住注意，聽了半晚八卦，正經事一件沒做。",
      "手機沒電、電筒又壞，{name}索性坐到天亮，這一夜算是白值了。",
      "{name}總覺得有人跟在身後，回頭又什麼都沒有。折騰整晚，一無所獲。",
    ],
  },
  case_research: {
    win: [
      "{name}喺檔案堆裡熬了一夜，指尖沾滿灰塵，總算把散落的線索整理出眉目。",
      "{name}翻遍舊剪報，在一則不起眼的訃聞裡，發現了兩個對得上的名字。",
      "一疊發黃的租單被{name}按年份理好，其中一張的簽名，似曾相識。",
      "{name}對著微縮膠卷看到眼花，卻在一角補白裡讀到了關鍵的一句。",
      "{name}把亂成一團的卷宗重新編號，順手抄下幾個反覆出現的地址。",
      "圖書館關門前，{name}借出最後一本地方志，回家又讀到深夜，筆記寫滿了兩頁。",
      "{name}在舊報紙的分類廣告裡，找到一則措辭古怪的尋人啟事，剪了下來。",
      "{name}把散頁按日期重排，時間線一清晰，事情的輪廓便浮了出來。",
      "一整晚整理下來，{name}終於分清了哪些是煙幕，哪些值得再查。",
      "{name}在檔案室待到最後，管理員來趕人時，手上正好多了幾條有用的線頭。",
    ],
    fail: [
      "{name}對著檔案坐到深夜，字都糊成一片，最後只整理出一疊沒有用的剪報。",
      "{name}借錯了年份的合訂本，翻了半晚才發現，白費工夫。",
      "微縮膠卷的機器卡住了，{name}折騰半天也沒修好，只好空手而回。",
      "{name}把卷宗弄亂了次序，重整到天亮，該找的東西還是沒找著。",
      "圖書館提早關門，{name}連最想借的那本都沒碰到。",
      "{name}看資料看到睡著，醒來時口水沾濕了半頁筆記，什麼也沒記住。",
      "檔案編號對不上，{name}在架與架之間來回找了整晚，一無所獲。",
      "{name}被一則無關的舊聞吸引，越讀越遠，正事一點沒碰。",
      "灰塵嗆得{name}直打噴嚏，草草翻了幾頁就收工，沒什麼收穫。",
      "{name}抄了半晚的筆記，回家才發現字太潦草，自己也認不出來。",
    ],
  },
  rumor_gathering: {
    win: [
      "{name}喺茶餐廳坐咗成個下晝，幾杯奶茶落肚，街坊嘅閒話裡漏出咗啲有意思嘅嘢。",
      "{name}在街市攀談，賣魚的阿嬸壓低聲音，說了句耐人尋味的話。",
      "麻雀館外，{name}遞了幾根煙，換來一段關於某戶人家的舊事。",
      "{name}同幾位阿伯在公園下棋，棋局散時，也套出了幾個名字。",
      "涼茶舖的收音機開得很大聲，{name}卻在鄰座的低語裡聽到了關鍵一句。",
      "{name}幫看舖的婆婆搬了幾箱汽水，婆婆一高興，便把街尾的怪事一一道來。",
      "排隊買豆腐花時，{name}聽見前面兩人談起某個搬走的租客，默默記下。",
      "{name}在髮型屋等剪頭髮，聽師傅同熟客講足一個鐘，收穫不小。",
      "夜市收檔前，{name}同小販閒聊幾句，換來一條沒人肯明說的線索。",
      "{name}請街口的看更飲了罐啤酒，對方話匣子一開，便說起了大廈的舊聞。",
    ],
    fail: [
      "{name}搭話搭得太急，街坊們笑而不語，一下午只換來幾句天氣話。",
      "{name}問得太直接，賣菜的阿嬸警覺起來，之後誰都不肯多說。",
      "茶餐廳太嘈，{name}什麼也聽不清，白喝了三杯奶茶。",
      "{name}認錯了人，尷尬地道歉半天，正經話一句沒問到。",
      "落大雨，街上冷冷清清，{name}等了半天也沒人可搭話。",
      "{name}的口音露了餡，街坊當佢係記者，個個閉口不談。",
      "{name}在麻雀館外站得太久，被人當成可疑人物趕走。",
      "幾位阿伯只顧下棋，{name}插不上嘴，蹲了一下午腳都麻了。",
      "{name}請人飲嘢，對方收咗嘢卻左顧右盼，臨走一句有用嘅都冇。",
      "{name}聽了一堆家長里短，回家才發現全是些對不上號的閒話。",
    ],
  },
  physical_training: {
    win: [
      "{name}練到汗流浹背，收拳嗰下，覺得身體比昨天更聽使喚了。",
      "{name}沿住海邊跑了個長課，回程時步伐輕快，呼吸也勻了。",
      "{name}在天台架起沙包，一拳一拳打到日落，虎口發燙卻很痛快。",
      "{name}反覆練習翻越矮牆，到最後一次，落地竟穩得沒發出半點聲。",
      "{name}同拳館的師兄對練幾回合，挨了幾下，也摸清了自己的破綻。",
      "{name}負重爬了十趟樓梯，腿在抖，心裡卻踏實了幾分。",
      "清晨的公園，{name}打完一套拳，收勢時，晨露正好從葉尖滴落。",
      "{name}練閃避練到反應快了半拍，連教練都點了點頭。",
      "{name}在球場跑圈跑到最後，超過了昨天的自己一整圈。",
      "{name}把動作拆開來一遍遍重複，枯燥，但身體確實記住了。",
    ],
    fail: [
      "{name}訓練時拉傷了點筋，早早收工。休息一晚就沒事，但今天算是白練了。",
      "{name}跑到一半抽筋，蹲在路邊揉了半天，訓練只好作罷。",
      "沙包的繩鬆了，{name}一拳打空，差點摔倒，之後也沒心情再練。",
      "{name}翻牆時勾到褲腳，狼狽落地，膝頭擦破了一小塊皮。",
      "落雨天台濕滑，{name}不敢逞強，草草收工。",
      "{name}熱身不足，練沒幾下就氣喘吁吁，只好提早回家。",
      "{name}同人對練時分了神，挨了記悶棍，捂著肚子歇了好一會。",
      "{name}負重爬樓爬到一半腿軟，扶著扶手喘氣，沒能練完。",
      "{name}前一晚沒睡好，今日渾身沒勁，動作一直做不到位。",
      "{name}練到中途鞋底開了膠，只好一拐一拐地回去，訓練泡湯。",
    ],
  },
};

/** Pick a random preset narration for a claimed mission (no AI call). */
export function pickMissionNarration(missionKey: string, characterName: string, success: boolean): string {
  const pool = MISSION_NARRATIONS[missionKey];
  const lines = pool ? (success ? pool.win : pool.fail) : [];
  const line = lines.length
    ? lines[Math.floor(Math.random() * lines.length)]
    : (success ? "{name}完成了任務，頗有收穫。" : "{name}完成了任務，但收穫寥寥。");
  return line.replace(/\{name\}/g, characterName);
}
