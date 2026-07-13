import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // CHARGE ATOMICALLY FIRST — the DB function decrements only if the balance is
  // still >= PRAY_COST, so two concurrent prayers can't both pass on the same
  // balance (the old read-check-write let a player get two items for one cost).
  const { data: pointsLeft, error: chargeErr } = await supabase.rpc("adjust_points", {
    p_user: user.id,
    p_delta: -PRAY_COST,
    p_min: PRAY_COST,
  });
  if (chargeErr) return NextResponse.json({ error: chargeErr.message }, { status: 500 });
  if (pointsLeft === null) {
    // Guard failed — a concurrent prayer spent the points first.
    return NextResponse.json({ error: `調查點不足（需要 ${PRAY_COST}）。` }, { status: 400 });
  }

  // Grant after charging. The unique(user,item) constraint is duplicate-proof;
  // if the grant somehow fails, REFUND the charge so the player never loses
  // points for nothing. Service-role write: user_items has no client INSERT
  // policy (hardened), so the grant goes through the admin client — ownership
  // was already established via getUser() above.
  const admin = createAdminClient();
  const { error: grantErr } = await admin
    .from("user_items")
    .insert({ user_id: user.id, item_id: reward.id });
  if (grantErr) {
    await supabase.rpc("adjust_points", { p_user: user.id, p_delta: PRAY_COST, p_min: 0 });
    const dup = grantErr.code === "23505";
    return NextResponse.json(
      { error: dup ? "祈願正在進行中，請稍候。" : grantErr.message },
      { status: dup ? 409 : 500 }
    );
  }

  return NextResponse.json({
    item: { id: reward.id, name: reward.name, rarity: reward.rarity, flavor: reward.flavor },
    pointsLeft,
  });
}
