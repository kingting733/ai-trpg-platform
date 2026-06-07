// Server-side only. Analyzes a story document and returns structured scenario
// fields to PRE-FILL the creation form. It never saves or publishes anything.

import type { LocationEntry, NpcEntry } from "@/lib/ai/gm";

export const IMPORT_GENRES = ["Fantasy", "Cyberpunk", "Horror", "Sci-Fi", "Mystery", "Historical", "Other"];
export const IMPORT_DIFFICULTIES = ["Story", "Normal", "Hard", "Nightmare"];

/** The shape returned to the client to pre-fill the form. Matches the form fields. */
export interface ImportedScenario {
  title: string;
  genre: string;
  difficulty: string;
  description: string;
  objective: string;
  max_players: number;
  estimated_play_time: number | null;
  tags: string[];
  opening_scene: string | null;
  locations: LocationEntry[];
  npcs: NpcEntry[];
  /** Explicit victory conditions any ONE player can complete — numbered list. */
  winning_targets: string | null;
  /** Goals EVERY surviving player must complete individually — numbered list. */
  each_player_targets: string | null;
  /** Events that should END the game in failure — numbered list. */
  failure_conditions: string | null;
  /** Integer round number after which game auto-fails, or null. */
  failure_turn_limit: number | null;
  ending_conditions: string | null;
  gm_notes: string | null;
  /** BCP-47 language tag auto-detected from the source document. */
  language: string;
}

const VALID_LANGUAGES = ["zh-TW", "zh-CN", "en", "ja", "ko", "fr", "de", "es"];

function normalizeLanguage(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  // Accept exact matches or common aliases
  if (VALID_LANGUAGES.includes(s)) return s;
  const lower = s.toLowerCase();
  if (lower.startsWith("zh-tw") || lower === "traditional chinese" || lower === "繁體中文") return "zh-TW";
  if (lower.startsWith("zh-cn") || lower === "simplified chinese" || lower === "简体中文") return "zh-CN";
  if (lower === "en" || lower.startsWith("en-")) return "en";
  if (lower === "ja" || lower.startsWith("ja-") || lower === "japanese") return "ja";
  if (lower === "ko" || lower.startsWith("ko-") || lower === "korean") return "ko";
  return "zh-TW"; // safe default
}

// Keep document size sane for token/cost limits. Long modules are read from the
// top; raised high enough that most full modules (including their endings) fit
// rather than being front-truncated, which previously lost the climax/endings.
const MAX_DOC_CHARS = 48000;

// Ceiling for the full raw source we KEEP (separate from the summarization
// budget above). This is injected into the GM's cached system prefix at play
// time, so it can be larger than MAX_DOC_CHARS — but cap it to protect the
// model's context window. ~100k chars ≈ ~30-40k tokens. Tunable via env.
const SOURCE_DOC_MAX_CHARS = Number(process.env.AI_SOURCE_DOC_MAX_CHARS) || 100000;

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asNullableString(v: unknown): string | null {
  const s = asString(v);
  return s ? s : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, 25);
}

function asInt(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : def;
}

function normalizeLocations(v: unknown): LocationEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === "object" && typeof x.name === "string" && x.name.trim())
    .map((x: any) => ({
      name: asString(x.name),
      clues: asString(x.clues),
      items: asString(x.items),
    }))
    .slice(0, 15);
}

function normalizeNpcs(v: unknown): NpcEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === "object" && typeof x.name === "string" && x.name.trim())
    .map((x: any) => ({
      name: asString(x.name),
      hp: asInt(x.hp, 10),
      mp: asInt(x.mp, 5),
      str: asInt(x.str, 50),
      con: asInt(x.con, 50),
      siz: asInt(x.siz, 50),
      dex: asInt(x.dex, 50),
      app: asInt(x.app, 50),
      int: asInt(x.int, 50),
      pow: asInt(x.pow, 50),
      edu: asInt(x.edu, 50),
      luck: asInt(x.luck, 50),
      personality: asString(x.personality),
      goal: asString(x.goal),
    }))
    .slice(0, 20);
}

