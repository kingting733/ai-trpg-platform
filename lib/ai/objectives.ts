// Server-side only. Deterministic objective progress tracking.
//
// The party's progress toward the ending is stored as STRUCTURED FLAGS on the
// room, not inferred from AI memory each turn. This module provides two AI
// helpers — both narrow, single-purpose classification calls:
//
//   1. decomposeObjectives() — ONCE per room, turns the creator's free-text
//      ending_conditions into a discrete checklist of objectives.
//   2. checkObjectiveProgress() — each turn, given the CURRENTLY-INCOMPLETE
//      objectives, returns which ones THIS action just satisfied.
//
// The "done" decision for each objective is then persisted as a permanent flag
// by the caller. Whether the GAME ends is pure code (see allRequiredDone).

export interface Objective {
  id: string;
  text: string;
  required: boolean;
}

export interface ObjectiveProgressEntry {
  done: boolean;
  round: number;
  character: string | null;
}

export type ObjectiveProgress = Record<string, ObjectiveProgressEntry>;

const LANGUAGE_LABELS: Record<string, string> = {
  "zh-TW": "Traditional Chinese (繁體中文)",
  "zh-CN": "Simplified Chinese (简体中文)",
  "en": "English",
  "ja": "Japanese (日本語)",
  "ko": "Korean (한국어)",
};

function langLabel(language?: string | null): string | null {
  if (!language || language === "auto") return null;
  return LANGUAGE_LABELS[language] ?? language;
}

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

    const baseUrl = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com";
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens,
        temperature: 0.1,
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
  if (!s.startsWith("{") && !s.startsWith("[")) {
    // find the first { or [ and matching close
    const starts = [s.indexOf("{"), s.indexOf("[")].filter((i) => i !== -1);
    const start = starts.length ? Math.min(...starts) : -1;
    const ends = [s.lastIndexOf("}"), s.lastIndexOf("]")];
    const end = Math.max(...ends);
    if (start !== -1 && end > start) s = s.slice(start, end + 1);
  }
  return s;
}

/**
 * Decompose the creator's free-text ending conditions into a discrete checklist.
 * Called ONCE per room (result is cached on rooms.objectives). Returns [] if the
 * conditions are blank or the AI fails — callers then fall back to legacy
 * free-text ending detection.
 */
export async function decomposeObjectives(
  endingConditions: string,
  language?: string | null
): Promise<Objective[]> {
  if (!endingConditions.trim()) return [];

  const label = langLabel(language);
  const langRule = label
    ? `\nWrite each objective's "text" in ${label}.`
    : "";

  const system = `You break a tabletop RPG scenario's victory/ending conditions into a checklist of discrete, independently-checkable objectives.
${langRule}

Each objective must be a single concrete, observable accomplishment that can be judged true/false from the story (e.g. "Retrieve the Sunstone from the altar", "Defeat the gatekeeper", "All survivors escape through the north gate").

Rules:
- Split compound conditions ("do X and Y") into SEPARATE objectives.
- Mark "required": true if this objective MUST be done to reach the main/winning ending. Mark "required": false only for optional/bonus goals.
- Produce 1-6 objectives. Keep each text short (one sentence).
- Do NOT invent objectives not implied by the conditions.

Return ONLY valid JSON, no markdown:
{"objectives":[{"text":"...","required":true},{"text":"...","required":false}]}`;

  const user = `ENDING / VICTORY CONDITIONS:\n${endingConditions}\n\nBreak these into a checklist.`;

  const raw = await callAI(system, user, 600);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(extractJSON(raw));
    const list = Array.isArray(parsed?.objectives) ? parsed.objectives : [];
    return list
      .map((o: any, i: number): Objective | null => {
        const text = typeof o?.text === "string" ? o.text.trim() : "";
        if (!text) return null;
        return {
          id: `obj_${i + 1}`,
          text: text.slice(0, 200),
          required: o?.required !== false, // default required
        };
      })
      .filter((o: Objective | null): o is Objective => o !== null)
      .slice(0, 6);
  } catch {
    return [];
  }
}

/**
 * Given the objectives that are STILL INCOMPLETE, decide which ones the latest
 * action + GM narration just satisfied. Returns the list of newly-completed
 * objective ids. The caller persists these as permanent flags.
 *
 * This is intentionally a per-action classification — it never has to remember
 * earlier turns, because completed objectives are already flagged in state and
 * are NOT passed in here.
 */
