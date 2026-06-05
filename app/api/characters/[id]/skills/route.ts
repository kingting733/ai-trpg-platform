import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SkillPoints } from "@/lib/cards/dice";

// Set skill allocations on a character card (one-time, before use in any room).
// The card must belong to the calling user and have no skills yet (null or {}).
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: card } = await supabase
    .from("character_cards")
    .select("id, user_id, skills, edu, int")
    .eq("id", params.id)
    .single();

  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  if (card.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Skills can only be set once — null or {} means unset.
  const alreadySet = card.skills && Object.keys(card.skills).length > 0;
  if (alreadySet) {
    return NextResponse.json({ error: "Skills already allocated and cannot be changed." }, { status: 409 });
  }

  const body = await request.json() as { skills: SkillPoints };
  const skills = body.skills ?? {};

  // Validate: total allocated points must not exceed skill_points pool.
  const totalPool = (card.edu ?? 50) * 2 + (card.int ?? 65) * 2;
  const spent = Object.values(skills).reduce((s, v) => s + (v ?? 0), 0);
  if (spent > totalPool) {
    return NextResponse.json(
      { error: `Spent ${spent} points but pool is only ${totalPool}.` },
      { status: 400 }
    );
  }

  // All values must be non-negative integers.
  for (const [key, val] of Object.entries(skills)) {
    if (!Number.isInteger(val) || (val as number) < 0) {
      return NextResponse.json({ error: `Invalid value for skill ${key}.` }, { status: 400 });
    }
  }

  const { data: updated, error } = await supabase
    .from("character_cards")
    .update({ skills })
    .eq("id", params.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ card: updated });
}
