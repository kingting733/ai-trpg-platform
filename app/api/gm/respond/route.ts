import { NextResponse } from "next/server";
import { generateGMResponse, GMAIInput } from "@/lib/ai/gm";
import { createClient } from "@/lib/supabase/server";

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

  // Save action to story_logs
  await supabase.from("story_logs").insert({
    room_id: roomId,
    round_number: room.current_round,
    entry_type: "action",
    player_id: user.id,
    character_id: characterId,
    content: actionText,
  });

  // Advance turn
  let nextRound = room.current_round;
  let nextPlayerId: string;
  const nextIndex = currentIndex + 1;
  if (currentIndex === -1 || nextIndex >= sortedBySpeed.length) {
    // Last player in round — start new round from first player
    nextRound = room.current_round + 1;
    nextPlayerId = sortedBySpeed[0]?.user_id ?? user.id;
    await supabase.from("rooms").update({
      current_turn_player_id: nextPlayerId,
      current_round: nextRound,
      current_choices: [],
    }).eq("id", roomId);
    await supabase.from("story_logs").insert({
      room_id: roomId,
      round_number: nextRound,
      entry_type: "system",
      content: `--- Round ${nextRound} begins ---`,
    });
  } else {
    nextPlayerId = sortedBySpeed[nextIndex].user_id;
    await supabase.from("rooms").update({
      current_turn_player_id: nextPlayerId,
      current_choices: [],
    }).eq("id", roomId);
  }

  // Fetch recent story log for GM context
  const { data: logs } = await supabase
    .from("story_logs")
    .select("entry_type, content, characters(name)")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(15);

  const myCharacter = sortedBySpeed.find((c) => c.user_id === (actingUserId || user.id));
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
    actingCharacterName: myCharacter?.name ?? "Unknown",
    playerAction: actionText,
  };

  // TEMP DEBUG: log the real party roster sent to the AI GM
  console.log("[GM respond] room", roomId, "party roster:",
    JSON.stringify(partyForAI.map((c) => ({ name: c.name, player: c.playerName, speed: c.speed }))),
    "| acting:", input.actingCharacterName);

  try {
    const gmResponse = await generateGMResponse(input);

    await supabase.from("story_logs").insert({
      room_id: roomId,
      round_number: room.current_round,
      entry_type: "gm_response",
      content: gmResponse.narration,
    });

    await supabase.from("rooms").update({ current_choices: gmResponse.choices }).eq("id", roomId);

    return NextResponse.json({ response: gmResponse.narration, choices: gmResponse.choices });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