function normalizeFailureTurnLimit(v: unknown): number | null {
  if (v == null) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Coerce/clamp the AI output into a valid, editable ImportedScenario. */
export function normalizeImported(raw: any): ImportedScenario {
  const genreRaw = asString(raw?.genre);
  const genre = IMPORT_GENRES.find((g) => g.toLowerCase() === genreRaw.toLowerCase()) ?? "Other";

  const diffRaw = asString(raw?.difficulty);
  const difficulty = IMPORT_DIFFICULTIES.find((d) => d.toLowerCase() === diffRaw.toLowerCase()) ?? "Normal";

  let maxPlayers = Number(raw?.max_players);
  if (!Number.isFinite(maxPlayers)) maxPlayers = 4;
  maxPlayers = Math.min(6, Math.max(1, Math.round(maxPlayers)));

  let ept: number | null = Number(raw?.estimated_play_time);
  if (!Number.isFinite(ept) || ept <= 0) ept = null;
  else ept = Math.min(600, Math.round(ept));

  const tags = asStringArray(raw?.tags)
    .map((t) => t.toLowerCase().replace(/^#/, ""))
    .slice(0, 8);

  return {
    title: asString(raw?.title) || "Imported Scenario",
    genre,
    difficulty,
    description: asString(raw?.description),
    objective: asString(raw?.objective),
    max_players: maxPlayers,
    estimated_play_time: ept,
    tags,
    opening_scene: asNullableString(raw?.opening_scene),
    locations: normalizeLocations(raw?.locations),
    npcs: normalizeNpcs(raw?.npcs),
    winning_targets: asNullableString(raw?.winning_targets),
    each_player_targets: asNullableString(raw?.each_player_targets),
    failure_conditions: asNullableString(raw?.failure_conditions),
    failure_turn_limit: normalizeFailureTurnLimit(raw?.failure_turn_limit),
    ending_conditions: asNullableString(raw?.ending_conditions),
    gm_notes: asNullableString(raw?.gm_notes),
    language: normalizeLanguage(raw?.language),
  };
}

function buildPrompt(): string {
  return `You are a scenario-design assistant for a multiplayer TRPG text-adventure platform.
Analyze the uploaded story / game module and return a JSON object that will pre-fill a scenario creation form. The output must contain ENOUGH PLAYABLE DETAIL for an AI Game Master to actually RUN this adventure end to end — it is NOT a book report. Preserve the module's depth; do not collapse it into a summary.

OUTPUT FORMAT: Return ONLY a raw JSON object. No markdown fences, no code blocks, no commentary before or after. Start your response with { and end with }.

LANGUAGE: Detect the document's language and write ALL text fields in that same language (do not translate). Set "language" to "zh-TW" for Traditional Chinese, "zh-CN" for Simplified Chinese, "en" for English, "ja" for Japanese, "ko" for Korean.

DEPTH REQUIREMENTS — the most important part. For these fields, PRESERVE the source's detail instead of summarizing it away:
- locations: array of objects {"name": "...", "clues": "...", "items": "..."}. For each location give a vivid description in the name field, what clues can be discovered there in clues, and what items can be found in items.
- npcs: array of objects {"name": "...", "hp": 10, "mp": 5, "str": 50, "con": 50, "siz": 50, "dex": 50, "app": 50, "int": 50, "pow": 50, "edu": 50, "luck": 50, "personality": "...", "goal": "..."}. ONE rich entry per important NPC. Set stats based on the character's described capabilities — default all stats to 50 if not given. personality: their role, how they speak/behave. goal: their motivation, what they want, what secret they hide.
- winning_targets: VICTORY goals that any ONE player completing satisfies for the whole party, as a numbered list (e.g. "1. 取回聖石並逃出神廟\n2. 消滅守門者"). Do NOT include failure conditions here. null if none.
- each_player_targets: victory goals that EVERY surviving player must complete individually (signalled by "each player", "everyone must", "both must"), as a numbered list. null if none.
- failure_conditions: events that should END the adventure in DEFEAT (e.g. "聖石被敵人奪走", "神廟在隊伍逃出前坍塌"), as a numbered list. null if none.
- failure_turn_limit: if the story specifies a time limit in rounds/turns (e.g. "players have 20 rounds"), extract the integer here; otherwise null.
- ending_conditions: any remaining ending nuance/branch notes not captured above, or null.
- gm_notes: anything else needed to run it well (foreshadowing, optional content, scaling, adjudication tips, secret mechanics, pacing).

Required JSON keys:
- language: BCP-47 tag (zh-TW, zh-CN, en, ja, ko)
- title: scenario name
- genre: exactly one of [${IMPORT_GENRES.join(", ")}]
- difficulty: exactly one of [${IMPORT_DIFFICULTIES.join(", ")}]
- description: 1-3 sentence PLAYER-FACING summary (no spoilers)
- objective: what players must do to win
- max_players: integer 1-6
- estimated_play_time: integer minutes or null
- tags: array of 3-6 short strings
- opening_scene: vivid opening narration or null
- locations: array of location objects {name, clues, items}
- npcs: array of NPC objects {name, hp, mp, str, con, siz, dex, app, int, pow, edu, luck, personality, goal}
- winning_targets: numbered list of party victory goals (any one player can complete), or null
- each_player_targets: numbered list of goals every surviving player must do individually, or null
- failure_conditions: numbered list of events that end the game in defeat, or null
- failure_turn_limit: integer round limit that triggers auto-failure, or null
- ending_conditions: remaining ending notes, or null
- gm_notes: extra GM guidance or null

Notes:
- title, genre, difficulty, description, objective must ALWAYS be filled (infer if vague).
- genre and difficulty must be exact English enum values from the lists above (they are system enums, not display text).
- description is shown to players browsing — keep it spoiler-free; put all secrets, twists, and mechanics in the GM-only fields above.
- Use [] for empty arrays and null for missing text fields. Do not invent content the document does not support, but DO preserve every piece of playable detail it provides.
- Be thorough, but ensure the JSON is COMPLETE and valid (every brace and bracket closed).`;
}

// Max output tokens for the deep extraction. Lower this (via AI_IMPORT_MAX_TOKENS)
// if imports time out on a lower serverless tier.
const IMPORT_MAX_TOKENS = Number(process.env.AI_IMPORT_MAX_TOKENS) || 8000;

// Abort the AI call before the serverless function itself is killed, so we can
// return a clean JSON error instead of the platform's HTML error page (which
// made the client throw "Unexpected token ... is not valid JSON"). Keep this a
// bit under the route's maxDuration.
const IMPORT_TIMEOUT_MS = Number(process.env.AI_IMPORT_TIMEOUT_MS) || 110000;

async function callAI(system: string, user: string): Promise<string> {
  const provider = process.env.AI_PROVIDER ?? "deepseek";
  // AI_IMPORT_MODEL overrides the default model for scenario imports only.
  // Use this to point imports at a more capable (pro/full) model while keeping
  // the rest of the game on a faster/cheaper flash model.
  const model = process.env.AI_IMPORT_MODEL ?? process.env.AI_MODEL ?? "deepseek-chat";
  const apiKey = process.env.AI_API_KEY;

  if (!apiKey) {
    throw new Error("AI is not configured. Set AI_PROVIDER, AI_MODEL, and AI_API_KEY in the server environment.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);
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
          max_tokens: IMPORT_MAX_TOKENS,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`AI request failed (${res.status}).`);
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
        max_tokens: IMPORT_MAX_TOKENS,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`AI request failed (${res.status}).`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(
        "AI 分析逾時：文件太長，請縮短文件或分段匯入後再試。（可調整 AI_IMPORT_MODEL 為較快的模型，或縮短文件長度）"
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function extractFirstJSON(s: string): string {
  // Strip markdown code fences
  s = s.replace(/^```(?:json)?\s*/im, "").replace(/```\s*$/im, "").trim();

  // Find outermost { ... } using bracket matching
  const start = s.indexOf("{");
  if (start === -1) return s;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  // Unmatched — return from start to end
  return s.slice(start);
}

/** Analyze raw document text and return validated, editable scenario fields. */
export async function analyzeScenarioDocument(
  text: string
): Promise<{ scenario: ImportedScenario; truncated: boolean; sourceDocument: string }> {
  const truncated = text.length > MAX_DOC_CHARS;
  const doc = truncated ? text.slice(0, MAX_DOC_CHARS) : text;

  // Keep the full raw text (up to a generous ceiling) so the GM can reference
  // the WHOLE module at play time, not just the summary. This is stored on the
  // scenario and injected into the GM's cached system prefix.
  const sourceDocument = text.slice(0, SOURCE_DOC_MAX_CHARS);

  const system = buildPrompt();
  const user = `STORY DOCUMENT:\n"""\n${doc}\n"""`;

  const raw = await callAI(system, user);
  const extracted = extractFirstJSON(raw);

  let parsed: any;
  try {
    parsed = JSON.parse(extracted);
  } catch {
    // Log the actual AI output server-side to aid debugging. A common cause now
    // is the deep extraction exceeding the output token budget and truncating
    // the JSON mid-object.
    console.error(
      "[import-scenario] JSON parse failed.",
      `raw length=${raw.length}.`,
      "Tail (last 300 chars):",
      raw.slice(-300)
    );
    throw new Error(
      "The AI could not produce a structured scenario from this document. " +
      "Try a clearer story document, or fill the form manually."
    );
  }

  return { scenario: normalizeImported(parsed), truncated, sourceDocument };
}
