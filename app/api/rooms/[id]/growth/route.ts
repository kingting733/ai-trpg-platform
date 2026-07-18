import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SKILL_KEY_BY_ZH,
  SKILL_ZH_BY_KEY,
  SKILL_CAP,
  currentSkillValue,
} from "@/lib/game/skills";
import { endingAllowsGrowth } from "@/lib/game/endings";
import { KNOWLEDGE_CAP } from "@/lib/game/mythos";

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
    .select("status, ending_type, scenario_id")
    .eq("id", roomId)
    .single();
  if (!room || room.status !== "completed") return { error: "本場冒險尚未結束。", status: 400 as const };
  if (!endingAllowsGrowth(room.ending_type)) return { error: "只有在成功結局（勝利）中，角色才能成長。失敗結局不開放成長檢定。", status: 403 as const };
  const scenarioId: string | null = room.scenario_id ?? null;

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
    .select("id, user_id, skills, dex, app, cleared_scenarios, cthulhu_knowledge")
    .eq("id", character.source_card_id)
    .single();
  if (!card) return { error: "找不到來源調查員。", status: 404 as const };
  if (card.user_id !== userId) return { error: "你不擁有此調查員。", status: 403 as const };

  // Winning the story marks the scenario as cleared on the card — independent of
  // whether any skill is eligible for growth. Idempotent (dedup the array).
  let knowledgeGained = 0;
  if (scenarioId) {
    const cleared: string[] = Array.isArray(card.cleared_scenarios) ? card.cleared_scenarios : [];
    if (!cleared.includes(scenarioId)) {
      // Official-story Mythos reward: 克蘇魯知識 grows ONLY here — on the FIRST
      // clear of a scenario that declares mythos_reward (author-only field).
      // Capped at KNOWLEDGE_CAP; replays grant nothing (first-clear gate).
      const { data: scen } = await supabase
        .from("scenarios").select("mythos_reward, creator_id").eq("id", scenarioId).single();
      // OFFICIAL STORIES ONLY: any creator can type a reward into the editor,
      // but the server pays out only when the scenario's creator is listed in
      // MYTHOS_OFFICIAL_CREATORS (comma-separated user ids). Unset → nobody.
      const officialCreators = (process.env.MYTHOS_OFFICIAL_CREATORS ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      const isOfficial = !!scen?.creator_id && officialCreators.includes(scen.creator_id);
      const declaredK = Number((scen?.mythos_reward as any)?.knowledge) || 0;
      if (declaredK > 0 && !isOfficial) {
        console.warn(`[mythos:reward] scenario ${scenarioId} declares knowledge=${declaredK} but creator ${scen?.creator_id} is not in MYTHOS_OFFICIAL_CREATORS — not granted`);
      }
      const rewardK = isOfficial ? declaredK : 0;
      const curK = typeof card.cthulhu_knowledge === "number" ? card.cthulhu_knowledge : 0;
      const newK = Math.min(KNOWLEDGE_CAP, curK + Math.max(0, rewardK));
      knowledgeGained = newK - curK;
      // Service-role: character_cards has no client UPDATE policy after
      // hardening. Ownership (card.user_id === userId) is checked above.
      await createAdminClient()
        .from("character_cards")
        .update({
          cleared_scenarios: [...cleared, scenarioId],
          ...(knowledgeGained > 0 ? { cthulhu_knowledge: newK } : {}),
        })
        .eq("id", card.id)
        .eq("user_id", userId);
      card.cleared_scenarios = [...cleared, scenarioId];
      card.cthulhu_knowledge = newK;
    }
  }

  // Already claimed growth for this SCENARIO? (locked per story, not per room)
  let claimQuery = supabase
    .from("card_growth")
    .select("skill_key, d100_roll, old_value, gain, new_value")
    .eq("card_id", card.id);
  claimQuery = scenarioId
    ? claimQuery.eq("scenario_id", scenarioId)
    : claimQuery.eq("room_id", roomId); // legacy rooms with no scenario
  const { data: claim } = await claimQuery.maybeSingle();

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

  return { card, character, eligible, claim: claim ?? null, attrs, skills, scenarioId, knowledgeGained };
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
    // 克蘇魯知識 granted just now (first clear of a mythos_reward story); 0 otherwise.
    knowledgeGained: result.knowledgeGained,
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

  const { card, eligible, claim, skills, scenarioId } = result;

  // One growth per card per SCENARIO (replaying the same story grants nothing).
  if (claim) return NextResponse.json({ error: "此調查員已在此劇本中成長過，無法再次成長。" }, { status: 409 });

  // The chosen skill must be in the server-computed eligible set.
  const target = eligible.find((s) => s.key === skillKey);
  if (!target) return NextResponse.json({ error: "此技能不符合成長資格（必須在本局成功使用過）。" }, { status: 400 });

  // === SERVER-SIDE EXPERIENCE CHECK ===
  const oldValue = target.current;
  const roll = d(100);
  const improved = roll > oldValue;          // roll OVER current skill → improve
  const gain = improved ? d(10) : 0;          // +1d10
  const newValue = Math.min(SKILL_CAP, oldValue + gain);

  // Persist the new skill value onto the card (store FULL value). The scenario
  // was already marked cleared in computeEligible. Service-role writes:
  // character_cards / card_growth have no client write policy after hardening;
  // ownership (card.user_id === user.id) was verified in computeEligible.
  const admin = createAdminClient();
  const newSkills = { ...(skills ?? {}), [skillKey]: newValue };
  const { error: updErr } = await admin
    .from("character_cards")
    .update({ skills: newSkills })
    .eq("id", card.id)
    .eq("user_id", user.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Record the claim (also enforces the once-per-scenario unique constraint).
  const { error: insErr } = await admin.from("card_growth").insert({
    card_id: card.id,
    room_id: params.id,
    scenario_id: scenarioId,
    user_id: user.id,
    skill_key: skillKey,
    d100_roll: roll,
    old_value: oldValue,
    gain,
    new_value: newValue,
  });
  if (insErr) {
    // Unique violation → a concurrent claim won the race. Surface gracefully.
    return NextResponse.json({ error: "此調查員已在此劇本中成長過。" }, { status: 409 });
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
