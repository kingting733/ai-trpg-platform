import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  missionByKey,
  failPoints,
  interludeGrowth,
  pickMissionNarration,
  INTERLUDE_WEEKLY_GROWTH_CAP,
} from "@/lib/game/interlude";

const d = (sides: number) => Math.floor(Math.random() * sides) + 1;

/**
 * Claim a finished interlude mission. The outcome is rolled ONCE here and
 * stored on the row — re-claiming returns the stored result (no reroll by
 * refresh). Success → full points + growth check (+1, weekly cap per card).
 * Fail → 10% points, no growth. Nothing is ever lost.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { missionId } = (await req.json()) as { missionId?: string };
  if (!missionId) return NextResponse.json({ error: "缺少任務。" }, { status: 400 });

  const { data: row } = await supabase
    .from("card_missions")
    .select("*")
    .eq("id", missionId)
    .single();
  if (!row) return NextResponse.json({ error: "找不到任務。" }, { status: 404 });
  if (row.user_id !== user.id) return NextResponse.json({ error: "這不是你的任務。" }, { status: 403 });
  if (row.claimed_at) {
    // Idempotent: hand back the stored outcome instead of rolling again.
    return NextResponse.json({ alreadyClaimed: true, outcome: row.outcome ?? null });
  }
  if (Date.now() < new Date(row.claimable_at).getTime()) {
    return NextResponse.json({ error: "任務尚未完成，還未能領取。" }, { status: 400 });
  }
  const mission = missionByKey(row.mission_type);
  if (!mission) return NextResponse.json({ error: "未知的任務類型。" }, { status: 500 });

  // === Roll the outcome (server-side, once) ===
  const roll = d(100);
  const success = roll <= row.success_rate;
  const points = success ? row.points_on_success : failPoints(row.points_on_success);

  // Growth check — success only, capped per card per rolling week.
  let growth: any = null;
  if (success) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("card_missions")
      .select("outcome")
      .eq("card_id", row.card_id)
      .gte("claimed_at", weekAgo);
    const gainsThisWeek = (recent ?? []).filter((m: any) => Number(m?.outcome?.growth?.gain) > 0).length;
    if (gainsThisWeek >= INTERLUDE_WEEKLY_GROWTH_CAP) {
      growth = { capped: true };
    } else {
      const { data: card } = await supabase
        .from("character_cards")
        .select("id, name, skills, dex, app")
        .eq("id", row.card_id)
        .single();
      if (card) {
        const { currentSkillValue } = await import("@/lib/game/skills");
        const oldValue = currentSkillValue(row.growth_skill, card.skills ?? null, { dex: card.dex ?? 50, app: card.app ?? 50 });
        growth = interludeGrowth(row.growth_skill, oldValue, d(100));
        if (growth.gain > 0) {
          const newSkills = { ...((card.skills as Record<string, number>) ?? {}), [row.growth_skill]: growth.new };
          const { error: skillErr } = await supabase
            .from("character_cards")
            .update({ skills: newSkills })
            .eq("id", card.id);
          if (skillErr) {
            console.error("[interlude] growth skill update failed:", skillErr.message);
            growth = { ...growth, gain: 0, new: oldValue, apply_failed: true };
          }
        }
      }
    }
  }

  // Character name for the story.
  const { data: cardName } = await supabase
    .from("character_cards").select("name").eq("id", row.card_id).single();
  const charName = cardName?.name ?? "調查員";

  // Preset narration — no AI call.
  const narration = pickMissionNarration(mission.key, charName, success);

  const outcome = { roll, success, points, growth, narration };

  // Mark claimed FIRST with a guard on unclaimed — a concurrent double-claim
  // loses this update and takes the alreadyClaimed path on retry.
  const { data: updated } = await supabase
    .from("card_missions")
    .update({ claimed_at: new Date().toISOString(), outcome })
    .eq("id", row.id)
    .is("claimed_at", null)
    .select("id");
  if (!updated || updated.length === 0) {
    const { data: again } = await supabase.from("card_missions").select("outcome").eq("id", row.id).single();
    return NextResponse.json({ alreadyClaimed: true, outcome: again?.outcome ?? null });
  }

  // Credit the wallet (after the claim is locked in).
  const { data: u } = await supabase.from("users").select("points").eq("id", user.id).single();
  const { error: ptsErr } = await supabase
    .from("users")
    .update({ points: (u?.points ?? 0) + points })
    .eq("id", user.id);
  if (ptsErr) console.error("[interlude] points credit failed:", ptsErr.message);

  return NextResponse.json({ outcome });
}
