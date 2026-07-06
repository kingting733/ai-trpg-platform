// Server-side only. Generates the personalised closing screen for a named
// ScenarioEnding. This is called ONCE when the ending condition fires — the
// creator's description directive is expanded using the actual story history.

import type { ScenarioEnding } from "@/lib/game/endings";
import type { LedgerEntry } from "@/lib/ai/gm";

// ── AI call (same pattern as objectives.ts) ───────────────────────────────────

async function callAI(system: string, user: string, maxTokens: number): Promise<string> {
  const provider = process.env.AI_PROVIDER ?? "deepseek";
  const model = process.env.AI_MODEL ?? "deepseek-chat";
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return "";

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
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) return "";
      const data = await res.json();
      return data.content?.[0]?.text?.trim() ?? "";
    }

    const baseOverride = process.env.AI_BASE_URL?.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    const defaultBase = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com";
    const baseUrl = baseOverride ?? defaultBase;
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
    });
    if (!res.ok) return "";
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  } catch {
    return "";
  }
}

function extractJSON(raw: string): string {
  let s = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  if (!s.startsWith("{")) {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end > start) s = s.slice(start, end + 1);
  }
  return s;
}

function langLabel(language: string | null): string | null {
  if (!language) return null;
  const map: Record<string, string> = {
    "zh-TW": "Traditional Chinese (繁體中文)",
    "zh-CN": "Simplified Chinese (简体中文)",
    en: "English",
    ja: "Japanese",
    ko: "Korean",
    fr: "French",
    de: "German",
    es: "Spanish",
  };
  return map[language] ?? null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate the closing title + epilogue for a named ending.
 *
 * The ending's `description` field is the creator's directive (e.g. "阿澤
 * 終於得到了救贖……"). The AI weaves it together with the actual story
 * history so the epilogue reflects what THESE players specifically did.
 *
 * Has a safe fallback — the ending always fires even if the AI call fails.
 */
export async function generateEndingNarration(
  ending: ScenarioEnding,
  scenarioTitle: string,
  storyLedger: LedgerEntry[],
  recentLog: string[],
  language: string | null,
): Promise<{ title: string; summary: string }> {
  const isZh = language === "zh-TW" || language === "zh-CN";
  const fallback = {
    title: ending.name,
    summary: isZh
      ? `${ending.description || "冒險就此落幕。"}`
      : `${ending.description || "The adventure comes to a close."}`,
  };

  const label = langLabel(language);
  const langRule = label ? `\nWrite "title" and "summary" in ${label}.` : "";

  const ledgerFacts = storyLedger
    .slice(-20)
    .map((e) => `[${e.character}] ${e.fact}`)
    .join("\n");

  const system = `You write the closing epilogue screen for a multiplayer TRPG adventure that has just ended with the named ending below.${langRule}

Return ONLY valid JSON, no markdown:
{"title":string,"summary":string}
- title: use the ending's name verbatim, or a 4–7 word poetic variation of it.
- summary: a vivid epilogue of about 300 words in flowing prose. Describe what happens AFTERWARD — the fate of each character, what becomes of the world or place, how the threads resolve. Personalise it by weaving in the specific actions, choices, and sacrifices shown in STORY FACTS and RECENT STORY. Do not invent characters or events that contradict the story facts. Do not mention game mechanics.

The ENDING DIRECTIVE is the creator's intention for this epilogue — honour it, but expand and personalise it using the actual story history. It is a starting point, not a script.`;

  const user = `ADVENTURE: ${scenarioTitle}
ENDING REACHED: ${ending.name} (${ending.type})
ENDING DIRECTIVE: ${ending.description || "(none — write a fitting epilogue for this ending type)"}

STORY FACTS (what actually happened — use these to personalise the epilogue):
${ledgerFacts || "(no facts recorded yet)"}

RECENT STORY (last turns):
${recentLog.slice(-12).join("\n") || "(no recent log)"}

Write the closing epilogue.`;

  const raw = await callAI(system, user, 900);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(extractJSON(raw));
    return {
      title:
        typeof parsed?.title === "string" && parsed.title.trim()
          ? parsed.title.trim().slice(0, 80)
          : fallback.title,
      summary:
        typeof parsed?.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim().slice(0, 4000)
          : fallback.summary,
    };
  } catch {
    return fallback;
  }
}
