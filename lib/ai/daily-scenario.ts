// Server-side only. Invents a brand-new, fully playable scenario FROM SCRATCH
// (unlike import-scenario.ts, which analyses an uploaded document). The output
// is the exact same ImportedScenario shape used by the 建立劇本 form, importer
// and editor — so a generated daily scenario is structurally identical to a
// hand-made one and flows through the existing editor / GM engine untouched.

import {
  type ImportedScenario,
  IMPORT_GENRES,
  normalizeImported,
  extractFirstJSON,
} from "@/lib/ai/import-scenario";

// ── Seed configuration (mirrors the daily_seed_config DB row) ────────────────

export interface DailySeedConfig {
  genre_rotation: string[];
  tone_pool: string[];
  setting_pool: string[];
  hook_pool: string[];
  min_players: number;
  max_players: number;
  play_time_min: number;
  play_time_max: number;
  /** Optional one-off idea (e.g. inspired by today's news). Overrides the
   *  rotation when non-empty, then the caller clears it after generating. */
  today_idea: string;
}

export const DEFAULT_SEED_CONFIG: DailySeedConfig = {
  genre_rotation: ["Horror", "Mystery", "Fantasy", "Sci-Fi", "Cyberpunk", "Historical", "Other"],
  tone_pool: ["懸疑驚悚", "冷硬偵探", "詭譎超自然", "黑色幽默", "史詩悲劇", "荒誕怪奇"],
  setting_pool: ["雪封山中小鎮", "廢棄精神病院", "濱海漁村", "山中古剎", "軌道太空站", "霓虹貧民窟", "百年大宅", "末班地鐵"],
  hook_pool: ["一名訪客離奇失蹤", "一封沒有署名的信", "一具查不出死因的屍體", "一場無法解釋的停電", "一個反覆出現的夢", "一件被詛咒的古董"],
  min_players: 2,
  max_players: 4,
  play_time_min: 60,
  play_time_max: 120,
  today_idea: "",
};

/** Merge a partial/raw config (from the DB) onto the defaults so missing keys
 *  never crash the generator. */
export function coerceSeedConfig(raw: any): DailySeedConfig {
  const arr = (v: any, fb: string[]) =>
    Array.isArray(v) && v.length && v.every((x) => typeof x === "string") ? v : fb;
  const int = (v: any, fb: number) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : fb);
  return {
    genre_rotation: arr(raw?.genre_rotation, DEFAULT_SEED_CONFIG.genre_rotation),
    tone_pool: arr(raw?.tone_pool, DEFAULT_SEED_CONFIG.tone_pool),
    setting_pool: arr(raw?.setting_pool, DEFAULT_SEED_CONFIG.setting_pool),
    hook_pool: arr(raw?.hook_pool, DEFAULT_SEED_CONFIG.hook_pool),
    min_players: int(raw?.min_players, DEFAULT_SEED_CONFIG.min_players),
    max_players: int(raw?.max_players, DEFAULT_SEED_CONFIG.max_players),
    play_time_min: int(raw?.play_time_min, DEFAULT_SEED_CONFIG.play_time_min),
    play_time_max: int(raw?.play_time_max, DEFAULT_SEED_CONFIG.play_time_max),
    today_idea: typeof raw?.today_idea === "string" ? raw.today_idea : "",
  };
}

// ── Seed assembly ────────────────────────────────────────────────────────────

export interface DailySeed {
  mode: "rotation" | "custom";
  genre: string | null;       // null in custom mode — AI chooses
  tone: string | null;
  setting: string | null;
  hook: string | null;
  customIdea: string | null;
  minPlayers: number;
  maxPlayers: number;
  playTimeMin: number;
  playTimeMax: number;
  dateStr: string;            // YYYY-MM-DD salt
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Day-of-year so the genre rotates deterministically across the calendar. */
function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}

export function assembleSeed(config: DailySeedConfig, date: Date, dateStr: string): DailySeed {
  const idea = config.today_idea.trim();
  if (idea) {
    return {
      mode: "custom",
      genre: null, tone: null, setting: null, hook: null,
      customIdea: idea,
      minPlayers: config.min_players,
      maxPlayers: config.max_players,
      playTimeMin: config.play_time_min,
      playTimeMax: config.play_time_max,
      dateStr,
    };
  }
  const genre = config.genre_rotation[dayOfYear(date) % config.genre_rotation.length];
  return {
    mode: "rotation",
    genre,
    tone: pick(config.tone_pool),
    setting: pick(config.setting_pool),
    hook: pick(config.hook_pool),
    customIdea: null,
    minPlayers: config.min_players,
    maxPlayers: config.max_players,
    playTimeMin: config.play_time_min,
    playTimeMax: config.play_time_max,
    dateStr,
  };
}

// ── Prompt construction ──────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `你是一個多人文字 TRPG 平台的「每日劇本」設計師。你要從零原創一個完整、可實際遊玩的冒險劇本，讓 AI 主持人能從頭到尾跑完——這不是大綱，而是一份可直接運行的模組。

輸出格式：只回傳一個原始 JSON 物件。不要 markdown 圍欄、不要任何說明文字。以 { 開始、以 } 結束。

語言：所有文字欄位一律使用繁體中文 (zh-TW)。

深度要求（最重要）：
- locations：物件陣列 {"name","clues","items"}。每個地點要有生動描述（寫在 name 內）、可發現的線索（clues）、可取得的物品（items）。
- npcs：物件陣列 {"name","hp","mp","str","con","siz","dex","app","int","pow","edu","luck","personality","goal"}。每個重要角色一筆，依其能力設定數值（未知則填 50）。personality 寫角色定位與言行；goal 寫動機與隱藏的秘密。
- winning_targets：任一玩家完成即代表全隊勝利的目標，編號清單（例 "1. ...\\n2. ..."）。
- each_player_targets：每位存活玩家都必須各自完成的目標，編號清單，否則 null。
- failure_conditions：會導致冒險以失敗告終的事件，編號清單。
- failure_turn_limit：若有回合時限則填整數，否則 null。
- ending_conditions / gm_notes：其餘結局分支與主持要點。

