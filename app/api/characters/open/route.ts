import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rollCharacterCard } from "@/lib/cards/dice";

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Server-side daily limit: max 3 cards per UTC day.
  const DAILY_LIMIT = 3;
  const startOfUtcDay = new Date();
  startOfUtcDay.setUTCHours(0, 0, 0, 0);

  const { data: existing } = await supabase
    .from("character_cards")
    .select("id")
    .eq("user_id", user.id)
    .gte("created_at", startOfUtcDay.toISOString());

  if (existing && existing.length >= DAILY_LIMIT) {
    return NextResponse.json(
      { error: `今日已達每日上限（${DAILY_LIMIT} 張）。明天（UTC）再來！` },
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
        { error: `今日已達每日上限（${DAILY_LIMIT} 張）。明天（UTC）再來！` },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ card });
}
