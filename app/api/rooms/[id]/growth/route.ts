import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  SKILL_KEY_BY_ZH,
  SKILL_ZH_BY_KEY,
  SKILL_CAP,
  currentSkillValue,
} from "@/lib/game/skills";

const d = (sides: number) => Math.floor(Math.random() * sides) + 1;

/**
 * Compute the skills this user SUCCESSFULLY used in this room, with the source
 * card's current value for each. Server-authoritative — never trusts the client.
 * Returns null on any precondition failure (caller turns this into an error).
 */
async function computeEligible(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
  userId: string,
) {
  // Room must be completed AND ended with a good/normal ending.
  const { data: room } = await supabase
    .from("rooms")
    .select("status, ending_type")
    .eq("id", roomId)
    .single();
  if (!room || room.status !== "completed") return { error: "本場冒險尚未結束。", status: 400 as const };
  const isGoodEnding = room.ending_type === "good" || room.ending_type === "normal";
  if (!isGoodEnding) return { error: "只有在成功結局（勝利）中，角色才能成長。失敗結局不開放成長檢定。", status: 403 as const };

  // The user's in-room character → its source card.
  const { data: character } = await supabase
    .from("characters")
    .select("id, source_card_id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .single();
  if (!character) return { error: "找不到你在本房間的角色。", status: 404 as const };
  if (!character.source_card_id) return { error: "此角色沒有可成長的來源卡。", status: 400 as const };

  const { data: card } = await supabase
    .from("character_cards")
    .select("id, user_id, skills, dex, app")
    .eq("id", character.source_card_id)
    .single();
  if (!card) return { error: "找不到來源角色卡。", status: 404 as const };
  if (card.user_id !== userId) return { error: "你不擁有此角色卡。", status: 403 as const };

  // Already claimed growth for this room?
  const { data: claim } = await supabase
    .from("card_growth")
    .select("skill_key, d100_roll, old_value, gain, new_value")
    .eq("card_id", card.id)
    .eq("room_id", roomId)
    .maybeSingle();

  // Successful skill uses by this player in this room.
  const { data: logs } = await supabase
    .from("story_logs")
    .select("roll_result")
    .eq("room_id", roomId)
    .eq("entry_type", "action")
    .eq("player_id", userId);

  const usedKeys = new Set<string>();
  for (const l of logs ?? []) {
    const r: any = (l as any).roll_result;
    if (!r || !r.requires_check) continue;
    if (r.outcome !== "success" && r.outcome !== "critical_success") continue;
    const key = SKILL_KEY_BY_ZH[r.stat_used]; // stat_used holds the zh display name for skills
    if (key) usedKeys.add(key);
  }

  const attrs = { dex: card.dex ?? 50, app: card.app ?? 50 };
  const skills = (card.skills as Record<string, number> | null) ?? null;
  const eligible = Array.from(usedKeys)
    .map((key) => ({
      key,
      name: SKILL_ZH_BY_KEY[key] ?? key,
      current: currentSkillValue(key, skills, attrs),
    }))
    .filter((s) => s.current < SKILL_CAP) // already maxed → nothing to gain
    .sort((a, b) => a.current - b.current);

  return { card, character, eligible, claim: claim ?? null, attrs, skills };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await computeEligible(supabase, params.id, user.id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    eligible: result.eligible,
    claim: result.claim,
    alreadyClaimed: result.claim !== null,
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { skillKey } = (await req.json()) as { skillKey: string };
  if (!skillKey) return NextResponse.json({ error: "缺少技能。" }, { status: 400 });

  const result = await computeEligible(supabase, params.id, user.id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  const { card, eligible, claim, attrs, skills } = result;

  // One growth per card per story.
  if (claim) return NextResponse.json({ error: "此角色卡已在本場冒險中成長過，無法再次成長。" }, { status: 409 });

  // The chosen skill must be in the server-computed eligible set.
  const target = eligible.find((s) => s.key === skillKey);
  if (!target) return NextResponse.json({ error: "此技能不符合成長資格（必須在本局成功使用過）。" }, { status: 400 });

  // === SERVER-SIDE EXPERIENCE CHECK ===
  const oldValue = target.current;
  const roll = d(100);
  const improved = roll > oldValue;          // roll OVER current skill → improve
  const gain = improved ? d(10) : 0;          // +1d10
  const newValue = Math.min(SKILL_CAP, oldValue + gain);

  // Persist the new skill value onto the card (store FULL value).
  const newSkills = { ...(skills ?? {}), [skillKey]: newValue };
  const { error: updErr } = await supabase
    .from("character_cards")
    .update({ skills: newSkills })
    .eq("id", card.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Record the claim (also enforces the once-per-room unique constraint).
  const { error: insErr } = await supabase.from("card_growth").insert({
    card_id: card.id,
    room_id: params.id,
    user_id: user.id,
    skill_key: skillKey,
    d100_roll: roll,
    old_value: oldValue,
    gain,
    new_value: newValue,
  });
  if (insErr) {
    // Unique violation → a concurrent claim won the race. Surface gracefully.
    return NextResponse.json({ error: "此角色卡已在本場冒險中成長過。" }, { status: 409 });
  }

  return NextResponse.json({
    skillKey,
    skillName: target.name,
    roll,
    oldValue,
    improved,
    gain,
    newValue,
  });
}
