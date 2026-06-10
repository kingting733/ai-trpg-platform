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
  return `你是一個多人文字 TRPG 平台的「每日劇本」設計師。你要從零原創一個完整、可實際遊玩的冒險劇本——不是大綱、不是摘要，而是一份「主持人拿了就能從頭跑到尾」的完整模組，包含一篇完整的故事原文。

輸出格式：只回傳一個原始 JSON 物件。不要 markdown 圍欄、不要任何說明文字。以 { 開始、以 } 結束。

語言：所有文字欄位一律使用繁體中文 (zh-TW)。

═══ 最重要：完整故事原文 full_story ═══
你必須寫出一篇完整、自成一體的故事原文（約 1500–3500 字），作為這個模組的「正典」。它要像一份真正的 TRPG 模組正文，包含：
- 背景與前情：事件的來龍去脈、真相、誰做了什麼、為什麼。
- 分幕結構：第一幕（鉤子與佈局）→ 第二幕（調查與升溫）→ 第三幕（真相與高潮）→ 結局。
- 每一幕的關鍵場景、會發生的事件、可揭露的線索、NPC 的行動與對白範例。
- 所有秘密、轉折、機關、敵人能力與弱點。
- 多種結局分支（成功 / 失敗 / 隱藏結局）與各自的觸發條件。
這是主持人在遊玩時會持續參照的正典，請寫得具體、有血有肉，不要含糊。

═══ 文字深度要求（不要只給標籤，要寫出有畫面的散文）═══
- opening_scene：電影感的開場敘述，約 150–300 字，第二人稱「你們」，營造氣氛與代入感，並給玩家第一個抉擇。
- gm_notes：分幕節奏指引、轉折揭曉的時機、玩家脫稿時的處理方式、敵人調整建議、伏筆與祕密機制。
- locations[].name：寫成一段有畫面的場景描述（不只是地名），帶感官細節。
- locations[].clues：玩家會發現什麼、發現時的感受、暗示了什麼真相。
- locations[].items：可取得的物品，必要時附帶遊戲效果。
- npcs[].personality：說話方式、行為舉止、緊張時的破綻、會對什麼說謊。
- npcs[].goal：隱藏的真實動機、願意為此犧牲什麼、藏著什麼秘密。

═══ 必填 JSON 鍵 ═══
- language：固定為 "zh-TW"
- full_story：上述的完整故事原文（字串）
- title：劇本名稱
- genre：原樣為這其中之一 [${IMPORT_GENRES.join(", ")}]（系統列舉值，不可翻譯）
- difficulty：[Story, Normal, Hard, Nightmare] 之一
- description：給玩家看的 1–3 句簡介，不可爆雷
- objective：玩家要達成什麼才算贏
- max_players：整數
- estimated_play_time：整數（分鐘）或 null
- tags：3–6 個短字串陣列
- opening_scene：如上的開場敘述
- locations：物件陣列 {"name","clues","items"}
- npcs：物件陣列 {"name","hp","mp","str","con","siz","dex","app","int","pow","edu","luck","personality","goal"}，未知數值填 50
- winning_targets：任一玩家完成即代表全隊勝利的目標，編號清單
- each_player_targets：每位存活玩家都必須各自完成的目標，編號清單，或 null
- failure_conditions：會導致冒險失敗的事件，編號清單
- failure_turn_limit：回合時限整數，或 null
- ending_conditions：其餘結局分支說明，或 null
- gm_notes：如上的主持要點

規則：
- description 給瀏覽中的玩家看，務必無雷；所有秘密、轉折、機制都放進 full_story / gm_notes / npcs.goal 等 GM 專用欄位。
- full_story 與結構化欄位必須彼此呼應一致（同樣的 NPC、地點、真相）。
- 空陣列用 []、缺漏文字欄位用 null。
- 發揮創意，讓劇本獨一無二、有記憶點。
- 確保 JSON 完整且每個括號與引號都正確閉合（特別注意 full_story 內的換行請用 \\n、引號請正確跳脫）。`;
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

// Higher than the importer's budget because we ALSO emit a full story module
// (full_story) on top of the structured fields. Tunable via env.
const DAILY_MAX_TOKENS = Number(process.env.AI_DAILY_MAX_TOKENS) || 6000;
const DAILY_TIMEOUT_MS = Number(process.env.AI_DAILY_TIMEOUT_MS) || 55000;

