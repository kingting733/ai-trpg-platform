// Server-only orchestration for the daily scenario job. Shared by the Vercel
// cron route and the admin "generate now" button. Uses the SERVICE-ROLE client
// so it can write a scenario owned by the system user with RLS bypassed.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateDailyScenario,
  coerceSeedConfig,
  DEFAULT_SEED_CONFIG,
} from "@/lib/ai/daily-scenario";

// The system user seeded by add_daily_scenarios.sql.
export const DAILY_SYSTEM_USER_ID = "00000000-0000-0000-0000-00000000da11";

/** YYYY-MM-DD for the given instant in Hong Kong time (UTC+8). "Today" for the
 *  daily scenario is defined by the HKT calendar day, matching the 00:00 HKT
 *  publish schedule. */
export function hktDateStr(now: Date = new Date()): string {
  const hkt = new Date(now.getTime() + 8 * 3600 * 1000);
  return hkt.toISOString().slice(0, 10);
}

export interface DailyRunResult {
  status: "created" | "exists" | "error";
  scenarioId?: string;
  title?: string;
  date: string;
  usedCustomIdea?: boolean;
  message?: string;
}

/**
 * Generate today's daily scenario and store it as a DRAFT awaiting admin
 * approval. Idempotent: if a daily scenario already exists for today it returns
 * { status: "exists" } unless `force` is true.
 */
export async function runDailyGeneration(opts: { force?: boolean } = {}): Promise<DailyRunResult> {
  const admin = createAdminClient();
  const date = hktDateStr();

  // 1. Idempotency — one daily per HKT calendar day unless forced.
  if (!opts.force) {
    const { data: existing } = await admin
      .from("scenarios")
      .select("id, title")
      .eq("is_daily", true)
      .eq("daily_date", date)
      .maybeSingle();
    if (existing) {
      return { status: "exists", scenarioId: existing.id, title: existing.title, date };
    }
  }

  // 2. Load the editable seed config (fall back to defaults).
  const { data: cfgRow } = await admin
    .from("daily_seed_config")
    .select("config")
    .eq("id", 1)
    .maybeSingle();
  const config = coerceSeedConfig(cfgRow?.config ?? DEFAULT_SEED_CONFIG);
  const usedCustomIdea = config.today_idea.trim().length > 0;

  // 3. Generate.
  const { scenario } = await generateDailyScenario(config, new Date(), date);

  // 4. If forcing a regenerate, drop any existing draft for today so the unique
  //    index doesn't reject the insert.
  if (opts.force) {
    await admin.from("scenarios").delete().eq("is_daily", true).eq("daily_date", date);
  }

  // 5. Persist as a DRAFT owned by the system user — same columns a hand-made
  //    scenario uses, so it opens cleanly in the 建立劇本 editor.
  const { data: inserted, error } = await admin
    .from("scenarios")
    .insert({
      creator_id: DAILY_SYSTEM_USER_ID,
      title: scenario.title,
      genre: scenario.genre,
      difficulty: scenario.difficulty,
      description: scenario.description,
      objective: scenario.objective,
      max_players: scenario.max_players,
      estimated_play_time: scenario.estimated_play_time,
      tags: scenario.tags,
      opening_scene: scenario.opening_scene,
      locations: scenario.locations,
      npcs: scenario.npcs,
      winning_targets: scenario.winning_targets,
      each_player_targets: scenario.each_player_targets,
      failure_conditions: scenario.failure_conditions,
      failure_turn_limit: scenario.failure_turn_limit,
      ending_conditions: scenario.ending_conditions,
      gm_notes: scenario.gm_notes,
      status: "draft",        // <-- NOT published; waits for admin approval
      is_daily: true,
      daily_date: date,
    })
    .select("id, title")
    .single();

  if (error) {
    return { status: "error", date, message: error.message };
  }

  // 6. Consume a one-off custom idea so tomorrow returns to normal rotation.
  if (usedCustomIdea) {
    await admin
      .from("daily_seed_config")
      .update({ config: { ...config, today_idea: "" }, updated_at: new Date().toISOString() })
      .eq("id", 1);
  }

  return {
    status: "created",
    scenarioId: inserted.id,
    title: inserted.title,
    date,
    usedCustomIdea,
  };
}
