import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkScenarioQuality } from "@/lib/game/scenario-quality";

/**
 * Submit a scenario for review: draft → pending.
 *
 * This is the ONLY way a creator can start the publish process. The mechanical
 * bar (lib/game/scenario-quality.ts) is checked HERE, server-side, against the
 * stored row — never against whatever the client claims — because the editor's
 * copy of the same check is a convenience, not a guarantee.
 *
 * The DB trigger from add_scenario_review.sql owns the other half: no
 * non-admin can reach status='published' at all, whatever they POST.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: scenario } = await supabase
    .from("scenarios")
    .select("*")
    .eq("id", params.id)
    .eq("creator_id", user.id)
    .maybeSingle();

  // Same response for "not yours" and "does not exist" — no id probing.
  if (!scenario) {
    return NextResponse.json({ error: "找不到這個劇本，或它不是你建立的。" }, { status: 404 });
  }
  if (scenario.status === "published") {
    return NextResponse.json({ error: "這個劇本已經發佈了。" }, { status: 400 });
  }
  if (scenario.status === "pending") {
    return NextResponse.json({ error: "這個劇本已經在審核佇列中。" }, { status: 400 });
  }

  const { ok, failures } = checkScenarioQuality(scenario);
  if (!ok) {
    // 422, not 400: the request was well-formed, the CONTENT is not ready. The
    // failure list is the whole point — the creator must be able to act on it.
    return NextResponse.json({ error: "劇本尚未達到送審標準。", failures }, { status: 422 });
  }

  // Service-role write: status transitions must not depend on whatever UPDATE
  // policy the creator has. Still scoped to this creator's own row above.
  const { error } = await createAdminClient()
    .from("scenarios")
    .update({ status: "pending", submitted_at: new Date().toISOString(), review_note: null })
    .eq("id", scenario.id)
    .eq("creator_id", user.id);

  if (error) {
    console.error(`[scenario:submit] failed for ${scenario.id}: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "pending" });
}