/** Pull a short snippet of the provider's error body so a 401/4xx says WHY
 *  (bad key, unknown model, wrong endpoint…) instead of just a status code. */
async function errBody(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    if (!text) return "";
    return `: ${text.slice(0, 300)}`;
  } catch {
    return "";
  }
}

/** Resolve the chat-completions endpoint. A token 中轉站 / relay exposes its own
 *  base URL (the official keys won't work against api.openai.com), so we honour
 *  an explicit override and tolerate whether it already includes `/v1`. */
function resolveChatUrl(provider: string, override?: string): string {
  if (override && override.trim()) {
    let base = override.trim().replace(/\/+$/, "");
    if (/\/chat\/completions$/.test(base)) return base;       // full path given
    if (/\/v1$/.test(base)) return `${base}/chat/completions`; // ends at /v1
    return `${base}/v1/chat/completions`;                      // host only
  }
  const host = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com";
  return `${host}/v1/chat/completions`;
}

/** Consume an SSE / NDJSON stream and accumulate the full assistant text.
 *  Handles both Anthropic's `event: content_block_delta` SSE format and the
 *  OpenAI-compatible `data: {"choices":[{"delta":{"content":"..."}}]}` format.
 *  Streaming keeps the first byte flowing so Cloudflare / relay gateways never
 *  declare a 504 on what would otherwise be a long-running silent request. */
async function collectStream(res: Response, provider: string): Promise<string> {
  if (!res.body) throw new Error("No response body from AI stream.");
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]" || trimmed.startsWith(": ")) continue;
        const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
        let chunk: any;
        try { chunk = JSON.parse(jsonStr); } catch { continue; }
        if (provider === "anthropic") {
          // Anthropic SSE: event: content_block_delta → delta.text
          const delta = chunk?.delta?.text ?? chunk?.delta?.thinking ?? "";
          text += delta;
        } else {
          // OpenAI-compatible: choices[0].delta.content
          text += chunk?.choices?.[0]?.delta?.content ?? "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return text.trim();
}

async function callDailyAI(system: string, user: string): Promise<string> {
  // The daily generator can run on a DIFFERENT (e.g. stronger) model than the
  // rest of the platform. AI_DAILY_* takes precedence, then the global default.
  const provider = process.env.AI_DAILY_PROVIDER ?? process.env.AI_PROVIDER ?? "deepseek";
  const model = process.env.AI_DAILY_MODEL ?? process.env.AI_MODEL ?? "deepseek-chat";
  const apiKey = process.env.AI_DAILY_API_KEY ?? process.env.AI_API_KEY;
  // Custom endpoint for a relay / 中轉站 / self-hosted gateway.
  const baseOverride = process.env.AI_DAILY_BASE_URL ?? process.env.AI_BASE_URL;

  if (!apiKey) {
    throw new Error(
      "Daily AI is not configured. Set AI_DAILY_PROVIDER / AI_DAILY_MODEL / AI_DAILY_API_KEY (or the global AI_* vars) in the server environment."
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DAILY_TIMEOUT_MS);
  try {
    if (provider === "anthropic") {
      const anthropicUrl = baseOverride?.trim()
        ? `${baseOverride.trim().replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/messages`
        : "https://api.anthropic.com/v1/messages";
      const res = await fetch(anthropicUrl, {
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
          stream: true,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Daily AI request failed (${res.status})${await errBody(res)}`);
      return await collectStream(res, "anthropic");
    }

    const res = await fetch(resolveChatUrl(provider, baseOverride), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: DAILY_MAX_TOKENS,
        temperature: 0.9,
        stream: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Daily AI request failed (${res.status})${await errBody(res)}`);
    return await collectStream(res, provider);
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
  /** The complete story module text — stored on the scenario's source_document
   *  and injected into the GM's context at play time (the canonical "原文"). */
  sourceDocument: string;
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

  // The full story module → stored on source_document for the GM to run from.
  const sourceDocument = typeof parsed?.full_story === "string" ? parsed.full_story.trim() : "";

  return { scenario, sourceDocument, seed };
}
