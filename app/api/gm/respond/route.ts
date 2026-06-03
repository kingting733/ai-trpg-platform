import { NextResponse } from "next/server";
import { generateGMResponse, GMAIInput } from "@/lib/ai/gm";
import { createClient } from "@/lib/supabase/server";
import { resolveAction } from "@/lib/game/resolution";

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as {
    roomId: string;
    actionText: string;
    actingUserId: string;
    characterId: string;
  };
  const { roomId, actionText, actingUserId, characterId } = body;

  // Verify caller is a room participant and it's actually their turn
  const { data: room } = await supabase
    .from("rooms")
    .select("*, scenarios(title, background, objective, rules)")
    .eq("id", roomId)
    .single();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.current_turn_player_id !== user.id) {
    return NextResponse.json({ error: "Not your turn" }, { status: 403 });
  }

  // Fetch the real party from the database — characters + their player usernames
  const { data: characters } = await supabase
    .from("characters")
    .select("*, users(username)")
    .eq("room_id", roomId);

  if (!characters || characters.length === 0) {
    return NextResponse.json(
      { error: "No characters found in this room — cannot generate GM response." },
      { status: 400 }
    );
  }

  const sortedBySpeed = [...characters].sort((a, b) => b.speed - a.speed);
  const currentIndex = sortedBySpeed.findIndex((c) => c.user_id === user.id);

  // resolvedActor = the character who just submitted the action (narration is about them)
  const resolvedActor = sortedBySpeed.find((c) => c.user_id === (actingUserId || user.id)) ?? null;

  // === DICE RESOLUTION ===
  // The SYSTEM decides the outcome; the GM only narrates it.
  const roll = resolvedActor
    ? resolveAction(actionText, resolvedActor)
    : null;

  let actorDied = false;
  let actorBroke = false;
  if (roll && resolvedActor && roll.requires_check && (roll.hp_change !== 0 || roll.san_change !== 0)) {
    const newHp = Math.max(0, resolvedActor.hp + roll.hp_change);
    const newSan = Math.max(0, resolvedActor.san + roll.san_change);
    actorDied = newHp <= 0;
    actorBroke = newSan <= 0;
    // Apply consequence to the acting character's own row.
    await supabase.from("characters")
      .update({ hp: newHp, san: newSan })
      .eq("id", resolvedActor.id);
    // Reflect locally so turn-skipping below sees the updated state.
    resolvedActor.hp = newHp;
    resolvedActor.san = newSan;
  }

  // Save action to story_logs, with the dice result attached to the action entry.
  await supabase.from("story_logs").insert({
    room_id: roomId,
    round_number: room.current_round,
    entry_type: "action",
    player_id: user.id,
    character_id: characterId,
    content: actionText,
    roll_result: roll,
  });

  // Advance turn — skip characters who are down (HP<=0). nextActor = now-active character.
  const isDown = (c: any) => c.hp <= 0;
  let nextRound = room.current_round;
  let nextPlayerId: string;
  let nextActor = sortedBySpeed[0];
  // Walk forward through the speed order, wrapping and incrementing round, to the next living actor.
  for (let step = 1; step <= sortedBySpeed.length; step++) {
    const idx = currentIndex + step;
    if (idx >= sortedBySpeed.length && nextRound === room.current_round) {
      nextRound = room.current_round + 1;
    }
    const candidate = sortedBySpeed[idx % sortedBySpeed.length];
    if (!isDown(candidate) || step === sortedBySpeed.length) {
      nextActor = candidate;
      break;
    }
  }
  nextPlayerId = nextActor?.user_id ?? user.id;

  // Clear old choices immediately so the previous player's suggestions never linger
  await supabase.from("rooms").update({
    current_turn_player_id: nextPlayerId,
    current_round: nextRound,
    current_choices: [],
    current_choices_for_player_id: null,
  }).eq("id", roomId);

  if (nextRound !== room.current_round) {
    await supabase.from("story_logs").insert({
      room_id: roomId,
      round_number: nextRound,
      entry_type: "system",
      content: `--- Round ${nextRound} begins ---`,
    });
  }

  // Fetch recent story log for GM context
  const { data: logs } = await supabase
    .from("story_logs")
    .select("entry_type, content, characters(name)")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(15);

  const storyLogSoFar = (logs ?? [])
    .reverse()
    .map((l: any) => {
      if (l.entry_type === "action") return `${l.characters?.name}: ${l.content}`;
      if (l.entry_type === "gm_response") return `GM: ${l.content}`;
      return l.content;
    });

  const partyForAI = sortedBySpeed.map((c: any) => ({
    name: c.name,
    playerName: c.users?.username ?? null,
    background: c.background ?? null,
    speed: c.speed, hp: c.hp, str: c.str, agi: c.agi,
    int: c.int, cha: c.cha, luck: c.luck, san: c.san,
  }));

  const scenario = (room as any).scenarios;
  const input: GMAIInput = {
    scenarioTitle: scenario?.title ?? "Unknown Scenario",
    scenarioBackground: scenario?.background ?? null,
    scenarioObjective: scenario?.objective ?? null,
    scenarioRules: scenario?.rules ?? null,
    characters: partyForAI,
    storyLogSoFar,
    currentRound: room.current_round,
    actingCharacterName: resolvedActor?.name ?? "Unknown",
    nextCharacterName: nextActor?.name ?? "Unknown",
    playerAction: actionText,
    resolution: roll
      ? {
          requiresCheck: roll.requires_check,
          statUsed: roll.stat_used,
          d20: roll.d20_roll,
          modifier: roll.modifier,
          dc: roll.dc,
          total: roll.total,
          outcome: roll.outcome,
          consequenceSummary: roll.consequence_summary,
          hpChange: roll.hp_change,
          sanChange: roll.san_change,
          actorDied,
          actorBroke,
        }
      : null,
  };

  try {
    const gmResponse = await generateGMResponse(input);

    await supabase.from("story_logs").insert({
      room_id: roomId,
      round_number: room.current_round,
      entry_type: "gm_response",
      content: gmResponse.narration,
    });

    // Choices belong to the NEXT acting player — tag them so the UI can verify
    await supabase.from("rooms").update({
      current_choices: gmResponse.choices,
      current_choices_for_player_id: nextPlayerId,
    }).eq("id", roomId);

    return NextResponse.json({
      response: gmResponse.narration,
      choices: gmResponse.choices,
      choicesForPlayerId: nextPlayerId,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
