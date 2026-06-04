// Server-side only. Checks whether a player action + GM narration satisfies
// one of the scenario's ending conditions.

export type EndingType = "best" | "normal" | "bad" | "failure";

export interface EndingResult {
  triggered: boolean;
  type: EndingType | null;
  title: string | null;
  summary: string | null;
}

const NULL_RESULT: EndingResult = { triggered: false, type: null, title: null, summary: null };

const VALID_TYPES: EndingType[] = ["best", "normal", "bad", "failure"];

async function callAI(system: string, user: string): Promise<string> {
  const provider = process.env.AI_PROVIDER ?? "deepseek";
  const model = process.env.AI_MODEL ?? "deepseek-chat";
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return "{}";

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
          max_tokens: 300,
        }),
      });
      if (!res.ok) return "{}";
      const data = await res.json();
      return data.content?.[0]?.text?.trim() ?? "{}";
    }

    const baseUrl = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com";
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: 300,
        temperature: 0.1,
      }),
    });
    if (!res.ok) return "{}";
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? "{}";
  } catch {
    return "{}";
  }
}

/**
 * Ask the AI whether the most recent action + GM narration satisfies a
 * defined ending condition. Returns NULL_RESULT on any error so the game
 * never crashes if the detection call fails.
 *
 * Skip calling this if endingConditions is blank — saves a round-trip.
 */
export async function detectEnding(
  endingConditions: string,
  recentLog: string[],
  playerAction: string,
  gmNarration: string
): Promise<EndingResult> {
  if (!endingConditions.trim()) return NULL_RESULT;

  const system = `You are an ending-condition detector for a multiplayer TRPG text adventure.

SCENARIO ENDING CONDITIONS (defined by the creator):
${endingConditions}

Determine if the latest player action and GM narration have ACTUALLY completed one of the ending conditions.

Rules:
- Be CONSERVATIVE. Only return triggered=true if the ending is clearly and unmistakably achieved.
- Do NOT trigger on partial progress, foreshadowing, near-misses, or the GM merely mentioning a related concept.
- A failure ending (party wiped, quest failed, time ran out) is also a valid trigger.
- If the action is unrelated to any ending condition, return triggered=false.

Return ONLY valid JSON, no markdown, no extra text:
{"triggered":boolean,"type":"best"|"normal"|"bad"|"failure"|null,"title":string|null,"summary":string|null}

Field rules:
- triggered: true only if an ending condition is clearly met
- type: "best" = perfect/ideal win, "normal" = standard success, "bad" = pyrrhic/bittersweet success, "failure" = defeat/death/quest failed
- title: 4-7 word ending title (e.g. "The Ritual is Complete" or "A Bitter Escape") — null if not triggered
- summary: 2-3 sentences describing how the adventure concluded, written for a closing screen — null if not triggered`;

  const user = `RECENT STORY:
${recentLog.slice(-6).join("\n")}

LATEST PLAYER ACTION: ${playerAction}
LATEST GM NARRATION: ${gmNarration}

Has an ending condition been met?`;

  try {
    let raw = await callAI(system, user);
    raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    if (!raw.startsWith("{")) {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end > start) raw = raw.slice(start, end + 1);
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed.triggered !== "boolean" || !parsed.triggered) return NULL_RESULT;
    const type: EndingType = VALID_TYPES.includes(parsed.type) ? parsed.type : "normal";
    return {
      triggered: true,
      type,
      title: typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim().slice(0, 80)
        : "The Story Ends",
      summary: typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim().slice(0, 600)
        : null,
    };
  } catch {
    return NULL_RESULT;
  }
}
