// Runtime AI settings — currently the per-call-site "thinking" (reasoning)
// switch, editable by an admin from /admin without a redeploy.
//
// WHY A TABLE, NOT ENV VARS: env vars are deploy-time on Vercel, so flipping
// reasoning on for one call site to compare quality would mean a redeploy per
// experiment. This keeps the toggle live.
//
// SAFE BY DEFAULT: every read is wrapped so that a missing table (the
// migration is applied manually), a missing service-role key, or any query
// error falls back to DEFAULT_THINKING — which is "disabled everywhere", i.e.
// exactly the hard-coded behaviour this replaced. The feature can never break
// an AI call.

import { createAdminClient } from "@/lib/supabase/admin";

/** One tunable AI call. Ids are stored in the DB — do not rename casually. */
export type AiCallSite =
  | "gm"
  | "scene_choices"
  | "objectives"
  | "summarize"
  | "detect_ending"
  | "ending_narration"
  | "import_scenario"
  | "daily_scenario";

export const AI_CALL_SITES: Array<{ id: AiCallSite; label: string; hint: string }> = [
  { id: "gm",               label: "GM 敘事（主要）",   hint: "每回合的主要敘事串流。開啟推理會延後第一個字出現，並可能撞上 Vercel 時限。" },
  { id: "scene_choices",    label: "建議行動（分隊）",   hint: "分隊時為另一位玩家產生的 3 個選項。" },
  { id: "objectives",       label: "任務目標判定",       hint: "判斷目標是否完成的分類呼叫。" },
  { id: "summarize",        label: "劇情摘要",           hint: "壓縮長劇情用的便宜呼叫（max_tokens 很小，開啟推理極可能回傳空白）。" },
  { id: "detect_ending",    label: "結局偵測",           hint: "判斷是否觸發結局的 JSON 分類呼叫。" },
  { id: "ending_narration", label: "結局敘事",           hint: "產生結局文字。" },
  { id: "import_scenario",  label: "劇本匯入分析",       hint: "把故事文件轉成劇本 JSON。推理會與 JSON 搶 token 額度，可能造成截斷。" },
  { id: "daily_scenario",   label: "每日劇本生成",       hint: "每日自動生成劇本。有逾時限制，開啟推理風險較高。" },
];

/** true = allow the model to think (reasoning); false = explicitly disabled. */
export type AiThinkingConfig = Record<AiCallSite, boolean>;

/** Reasoning off everywhere — the behaviour before this setting existed. */
export const DEFAULT_THINKING: AiThinkingConfig = AI_CALL_SITES.reduce(
  (acc, s) => ({ ...acc, [s.id]: false }),
  {} as AiThinkingConfig
);

export function coerceThinkingConfig(raw: any): AiThinkingConfig {
  const out = { ...DEFAULT_THINKING };
  if (raw && typeof raw === "object") {
    for (const site of AI_CALL_SITES) {
      if (typeof raw[site.id] === "boolean") out[site.id] = raw[site.id];
    }
  }
  return out;
}

// Cached so a per-turn AI call never pays for an extra round-trip. Serverless
// instances each hold their own copy, so an admin change propagates within
// roughly one TTL — surfaced in the admin UI so the delay isn't a mystery.
export const THINKING_CACHE_TTL_MS = 20_000;

export interface ThinkingStatus {
  config: AiThinkingConfig;
  /** False when the ai_settings table is unreachable — almost always because
   *  add_ai_settings.sql has not been run yet. Reads still work (defaults);
   *  SAVES cannot, so the admin UI must warn up front rather than only
   *  surfacing a raw Postgres error after the user clicks save. */
  available: boolean;
  reason?: string;
}

let cached: { status: ThinkingStatus; at: number } | null = null;

/** Drop the in-process cache (used by the admin save route). */
export function invalidateThinkingCache(): void {
  cached = null;
}

/** True for the "table isn't there" family of errors (PostgREST 42P01 /
 *  "schema cache" / "does not exist"), as opposed to a real outage. */
export function isMissingTableError(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === "42P01" || e.code === "PGRST205") return true;
  const m = (e.message ?? "").toLowerCase();
  return m.includes("schema cache") || m.includes("does not exist");
}

/** Config + whether the table is actually reachable. Never throws. */
export async function getThinkingStatus(): Promise<ThinkingStatus> {
  const now = Date.now();
  if (cached && now - cached.at < THINKING_CACHE_TTL_MS) return cached.status;
  let status: ThinkingStatus;
  try {
    const { data, error } = await createAdminClient()
      .from("ai_settings")
      .select("thinking")
      .eq("id", 1)
      .maybeSingle();
    // A missing table / row is expected before the migration is applied.
    status = error
      ? { config: DEFAULT_THINKING, available: false, reason: error.message }
      : { config: coerceThinkingConfig(data?.thinking), available: true };
  } catch (e: any) {
    status = { config: DEFAULT_THINKING, available: false, reason: e?.message ?? "unavailable" };
  }
  cached = { status, at: now };
  return status;
}

/** Current config. Never throws — falls back to DEFAULT_THINKING. */
export async function getThinkingConfig(): Promise<AiThinkingConfig> {
  return (await getThinkingStatus()).config;
}

/**
 * The provider request-body fragment for a call site. Spread it into the JSON
 * body:  `...(await thinkingFragment("gm", provider))`
 *
 * Only DeepSeek is affected: `thinking` is a DeepSeek field (an OpenAI request
 * would 400 on it), and DeepSeek V4 defaults to reasoning ON — so "enabled"
 * means simply omitting the flag, and "disabled" means sending it explicitly.
 */
export async function thinkingFragment(
  site: AiCallSite,
  provider: string
): Promise<Record<string, unknown>> {
  if (provider !== "deepseek") return {};
  const cfg = await getThinkingConfig();
  return cfg[site] ? {} : { thinking: { type: "disabled" } };
}
