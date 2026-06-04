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
Analyze the uploaded story document and return a JSON object to pre-fill a scenario creation form.

OUTPUT FORMAT: Return ONLY a raw JSON object. No markdown fences, no code blocks, no commentary before or after. Start your response with { and end with }.

LANGUAGE: Detect the language of the document. Write all text fields in that same language (do not translate). Set "language" to "zh-TW" for Traditional Chinese, "zh-CN" for Simplified Chinese, "en" for English, "ja" for Japanese, "ko" for Korean.

Required JSON keys:
- language: BCP-47 tag (zh-TW, zh-CN, en, ja, ko)
- title: scenario name
- genre: exactly one of [${IMPORT_GENRES.join(", ")}]
- difficulty: exactly one of [${IMPORT_DIFFICULTIES.join(", ")}]
- description: 1-3 sentence player-facing summary (no spoilers)
- objective: what players must do to win
- max_players: integer 1-6
- estimated_play_time: integer minutes or null
- tags: array of 3-6 short strings
- opening_scene: vivid opening narration or null
- background: world lore / history or null
- locations: array of "Name — short description" strings
- npcs: array of "Name — role / personality" strings
- key_items: array of "Name — what it does" strings
- secret_rules: GM pacing / mechanics or null
- threats: array of "Name — danger description" strings
- traps: array of "Name — trigger / effect" strings
- ending_conditions: victory and failure conditions or null
- gm_notes: extra GM guidance or null

Notes:
- title, genre, difficulty, description, objective must always be filled (infer if vague).
- genre and difficulty must be exact English enum values from the lists above.
- Use [] for empty arrays and null for missing text fields.`;
}

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
        max_tokens: 3500,
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
      max_tokens: 3500,
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`AI request failed (${res.status}).`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
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
): Promise<{ scenario: ImportedScenario; truncated: boolean }> {
  const truncated = text.length > MAX_DOC_CHARS;
  const doc = truncated ? text.slice(0, MAX_DOC_CHARS) : text;

  const system = buildPrompt();
  const user = `STORY DOCUMENT:\n"""\n${doc}\n"""`;

  const raw = await callAI(system, user);
  const extracted = extractFirstJSON(raw);

  let parsed: any;
  try {
    parsed = JSON.parse(extracted);
  } catch (err) {
    // Log the actual AI output server-side to aid debugging
    console.error("[import-scenario] JSON parse failed. Raw AI output (first 500 chars):", raw.slice(0, 500));
    throw new Error(
      "The AI could not produce a structured scenario from this document. " +
      "Try a clearer story document, or fill the form manually."
    );
  }

  return { scenario: normalizeImported(parsed), truncated };
}
