// Server-side only. Deterministic objective progress tracking.
//
// The party's progress toward the ending is stored as STRUCTURED FLAGS on the
// room, not inferred from AI memory each turn. This module provides two AI
// helpers — both narrow, single-purpose classification calls:
//
//   1. decomposeObjectives() — ONCE per room, turns a legacy scenario's
//      free-text ending_conditions into a discrete checklist of objectives.
//   2. checkObjectiveProgress() — each turn, given the CURRENTLY-INCOMPLETE
//      objectives, returns which ones THIS action just satisfied, plus a short
//      GM-internal progress note for any objective that advanced without
//      finishing (the judge's only memory across turns — see below).
//
// The "done" decision for each objective is then persisted as a permanent flag
// by the caller. Whether the GAME ends is pure code (see lib/game/endings.ts).
//
// The objective definition (id/text/required) lives in a pure, client-safe
// module so the scenario editor can share it without bundling this server-only
// file. Every objective is TEAM-WIDE: one character completing it satisfies
// the whole party.
import type { ScenarioObjective } from "@/lib/game/objectives-def";
import { thinkingFragment } from "@/lib/ai/settings";

/** A trackable objective. Same shape as the creator-defined ScenarioObjective. */
export type Objective = ScenarioObjective;

export interface ObjectiveProgressEntry {
  done: boolean;
  round: number | null;
  character: string | null;
  /**
   * Partial-progress memory for MULTI-STEP objectives ("在四個角落各放一撮米"),
   * written by the judge and read back by it next turn — otherwise a per-turn,
   * stateless judge can never see the earlier steps and the goal never
   * completes. GM-internal: it is shown to the GM so narration stays
   * consistent, never to players. Cleared once the objective is done.
   */
  note?: string | null;
}

export type ObjectiveProgress = Record<string, ObjectiveProgressEntry>;

/** What the judge decided this turn. */
export interface ObjectiveVerdict {
  /** Objective ids completed on this turn. */
  completed: string[];
  /** id → cumulative progress note, for objectives that advanced but are not done. */
  notes: Record<string, string>;
}

/** Hard cap on a stored progress note. Long notes are a sign the judge is narrating, not tracking. */
export const OBJECTIVE_NOTE_MAX = 120;

export function isObjectiveDone(progress: ObjectiveProgress, id: string): boolean {
  return progress[id]?.done === true;
}

/** Objectives still incomplete — the only ones worth asking the judge about this turn. */
export function incompleteObjectives(objectives: Objective[], progress: ObjectiveProgress): Objective[] {
  return objectives.filter((o) => !isObjectiveDone(progress, o.id));
}

/**
 * Apply the judge's verdict. Returns a NEW progress object (never mutates the
 * input) plus whether anything actually changed, so the caller can skip the DB
 * write on a no-op turn. Completion flags are permanent; a completed objective
 * drops its note. Notes only land on objectives that are NOT done, and a note
 * identical to the stored one is not a change.
 */
