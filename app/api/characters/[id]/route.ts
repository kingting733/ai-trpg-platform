import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // A card on an active interlude mission must not be deleted — the mission row
  // FK-cascades away, silently erasing a day of progress (and it's a way to
  // dodge a bad in-flight mission; cancel exists for that). Block it.
  const { data: activeMission } = await supabase
    .from("card_missions")
    .select("id")
    .eq("card_id", params.id)
    .eq("user_id", user.id)
    .is("claimed_at", null)
    .maybeSingle();
  if (activeMission) {
    return NextResponse.json({ error: "此調查員正在執行幕間任務，先領取或取消才能刪除。" }, { status: 409 });
  }

  const { error } = await supabase
    .from("character_cards")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id); // RLS + belt-and-suspenders

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
