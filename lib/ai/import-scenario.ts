// Server-side only. Analyzes a story document and returns structured scenario
// fields to PRE-FILL the creation form. It never saves or publishes anything.

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
  background: string | null;
  locations: string[];
  npcs: string[];
  key_items: string[];
  secret_rules: string | null;
  threats: string[];
  traps: string[];
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

// Keep document size sane for token/cost limits. Long docs are read from the top.
const MAX_DOC_CHARS = 24000;

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
    background: asNullableString(raw?.background),
    locations: asStringArray(raw?.locations),
    npcs: asStringArray(raw?.npcs),
    key_items: asStringArray(raw?.key_items),
    secret_rules: asNullableString(raw?.secret_rules),
    threats: asStringArray(raw?.threats),
    traps: asStringArray(raw?.traps),
    ending_conditions: asNullableString(raw?.ending_conditions),
    gm_notes: asNullableString(raw?.gm_notes),
    language: normalizeLanguage(raw?.language),
  };
}

function buildPrompt(): string {
  return `You are a scenario-design assistant for a multiplayer TRPG text-adventure platform.
A creator uploaded a story document. Analyze it and extract a structured scenario definition that will PRE-FILL a creation form for the creator to review. You are NOT publishing anything.

CRITICAL LANGUAGE RULE — READ THIS FIRST:
1. Detect the primary language of the uploaded document (e.g. Traditional Chinese, Simplified Chinese, English, Japanese).
2. Write ALL generated text fields in the EXACT SAME LANGUAGE as the source document. Do NOT translate.
3. If the document is in Chinese, write title, description, objective, opening_scene, background, locations, npcs, key_items, secret_rules, threats, traps, ending_conditions, gm_notes ALL in Chinese.
4. If the document is in English, write all fields in English. If in Japanese, write in Japanese. Mirror the source language exactly.
5. Set the "language" field to the appropriate BCP-47 tag: "zh-TW" for Traditional Chinese, "zh-CN" for Simplified Chinese, "en" for English, "ja" for Japanese, "ko" for Korean.
6. Tags should also be in the source language.

Return ONLY valid JSON (no markdown fences, no commentary) with EXACTLY these keys:
{
  "language": "zh-TW" | "zh-CN" | "en" | "ja" | "ko" | string,
  "title": string,
  "genre": one of [${IMPORT_GENRES.join(", ")}],
  "difficulty": one of [${IMPORT_DIFFICULTIES.join(", ")}],
  "description": string,            // 1-3 sentence PLAYER-FACING summary, no spoilers — in source language
  "objective": string,              // what players must accomplish to win — in source language
  "max_players": integer 1-6,
  "estimated_play_time": integer minutes or null,
  "tags": string[],                 // 3-6 short tags — in source language
  "opening_scene": string or null,  // vivid opening narration — in source language
  "background": string or null,     // world lore / history — in source language
  "locations": string[],            // "Name — short note" — in source language
  "npcs": string[],                 // "Name — role / personality" — in source language
  "key_items": string[],            // "Name — what it does" — in source language
  "secret_rules": string or null,   // GM pacing / tone / mechanics — in source language
  "threats": string[],              // "Name — danger" — in source language
  "traps": string[],                // "Name — trigger / effect" — in source language
  "ending_conditions": string or null, // victory / failure conditions — in source language
  "gm_notes": string or null        // extra GM guidance — in source language
}

Rules:
- title, genre, difficulty, description, objective MUST always be filled with your best inference, even if the document is vague.
- genre and difficulty values must be from the English lists above (they are system enums, not UI text).
- description is shown to players browsing — keep it concise and spoiler-free.
- Put spoilers, secrets, twists, and mechanics in the GM-only fields (opening_scene, background, locations, npcs, key_items, secret_rules, threats, traps, ending_conditions, gm_notes).
- Use [] for empty lists and null for empty text fields — never invent filler.
- Do not add real authors or copyrighted character names that are not in the document.`;
}

async function callAI(system: string, user: string): Promise<string> {
  const provider = process.env.AI_PROVIDER ?? "deepseek";
  const model = process.env.AI_MODEL ?? "deepseek-chat";
  const apiKey = process.env.AI_API_KEY;

  if (!apiKey) {
    throw new Error("AI is not configured. Set AI_PROVIDER, AI_MODEL, and AI_API_KEY in the server environment.");
  }

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
        max_tokens: 2000,
      }),
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
      max_tokens: 2000,
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`AI request failed (${res.status}).`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/** Analyze raw document text and return validated, editable scenario fields. */
export async function analyzeScenarioDocument(
  text: string
): Promise<{ scenario: ImportedScenario; truncated: boolean }> {
  const truncated = text.length > MAX_DOC_CHARS;
  const doc = truncated ? text.slice(0, MAX_DOC_CHARS) : text;

  const system = buildPrompt();
  const user = `STORY DOCUMENT:\n"""\n${doc}\n"""`;

  let raw = await callAI(system, user);
  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

  // Be forgiving: extract the first {...} block if the model added stray text.
  if (!raw.startsWith("{")) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) raw = raw.slice(start, end + 1);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The AI could not produce a structured scenario from this document. Try a clearer story document, or fill the form manually.");
  }

  return { scenario: normalizeImported(parsed), truncated };
}
