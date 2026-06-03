import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await request.json() as { name?: string };
  const trimmed = name?.trim();
  if (!trimmed) return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
  if (trimmed.length > 40) return NextResponse.json({ error: "Name is too long (max 40 chars)." }, { status: 400 });

  // Only update the name — stats remain locked.
  // RLS ensures the card belongs to the authenticated user.
  const { data: card, error } = await supabase
    .from("character_cards")
    .update({ name: trimmed })
    .eq("id", params.id)
    .eq("user_id", user.id)   // belt-and-suspenders on top of RLS
    .select("id, name")
    .single();

  if (error || !card) {
    return NextResponse.json({ error: "Card not found or update failed." }, { status: 404 });
  }

  return NextResponse.json({ card });
}
