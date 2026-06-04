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

// scope:
//   "party"       — one character completing it satisfies the whole objective.
//   "each_player" — EVERY player character must complete it individually
//                   (e.g. "each player confesses their own sin"). One player
//                   doing it does NOT complete it for the others.
export type ObjectiveScope = "party" | "each_player";

export interface Objective {
  id: string;
  text: string;
  required: boolean;
  scope: ObjectiveScope;
}

export interface ObjectiveProgressEntry {
  done: boolean;
  round: number | null;
  character: string | null;
  // each_player scope: per-character completion. characterName -> round completed.
  by: Record<string, number>;
}

export type ObjectiveProgress = Record<string, ObjectiveProgressEntry>;

function emptyEntry(): ObjectiveProgressEntry {
  return { done: false, round: null, character: null, by: {} };
}

/** Has this specific character already completed the objective? */
export function isDoneForCharacter(
  obj: Objective,
  progress: ObjectiveProgress,
  characterName: string
): boolean {
  const entry = progress[obj.id];
  if (!entry) return false;
  if (obj.scope === "each_player") return entry.by?.[characterName] != null;
  return entry.done === true;
}

/**
 * Objectives still incomplete FOR THIS ACTOR — the only ones worth asking the
 * classifier about this turn. For party scope, that's any not-yet-done objective;
 * for each_player scope, any objective this actor personally hasn't done yet.
 */
export function incompleteForActor(
  objectives: Objective[],
  progress: ObjectiveProgress,
  actorName: string
): Objective[] {
  return objectives.filter((o) => !isDoneForCharacter(o, progress, actorName));
}

/**
 * Apply the classifier's verdict for one actor. Returns a NEW progress object
 * with permanent flags set. For each_player objectives, records this actor's
 * personal completion and only flips `done` once every living player has done it.
 */
export function applyCompletions(
  objectives: Objective[],
  progress: ObjectiveProgress,
  completedIds: string[],
  actorName: string,
  round: number,
  livingPlayerNames: string[]
): ObjectiveProgress {
  const next: ObjectiveProgress = { ...progress };
  for (const id of completedIds) {
    const obj = objectives.find((o) => o.id === id);
    if (!obj) continue;
    const entry = next[id] ? { ...next[id], by: { ...next[id].by } } : emptyEntry();

    if (obj.scope === "each_player") {
      if (entry.by[actorName] == null) entry.by[actorName] = round;
      // Done only when every currently-living player has personally completed it.
      const needed = livingPlayerNames.length > 0 ? livingPlayerNames : Object.keys(entry.by);
      entry.done = needed.every((n) => entry.by[n] != null);
      if (entry.done && entry.round == null) entry.round = round;
    } else {
      entry.done = true;
      entry.round = round;
      entry.character = actorName;
    }
    next[id] = entry;
  }
  return next;
}

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

REQUIRED vs OPTIONAL — this is critical:
- Default EVERY objective to "required": true.
- Only set "required": false when the source text EXPLICITLY marks it as optional, bonus, secondary, "for extra credit", "if you want", or similar. If in doubt, it is REQUIRED.
- Never downgrade a core win condition to optional just because it seems hard or secondary.

SCOPE — party vs each_player:
- "scope": "each_player" when the condition requires EVERY player/character to do it individually — signalled by wording like "each player", "every character", "both players", "everyone must", "each must confess / pay their own debt / complete their own ritual step". One player doing it does NOT satisfy it for the others.
- "scope": "party" when a single character accomplishing it satisfies the whole group (the default for most objectives).

Other rules:
- Split compound conditions ("do X and Y") into SEPARATE objectives.
- Produce 1-6 objectives. Keep each text short (one sentence).
- Do NOT invent objectives not implied by the conditions.

Return ONLY valid JSON, no markdown:
{"objectives":[{"text":"...","required":true,"scope":"party"},{"text":"...","required":true,"scope":"each_player"}]}`;

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
          scope: o?.scope === "each_player" ? "each_player" : "party",
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
    .map((o) => `- ${o.id}: ${o.text}${o.scope === "each_player" ? " [must be done by THIS character personally]" : ""}`)
    .join("\n");

  const system = `You are a STRICT objective-completion judge for a multiplayer RPG. Your default answer is that nothing was completed. Only confirm a completion when the evidence is unambiguous.

You are given the CURRENTLY-INCOMPLETE objectives, plus ${actingCharacter}'s most recent action and the GM's narration of its outcome. Decide which objectives — if any — were JUST and ACTUALLY completed by ${actingCharacter} on THIS turn.

MARK COMPLETE ONLY IF ALL of these hold:
1. ${actingCharacter} PHYSICALLY PERFORMED the accomplishment this turn — not merely planned, suggested, proposed, agreed, intended, promised, or discussed it.
2. The GM NARRATION explicitly confirms the accomplishment actually happened and SUCCEEDED. If a dice check failed or the outcome is uncertain/partial, it is NOT complete.
3. The accomplishment matches the objective's concrete meaning — not a vaguely related or symbolic gesture.

DO NOT mark complete for any of these (common false positives):
- Talking about, planning, or deciding to do the objective.
- Another character doing it (for [must be done by THIS character personally] objectives, only ${actingCharacter}'s OWN completion counts).
- The GM merely mentioning, foreshadowing, or describing the objective's existence.
- Being near, on the way to, or partway through it.

It is normal and expected to complete ZERO objectives on a turn. When unsure, return none.
Never invent objective ids. Only use ids from the list.

Return ONLY valid JSON, no markdown:
{"completed":["obj_id", ...]}  // empty array if none`;

  const user = `INCOMPLETE OBJECTIVES (for ${actingCharacter} this turn):
${checklist}

RECENT STORY (context only — do NOT judge completion from this):
${recentLog.slice(-6).join("\n")}

THIS TURN —
${actingCharacter}'s ACTION: ${playerAction}
GM NARRATION OF OUTCOME: ${gmNarration}

Which objectives did ${actingCharacter} ACTUALLY complete THIS turn? Be strict.`;

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

/**
 * Pure code: are all REQUIRED objectives flagged done?
 * For each_player objectives, "done" already means every living player completed
 * it (see applyCompletions), so checking the flag is sufficient here.
 */
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

