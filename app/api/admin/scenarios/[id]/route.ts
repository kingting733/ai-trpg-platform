import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// DELETE a scenario as an admin. Verifies the caller is an admin server-side
// (defense in depth — the RLS policy also enforces it). Because
// rooms.scenario_id has no ON DELETE CASCADE, any rooms that played this
// scenario are removed first (their children — players, characters, turns,
// actions, story logs — cascade automatically), then the scenario itself.
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

  const scenarioId = params.id;

  // Remove dependent rooms first (cascades their game state).
  const { data: rooms } = await supabase
    .from("rooms")
    .select("id")
    .eq("scenario_id", scenarioId);
  const roomCount = rooms?.length ?? 0;

  if (roomCount > 0) {
    const { error: roomErr } = await supabase
      .from("rooms")
      .delete()
      .eq("scenario_id", scenarioId);
    if (roomErr) {
      return NextResponse.json(
        { error: `Failed to delete dependent rooms: ${roomErr.message}` },
        { status: 500 }
      );
    }
  }

  const { error } = await supabase.from("scenarios").delete().eq("id", scenarioId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true, roomsRemoved: roomCount });
}
