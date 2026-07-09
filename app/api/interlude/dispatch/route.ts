import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  missionByKey,
  bestRelevantSkill,
  successRate,
  pointsFor,
  missionDurationMs,
} from "@/lib/game/interlude";

/**
 * Dispatch a character card on a 24h interlude mission.
 * Server-authoritative: rate / points / growth skill are computed HERE from the
 * card's skills and snapshotted onto the row, so growth mid-mission can never
 * retroactively change an in-flight mission. Rejects: card not owned, card in
 * an active room, user already has an active mission.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { cardId, missionType } = (await req.json()) as { cardId?: string; missionType?: string };
  const mission = missionType ? missionByKey(missionType) : null;
  if (!cardId || !mission) return NextResponse.json({ error: "缺少調查員或任務類型。" }, { status: 400 });

  const { data: card } = await supabase
    .from("character_cards")
    .select("id, user_id, name, skills, dex, app")
    .eq("id", cardId)
    .single();
  if (!card) return NextResponse.json({ error: "找不到調查員。" }, { status: 404 });
  if (card.user_id !== user.id) return NextResponse.json({ error: "你不擁有此調查員。" }, { status: 403 });

  // The card must not be adventuring in a live room right now.
  const { data: busyRows } = await supabase
    .from("characters")
    .select("id, rooms!inner(status)")
    .eq("source_card_id", cardId)
    .in("rooms.status", ["waiting", "in_progress"]);
  if (busyRows && busyRows.length > 0) {
    return NextResponse.json({ error: "此調查員正在冒險中，無法出發幕間任務。" }, { status: 409 });
  }

  const best = bestRelevantSkill({ skills: card.skills ?? null, dex: card.dex, app: card.app }, mission);
  const rate = successRate(best.value);
  const points = pointsFor(best.value);
  const claimableAt = new Date(Date.now() + missionDurationMs()).toISOString();

  const { data: row, error } = await supabase
    .from("card_missions")
    .insert({
      card_id: card.id,
      user_id: user.id,
      mission_type: mission.key,
      success_rate: rate,
      points_on_success: points,
      growth_skill: best.key,
      claimable_at: claimableAt,
    })
    .select("id, claimable_at")
    .single();
  if (error) {
    // Unique partial index: one active mission per user.
    const dup = error.code === "23505" || /duplicate|unique/i.test(error.message);
    return NextResponse.json(
      { error: dup ? "你已有一個進行中的幕間任務，先領取或取消它。" : error.message },
      { status: dup ? 409 : 500 }
    );
  }

  return NextResponse.json({ id: row.id, claimableAt: row.claimable_at, successRate: rate, points });
}
