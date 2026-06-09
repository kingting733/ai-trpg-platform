import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runDailyGeneration } from "@/lib/server/daily-runner";

export const runtime = "nodejs";
export const maxDuration = 120;

// Admin-only manual trigger. `force: true` regenerates today's scenario even if
// one already exists (replacing the existing draft).
export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden — admin only." }, { status: 403 });
  }

  let force = false;
  try {
    const body = await request.json();
    force = !!body?.force;
  } catch { /* no body — default */ }

  try {
    const result = await runDailyGeneration({ force });
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[admin/daily/generate] failed:", e?.message ?? e);
    return NextResponse.json({ status: "error", message: e?.message ?? "generation failed" }, { status: 500 });
  }
}
