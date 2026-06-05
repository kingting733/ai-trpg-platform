import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Base skill values (mirrors CardRollReveal.tsx SKILLS list).
// "dex2" means floor(dex/2) — resolved after fetching the card.
const SKILL_BASES: Record<string, number | "dex2"> = {
  spot_hidden: 25, listen: 20, library_use: 20, psychology: 10,
  persuade: 25, fast_talk: 5, charm: 15, intimidate: 15,
  dodge: "dex2", first_aid: 30, stealth: 20, lockpick: 1, drive_auto: 20,
};

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: card } = await supabase
    .from("character_cards")
    .select("id, user_id, skills, edu, int, dex")
    .eq("id", params.id)
    .single();

  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  if (card.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const alreadySet = card.skills && Object.keys(card.skills).length > 0;
  if (alreadySet) {
    return NextResponse.json({ error: "Skills already allocated and cannot be changed." }, { status: 409 });
  }

  const body = await request.json() as { skills: Record<string, number> };
  const skills = body.skills ?? {};

  // Validate each skill and compute total allocated (full_value - base).
  const totalPool = (card.edu ?? 50) * 2 + (card.int ?? 65) * 2;
  let totalAllocated = 0;

  for (const [key, val] of Object.entries(skills)) {
    if (!Number.isInteger(val) || val < 0 || val > 99) {
      return NextResponse.json({ error: `Invalid value for skill ${key}.` }, { status: 400 });
    }
    const rawBase = SKILL_BASES[key];
    const base = rawBase === "dex2" ? Math.floor((card.dex ?? 50) / 2) : (rawBase ?? 0);
    const allocated = val - base;
    if (allocated < 0) {
      return NextResponse.json({ error: `Value for ${key} is below its base of ${base}.` }, { status: 400 });
    }
    totalAllocated += allocated;
  }

  if (totalAllocated > totalPool) {
    return NextResponse.json(
      { error: `Allocated ${totalAllocated} points but pool is only ${totalPool}.` },
      { status: 400 }
    );
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
