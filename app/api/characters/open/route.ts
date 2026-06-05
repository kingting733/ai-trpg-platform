import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rollCharacterCard } from "@/lib/cards/dice";

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Server-side daily limit: has the user already opened a card today (UTC)?
  const startOfUtcDay = new Date();
  startOfUtcDay.setUTCHours(0, 0, 0, 0);

  const { data: existing } = await supabase
    .from("character_cards")
    .select("id")
    .eq("user_id", user.id)
    .gte("created_at", startOfUtcDay.toISOString())
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: "You have already opened a character card today. Come back tomorrow!" },
      { status: 429 }
    );
  }

  const rolled = rollCharacterCard();

  // skill_points is computed (EDU×2 + INT×2) and never stored in the DB.
  const { skill_points, ...cardData } = rolled;

  const { data: card, error } = await supabase
    .from("character_cards")
    .insert({ user_id: user.id, ...cardData })
    .select("*")
    .single();

  if (error) {
    // The unique-per-UTC-day index is the source of truth — a race that slips
    // past the check above still fails here, which we surface cleanly.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "You have already opened a character card today. Come back tomorrow!" },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ card });
}
