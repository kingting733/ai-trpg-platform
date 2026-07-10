import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PRAY_COST, pickPrayReward } from "@/lib/game/items";

/**
 * 舊神祈願 — burn PRAY_COST 調查點, receive a permanent item the player does
 * not yet own (rarity rolled server-side; exhausted rarities spill; owning the
 * whole pool refuses the prayer BEFORE charging). Ownership insert has a
 * unique constraint, so even a double-submit cannot mint duplicates.
 */
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data: u }, { data: ownedRows }] = await Promise.all([
    supabase.from("users").select("points").eq("id", user.id).single(),
    supabase.from("user_items").select("item_id").eq("user_id", user.id),
  ]);
  const points = u?.points ?? 0;
  const owned = new Set((ownedRows ?? []).map((r: any) => r.item_id as string));

  const reward = pickPrayReward(owned);
  if (!reward) return NextResponse.json({ error: "舊神已無可回應之物——你已擁有一切。" }, { status: 409 });
  if (points < PRAY_COST) {
    return NextResponse.json({ error: `調查點不足（需要 ${PRAY_COST}，現有 ${points}）。` }, { status: 400 });
  }

  // Grant first (unique constraint = duplicate-proof), then charge. If the
  // charge failed we'd have gifted an item — acceptable failure direction;
  // the reverse (charge then failed grant) would eat the player's points.
  const { error: grantErr } = await supabase
    .from("user_items")
    .insert({ user_id: user.id, item_id: reward.id });
  if (grantErr) {
    const dup = grantErr.code === "23505";
    return NextResponse.json(
      { error: dup ? "祈願正在進行中，請稍候。" : grantErr.message },
      { status: dup ? 409 : 500 }
    );
  }
  const { error: chargeErr } = await supabase
    .from("users")
    .update({ points: points - PRAY_COST })
    .eq("id", user.id);
  if (chargeErr) console.error("[pray] charge failed after grant:", chargeErr.message);

  return NextResponse.json({
    item: { id: reward.id, name: reward.name, rarity: reward.rarity, flavor: reward.flavor },
    pointsLeft: points - PRAY_COST,
  });
}
