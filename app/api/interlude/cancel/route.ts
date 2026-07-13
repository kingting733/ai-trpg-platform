import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Cancel an active interlude mission — the card comes home immediately, but
 *  ALL rewards are forfeited (no partial refund, so cancel-retry can't fish
 *  for better outcomes). */
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { missionId } = (await req.json()) as { missionId?: string };
  if (!missionId) return NextResponse.json({ error: "缺少任務。" }, { status: 400 });

  // Service-role write (card_missions has no client UPDATE policy after
  // hardening); the .eq("user_id", user.id) filter scopes it to the caller.
  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("card_missions")
    .update({ claimed_at: new Date().toISOString(), cancelled: true, outcome: null })
    .eq("id", missionId)
    .eq("user_id", user.id)
    .is("claimed_at", null)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "任務不存在或已結束。" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