export async function checkObjectiveProgress(
  incompleteObjectives: Objective[],
  recentLog: string[],
  playerAction: string,
  actingCharacter: string,
  gmNarration: string
): Promise<string[]> {
  if (incompleteObjectives.length === 0) return [];

  const checklist = incompleteObjectives
    .map((o) => `- ${o.id}: ${o.text}`)
    .join("\n");

  const system = `You are a precise objective-completion judge for a multiplayer RPG.

You are given a list of CURRENTLY-INCOMPLETE objectives, and the most recent player action with the GM's narration of its outcome. Decide which objectives (if any) were JUST completed by this action and its narrated outcome.

Rules:
- Only mark an objective complete if the action + narration CLEARLY and CONCRETELY accomplished it. Not "attempted", not "is close to", not "mentioned".
- The narration is the source of truth for what actually happened (dice may have made the action fail).
- It is normal to complete ZERO objectives on a turn. Be strict.
- Never invent objective ids. Only use ids from the list.

Return ONLY valid JSON, no markdown:
{"completed":["obj_id", ...]}  // empty array if none`;

  const user = `INCOMPLETE OBJECTIVES:
${checklist}

RECENT STORY (context):
${recentLog.slice(-6).join("\n")}

LATEST ACTION by ${actingCharacter}: ${playerAction}
GM NARRATION OF OUTCOME: ${gmNarration}

Which of the incomplete objectives did THIS outcome just complete?`;

  const raw = await callAI(system, user, 200);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(extractJSON(raw));
    const ids = Array.isArray(parsed?.completed) ? parsed.completed : [];
    const validIds = new Set(incompleteObjectives.map((o) => o.id));
    return ids.filter((id: any): id is string => typeof id === "string" && validIds.has(id));
  } catch {
    return [];
  }
}

/** Pure code: are all REQUIRED objectives flagged done? */
export function allRequiredDone(objectives: Objective[], progress: ObjectiveProgress): boolean {
  const required = objectives.filter((o) => o.required);
  if (required.length === 0) return false; // nothing to satisfy → never auto-ends here
  return required.every((o) => progress[o.id]?.done === true);
}

/** Count of completed objectives, for UI / logging. */
export function completedCount(objectives: Objective[], progress: ObjectiveProgress): number {
  return objectives.filter((o) => progress[o.id]?.done === true).length;
}

/**
 * Once the deterministic check confirms all required objectives are done,
 * generate a closing title + summary in the scenario language. Has a safe
 * fallback so the ending always fires even if the AI call fails.
 */
export async function generateVictoryNarration(
  scenarioTitle: string,
  objectives: Objective[],
  recentLog: string[],
  language?: string | null
): Promise<{ type: "best" | "normal" | "bad"; title: string; summary: string }> {
  const isZh = language === "zh-TW" || language === "zh-CN";
  const fallback = isZh
    ? { type: "normal" as const, title: "任務達成", summary: "隊伍齊心協力，完成了所有目標，冒險就此圓滿落幕。" }
    : { type: "normal" as const, title: "The Quest Complete", summary: "Through their combined efforts, the party achieved every objective and brought the adventure to a triumphant close." };

  const label = langLabel(language);
  const langRule = label ? `\nWrite "title" and "summary" in ${label}.` : "";
  const goalList = objectives.filter((o) => o.required).map((o) => `- ${o.text}`).join("\n");

  const system = `You write the closing screen for a completed multiplayer RPG adventure. The party has just accomplished ALL required objectives, so this is a WINNING ending.${langRule}

Return ONLY valid JSON, no markdown:
{"type":"best"|"normal"|"bad","title":string,"summary":string}
- type: "best" = flawless/ideal victory, "normal" = solid success, "bad" = costly/bittersweet victory. Default "normal".
- title: 4-7 word ending title.
- summary: 2-3 sentences describing how the adventure concluded.`;

  const user = `ADVENTURE: ${scenarioTitle}
COMPLETED OBJECTIVES:
${goalList}

RECENT STORY:
${recentLog.slice(-6).join("\n")}

Write the victory closing screen.`;

  const raw = await callAI(system, user, 300);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(extractJSON(raw));
    const type = parsed?.type === "best" || parsed?.type === "bad" ? parsed.type : "normal";
    return {
      type,
      title: typeof parsed?.title === "string" && parsed.title.trim() ? parsed.title.trim().slice(0, 80) : fallback.title,
      summary: typeof parsed?.summary === "string" && parsed.summary.trim() ? parsed.summary.trim().slice(0, 600) : fallback.summary,
    };
  } catch {
    return fallback;
  }
}