export function applyVerdict(
  objectives: Objective[],
  progress: ObjectiveProgress,
  verdict: ObjectiveVerdict,
  actorName: string,
  round: number
): { progress: ObjectiveProgress; changed: boolean } {
  const known = new Set(objectives.map((o) => o.id));
  const next: ObjectiveProgress = { ...progress };
  let changed = false;

  for (const id of verdict.completed) {
    if (!known.has(id) || next[id]?.done === true) continue;
    next[id] = { done: true, round, character: actorName, note: null };
    changed = true;
  }

  for (const [id, rawNote] of Object.entries(verdict.notes)) {
    if (!known.has(id) || next[id]?.done === true) continue;
    const note = rawNote.trim().slice(0, OBJECTIVE_NOTE_MAX);
    if (!note || note === (next[id]?.note ?? null)) continue;
    const prev = next[id] ?? { done: false, round: null, character: null };
    next[id] = { ...prev, note };
    changed = true;
  }

  return { progress: next, changed };
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

export async function callAI(
  system: string,
  user: string,
  maxTokens: number,
  label = "objectives",
  /** Sampling temperature. Defaults to 0.1 — right for classification, but far
   *  too rigid for anything generative (it makes repeated calls with similar
   *  inputs return near-identical text). */
  temperature = 0.1,
): Promise<string> {
  const provider = process.env.AI_PROVIDER ?? "deepseek";
  // Use AI_CLASSIFY_MODEL (fast non-thinking model) — objective checking is
  // a simple classification task; a reasoning model wastes time and budget here.
  const model = process.env.AI_CLASSIFY_MODEL ?? process.env.AI_MODEL ?? "deepseek-v4-flash";
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    // Distinguishes "AI disabled / misconfigured" from a genuine empty verdict.
    console.warn(`[${label}] callAI skipped: AI_API_KEY is not set — returning empty result.`);
    return "";
  }

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
      if (!res.ok) {
        console.error(`[${label}] callAI HTTP ${res.status} ${res.statusText} (model=${model}) — returning empty result.`);
        return "";
      }
      const data = await res.json();
      const text = data.content?.[0]?.text?.trim() ?? "";
      if (!text) {
        console.error(`[${label}] callAI got HTTP 200 but EMPTY content (model=${model}, provider=anthropic). stop_reason=${data.stop_reason} usage=${JSON.stringify(data.usage)}. If this model "thinks", maxTokens=${maxTokens} may be too small.`);
      }
      return text;
    }

    const baseOverride = process.env.AI_BASE_URL?.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    const defaultBase = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com";
    const baseUrl = baseOverride ?? defaultBase;
    // Reasoning is off by default for these classification/JSON calls: the
    // hidden tokens compete with max_tokens and can produce an HTTP 200 with
    // EMPTY content. Admin-toggleable per call site at /admin. This helper
    // serves more than one logical call site, so the site is derived from the
    // label the caller already passes.
    const site = label.startsWith("scene-choices") ? "scene_choices" : "objectives";
    const thinking = await thinkingFragment(site, provider);

    // `thinking` is resolved ONCE and reused by the retry below, which flips it
    // off. Returns the parsed body so the caller can inspect usage.
    const post = async (frag: Record<string, unknown>) => {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          max_tokens: maxTokens,
          temperature,
          ...frag,
        }),
      });
      return res;
    };

    let res = await post(thinking);
    if (!res.ok) {
      console.error(`[${label}] callAI HTTP ${res.status} ${res.statusText} (model=${model}) — returning empty result.`);
      return "";
    }
    let data = await res.json();
    let content = data.choices?.[0]?.message?.content?.trim() ?? "";

    // SELF-HEAL: on DeepSeek, max_tokens covers reasoning AND content, so a
    // reasoning model can burn the entire budget thinking and return 200 with
    // an empty string (finish_reason "length", reasoning_tokens == the whole
    // completion). That is not a transient failure — retrying the SAME request
    // reproduces it exactly, which is why the caller's retry loop never helped.
    // Retry once with reasoning explicitly off, which is what these calls want
    // anyway. This fires whatever the cause: an admin left the site's toggle
    // on, or the provider ignored our disable flag for this model.
    const burnedOnReasoning = Number(data.usage?.completion_tokens_details?.reasoning_tokens ?? 0);
    if (!content && burnedOnReasoning > 0) {
      console.warn(
        `[${label}] callAI: reasoning consumed ${burnedOnReasoning}/${maxTokens} tokens and left no content ` +
        `(thinking was ${Object.keys(thinking).length === 0 ? "ENABLED" : "explicitly disabled"} for site "${site}"). ` +
        `Retrying once with reasoning forced off.`
      );
      const retry = await post({ thinking: { type: "disabled" } });
      if (retry.ok) {
        data = await retry.json();
        content = data.choices?.[0]?.message?.content?.trim() ?? "";
        if (content) return content;
      }
    }

    if (!content) {
      const choice = data.choices?.[0];
      console.error(`[${label}] callAI got HTTP 200 but EMPTY content (model=${model}, provider=${provider}, thinking=${Object.keys(thinking).length === 0 ? "enabled" : "disabled"}). finish_reason=${choice?.finish_reason} usage=${JSON.stringify(data.usage)} apiError=${JSON.stringify(data.error ?? null)}. If finish_reason="length" or this model "thinks", maxTokens=${maxTokens} is too small; if the model name is wrong the provider may return an error/empty body.`);
    }
    return content;
  } catch (err) {
    console.error(`[${label}] callAI threw (model=${model}):`, err instanceof Error ? err.message : err);
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

Every objective is TEAM-WIDE (any one character completing it counts for the whole party).
Each objective must be a single concrete, observable accomplishment that can be judged true/false from the story (e.g. "Retrieve the Sunstone from the altar", "Defeat the gatekeeper", "All survivors escape through the north gate").

REQUIRED vs OPTIONAL — this is critical:
- Default EVERY objective to "required": true.
- Only set "required": false when the source text EXPLICITLY marks it as optional, bonus, secondary, "for extra credit", "if you want", or similar. If in doubt, it is REQUIRED.
- Never downgrade a core win condition to optional just because it seems hard or secondary.


Other rules:
- Split compound conditions ("do X and Y") into SEPARATE objectives.
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
 * action + GM narration just satisfied, and record partial progress on the
 * ones that advanced without finishing.
 *
 * This is a per-action classification: completed objectives are already
 * flagged in state and are NOT passed in, so the judge never has to remember
 * which goals are done. The ONE thing it must remember is partial progress on
 * multi-step goals — that is what the progress note is for: the judge reads
 * last turn's note and writes back a cumulative one. A note is memory only; it
 * never completes anything by itself.
 */
export async function checkObjectiveProgress(
  incomplete: Objective[],
  recentLog: string[],
  playerAction: string,
  actingCharacter: string,
  gmNarration: string,
  progress: ObjectiveProgress
): Promise<ObjectiveVerdict> {
  const none: ObjectiveVerdict = { completed: [], notes: {} };
  if (incomplete.length === 0) return none;

  const checklist = incomplete
    .map((o) => {
      const note = progress[o.id]?.note;
      return `- ${o.id}: ${o.text}${note ? `\n    PROGRESS SO FAR: ${note}` : ""}`;
    })
    .join("\n");

  const system = `You are an objective-completion judge for a multiplayer RPG. You are given the CURRENTLY-INCOMPLETE objectives (each with any PROGRESS SO FAR recorded on earlier turns), plus ${actingCharacter}'s most recent action and the GM's narration of its outcome. Every objective is team-wide: any character completing it counts for the whole party. Decide (a) which objectives were JUST and ACTUALLY completed on THIS turn, and (b) for multi-step objectives that advanced but did not finish, what the cumulative progress now is.

Mark an objective COMPLETE when ALL of these hold:
1. The accomplishment was actually CARRIED OUT in the fiction this turn — not merely planned, suggested, proposed, agreed, intended, promised, or said they would do it later.
2. The GM NARRATION describes events in which the attempt SUCCEEDS. IMPORTANT: the GM is forbidden from naming or announcing objectives, so do NOT wait for the GM to say a goal is "complete" or to restate the objective's wording. Judge from the concrete events the narration describes: if those events amount to the objective being achieved, it counts. It does NOT count only when a dice check explicitly FAILED, or the narration shows the attempt blocked, interrupted, refused, undone, or left unresolved.
3. The accomplishment matches the objective's concrete meaning — not a vaguely related or symbolic gesture.
4. For a multi-step objective, PROGRESS SO FAR plus this turn's events together cover EVERY step. Earlier steps recorded in PROGRESS SO FAR count as done; do not require them to be re-shown this turn.

DO NOT mark complete for any of these (common false positives):
- Only talking about, planning, or deciding to do the objective (with no narrated success this turn).
- The GM merely mentioning, foreshadowing, or describing the objective's existence without it actually happening.
- Being near, on the way to, or only partway through it (record that in "progress" instead).
- A dice check for the action FAILED, or the narration says the attempt did not work.

PROGRESS NOTES — for objectives NOT completed this turn:
- Add an entry in "progress" ONLY when this turn made concrete, narrated headway on a multi-step objective (e.g. one of several items placed, two of three witnesses questioned). No entry for plans, intentions, or failed attempts.
- The note is CUMULATIVE: merge PROGRESS SO FAR with this turn's headway into one short factual line (under 60 characters, same language as the objective). Example: "已放米：東北角、西南角（2/4）".
- Omit an objective from "progress" to keep its existing note unchanged. Never write a note for an objective you list in "completed".
- A note is memory only. It never makes an objective complete.

Be fair, not paranoid: when the action plainly does the thing and the narration shows it working out, CREDIT it — do not withhold completion just because the GM phrased the success indirectly. But never invent a success the narration does not support. Completing ZERO objectives on a turn is normal and fine.
Never invent objective ids. Only use ids from the list.

Return ONLY valid JSON, no markdown:
{"completed":["obj_id", ...],"progress":{"obj_id":"cumulative note", ...}}  // both may be empty`;

  const user = `INCOMPLETE OBJECTIVES:
${checklist}

RECENT STORY (context only — do NOT judge completion from this):
${recentLog.slice(-6).join("\n")}

THIS TURN —
${actingCharacter}'s ACTION: ${playerAction}
GM NARRATION OF OUTCOME: ${gmNarration}

Which objectives were ACTUALLY completed THIS turn, and which multi-step ones advanced? Be strict.`;

  // Observability: every no-completion turn should explain WHY (model error vs.
  // bad JSON vs. ids filtered out vs. a genuine "nothing done"), so a creator
  // reporting "objectives never fire" can be diagnosed from logs instead of
  // guessing. Keyed by acting character + the objective ids it was asked about.
  const askedIds = incomplete.map((o) => o.id).join(",");
  const tag = `objectives:check actor=${actingCharacter} asked=[${askedIds}] action=${JSON.stringify(playerAction.slice(0, 120))} narration=${JSON.stringify(gmNarration.slice(0, 400))}`;

  // 800 (not ~50 the JSON needs): if AI_CLASSIFY_MODEL is a reasoning model,
  // hidden thinking tokens are drawn from this budget BEFORE any visible JSON is
  // emitted, so too small a cap yields an empty 200 response. Tunable via env.
  const raw = await callAI(system, user, Number(process.env.AI_CLASSIFY_MAX_TOKENS) || 800, "objectives:check");
  if (!raw) {
    console.warn(`[${tag}] no verdict — callAI returned empty (model error or AI disabled). Treating as none completed.`);
    return none;
  }
  try {
    const parsed = JSON.parse(extractJSON(raw));
    const validIds = new Set(incomplete.map((o) => o.id));

    const ids = Array.isArray(parsed?.completed) ? parsed.completed : [];
    const completed = ids.filter((id: unknown): id is string => typeof id === "string" && validIds.has(id));
    const rejected = ids.filter((id: unknown) => !(typeof id === "string" && validIds.has(id)));
    if (rejected.length > 0) {
      console.warn(`[${tag}] judge returned ids not on the incomplete list (ignored): ${JSON.stringify(rejected)}`);
    }

    const notes: Record<string, string> = {};
    const rawNotes = parsed?.progress && typeof parsed.progress === "object" ? parsed.progress : {};
    for (const [id, v] of Object.entries(rawNotes)) {
      if (!validIds.has(id) || completed.includes(id) || typeof v !== "string" || !v.trim()) continue;
      notes[id] = v.trim().slice(0, OBJECTIVE_NOTE_MAX);
    }

    console.info(
      `[${tag}] verdict completed=${JSON.stringify(completed)}` +
      `${Object.keys(notes).length ? ` progress=${JSON.stringify(notes)}` : ""}` +
      `${completed.length === 0 && Object.keys(notes).length === 0 ? " (genuine none)" : ""}`
    );
    return { completed, notes };
  } catch (err) {
    console.error(`[${tag}] could not parse judge JSON — treating as none completed. error=${err instanceof Error ? err.message : err} raw=${JSON.stringify(raw.slice(0, 300))}`);
    return none;
  }
}
