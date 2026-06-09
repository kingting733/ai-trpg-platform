import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Approve a pending daily scenario: flip its status to 'published' so it goes
// live. Admin-only. Only acts on rows that are actually daily scenarios.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden — admin only." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("scenarios")
    .update({ status: "published" })
    .eq("id", params.id)
    .eq("is_daily", true)
    .select("id, title, status")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ approved: true, scenario: data });
}
