import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkScenarioQuality } from "@/lib/game/scenario-quality";

/**
 * Approve or reject a pending scenario.
 *
 *   approve → published (visible on /scenarios)
 *   reject  → draft, with review_note explaining why
 *
 * Admin is verified server-side here AND by the DB trigger that refuses any
 * non-admin publish. Defence in depth: this route could be deleted tomorrow and
 * the database would still not let a creator publish themselves.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden — admin only." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as
    | { action?: "approve" | "reject"; note?: string }
    | null;
  const action = body?.action;
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: scenario } = await admin
    .from("scenarios")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!scenario) return NextResponse.json({ error: "找不到這個劇本。" }, { status: 404 });

  if (action === "reject") {
    const note = (body?.note ?? "").trim();
    if (!note) {
      // A rejection with no reason is just a silent deletion from the creator's
      // point of view — they cannot fix what they were not told.
      return NextResponse.json({ error: "退回時必須寫退回原因。" }, { status: 400 });
    }
    const { error } = await admin
      .from("scenarios")
      .update({
        status: "draft",
        review_note: note,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      })
      .eq("id", scenario.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, status: "draft" });
  }

  // Re-run the mechanical bar at approval time: the creator can keep editing
  // while a submission sits in the queue, so passing at submit does not mean
  // passing now.
  const { ok, failures } = checkScenarioQuality(scenario);
  if (!ok) {
    return NextResponse.json(
      { error: "這個劇本目前不符合最低標準（送審後又被改動過）。", failures },
      { status: 422 }
    );
  }

  const { error } = await admin
    .from("scenarios")
    .update({
      status: "published",
      review_note: null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", scenario.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, status: "published" });
}
