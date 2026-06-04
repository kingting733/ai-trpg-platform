import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// DELETE a room as an admin — used to clean up stuck or abandoned games.
// Deleting a room cascades to room_players, characters, turns, actions and
// story_logs. Admin status is verified server-side and enforced again by RLS.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
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

  const { error } = await supabase.from("rooms").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
