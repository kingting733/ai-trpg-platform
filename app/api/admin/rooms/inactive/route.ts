import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Bulk-delete rooms with no activity for over an hour. "Activity" is rooms.updated_at,
// which the update_rooms_updated_at trigger bumps on every turn/state change.
// Admin-only (verified server-side and by RLS). Room children cascade.
export async function DELETE(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden — admin only." }, { status: 403 });
  }

  // Allow overriding the idle window via ?minutes=N (default 60).
  const url = new URL(request.url);
  const minutes = Math.max(1, Number(url.searchParams.get("minutes")) || 60);
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  const { data: stale } = await supabase
    .from("rooms")
    .select("id")
    .lt("updated_at", cutoff);
  const ids = (stale ?? []).map((r: any) => r.id);

  if (ids.length === 0) {
    return NextResponse.json({ deleted: 0, ids: [] });
  }

  const { error } = await supabase.from("rooms").delete().in("id", ids);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: ids.length, ids });
}