必填 JSON 鍵：
- language：固定為 "zh-TW"
- title：劇本名稱
- genre：原樣為這其中之一 [${IMPORT_GENRES.join(", ")}]（系統列舉值，不可翻譯）
- difficulty：[Story, Normal, Hard, Nightmare] 之一
- description：給玩家看的 1–3 句簡介，不可爆雷
- objective：玩家要達成什麼才算贏
- max_players：整數
- estimated_play_time：整數（分鐘）或 null
- tags：3–6 個短字串陣列
- opening_scene：生動的開場敘述
- locations：地點物件陣列
- npcs：NPC 物件陣列
- winning_targets / each_player_targets / failure_conditions / ending_conditions / gm_notes：如上，缺漏用 null
- failure_turn_limit：整數或 null

規則：
- title, genre, difficulty, description, objective 必須一定填寫。
- description 給瀏覽中的玩家看，務必無雷；所有秘密、轉折、機制都放進 GM 專用欄位（gm_notes / ending_conditions / npcs.goal 等）。
- 空陣列用 []、缺漏文字欄位用 null。
- 發揮創意，讓劇本獨一無二、有記憶點，並提供足以從頭跑到尾的細節。
- 確保 JSON 完整且每個括號與引號都正確閉合。`;
}

function buildUserMessage(seed: DailySeed): string {
  const playerLine = `玩家人數：${seed.minPlayers}–${seed.maxPlayers} 人，預計時長 ${seed.playTimeMin}–${seed.playTimeMax} 分鐘`;
  if (seed.mode === "custom") {
    return `請以下列真實靈感為核心，原創今天的劇本，把它轉化為一個引人入勝的 TRPG 冒險：

靈感：「${seed.customIdea}」

- 自由選擇最合適的 genre（必須是系統列舉值）、difficulty 與基調。
- ${playerLine}
- 日期種子：${seed.dateStr}

請保持其餘格式要求不變，輸出完整 JSON。`;
  }
  return `請依以下設定原創今天的劇本：
- 類型 genre：${seed.genre}（必須原樣使用此英文列舉值）
- 基調 tone：${seed.tone}
- 場景 setting：${seed.setting}
- 開場鉤子 hook：${seed.hook}
- ${playerLine}
- 日期種子：${seed.dateStr}

請發揮創意，讓這個劇本獨一無二、有記憶點，並提供足以從頭跑到尾的細節。輸出完整 JSON。`;
}

// ── AI call (dedicated model, falls back to the platform default) ────────────

const DAILY_MAX_TOKENS = Number(process.env.AI_DAILY_MAX_TOKENS) || 8000;
const DAILY_TIMEOUT_MS = Number(process.env.AI_DAILY_TIMEOUT_MS) || 110000;

async function callDailyAI(system: string, user: string): Promise<string> {
  // The daily generator can run on a DIFFERENT (e.g. stronger) model than the
  // rest of the platform. AI_DAILY_* takes precedence, then the global default.
  const provider = process.env.AI_DAILY_PROVIDER ?? process.env.AI_PROVIDER ?? "deepseek";
  const model = process.env.AI_DAILY_MODEL ?? process.env.AI_MODEL ?? "deepseek-chat";
  const apiKey = process.env.AI_DAILY_API_KEY ?? process.env.AI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Daily AI is not configured. Set AI_DAILY_PROVIDER / AI_DAILY_MODEL / AI_DAILY_API_KEY (or the global AI_* vars) in the server environment."
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DAILY_TIMEOUT_MS);
  try {
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          system,
          messages: [{ role: "user", content: user }],
          max_tokens: DAILY_MAX_TOKENS,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Daily AI request failed (${res.status}).`);
      const data = await res.json();
      return data.content?.[0]?.text?.trim() ?? "";
    }

    const baseUrl = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com";
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: DAILY_MAX_TOKENS,
        temperature: 0.9, // higher than import — we WANT inventive variety
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Daily AI request failed (${res.status}).`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("每日劇本生成逾時，請稍後重試或調整 AI_DAILY_MODEL 為較快的模型。");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public entry point ───────────────────────────────────────────────────────

export interface GeneratedDaily {
  scenario: ImportedScenario;
  seed: DailySeed;
}

/** Generate one daily scenario from the given seed config. Returns the same
 *  validated ImportedScenario shape used everywhere else; the caller persists
 *  it (as a draft owned by the system user). */
export async function generateDailyScenario(
  config: DailySeedConfig,
  now: Date = new Date(),
  dateStr?: string
): Promise<GeneratedDaily> {
  const seed = assembleSeed(config, now, dateStr ?? now.toISOString().slice(0, 10));
  const system = buildSystemPrompt();
  const user = buildUserMessage(seed);

  const raw = await callDailyAI(system, user);
  const extracted = extractFirstJSON(raw);

  let parsed: any;
  try {
    parsed = JSON.parse(extracted);
  } catch {
    console.error("[daily-scenario] JSON parse failed. Tail:", raw.slice(-300));
    throw new Error("AI 無法產生有效的每日劇本，請重試。");
  }

  const scenario = normalizeImported(parsed);
  // Daily scenarios are always zh-TW and bounded by the seed's player range.
  scenario.language = "zh-TW";
  scenario.max_players = Math.min(config.max_players, Math.max(config.min_players, scenario.max_players));
  return { scenario, seed };
}
