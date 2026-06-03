import { NextResponse } from "next/server";
import { generateGMResponse, GMAIInput } from "@/lib/ai/gm";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as { roomId: string; actionText: string };
  const { roomId, actionText } = body;

  // Fetch room + scenario
  const { data: room } = await supabase
    .from("rooms")
    .select("*, scenarios(title, background, objective, rules)")
    .eq("id", roomId)
    .single();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // Verify it's the current player's turn
  if (room.current_turn_player_id !== user.id) {
    return NextResponse.json({ error: "Not your turn" }, { status: 403 });
  }

  // Fetch characters
  const { data: characters } = await supabase
    .from("characters")
    .select("*")
    .eq("room_id", roomId);

  // Fetch recent story log
  const { data: logs } = await supabase
    .from("story_logs")
    .select("entry_type, content, characters(name)")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(15);

  const myCharacter = (characters ?? []).find((c) => c.user_id === user.id);
  const storyLogSoFar = (logs ?? [])
    .reverse()
    .map((l: any) => {
      if (l.entry_type === "action") return `${l.characters?.name}: ${l.content}`;
      if (l.entry_type === "gm_response") return `GM: ${l.content}`;
      return l.content;
    });

  const scenario = (room as any).scenarios;
  const input: GMAIInput = {
    scenarioTitle: scenario?.title ?? "Unknown Scenario",
    scenarioBackground: scenario?.background ?? null,
    scenarioObjective: scenario?.objective ?? null,
    scenarioRules: scenario?.rules ?? null,
    characters: characters ?? [],
    storyLogSoFar,
    currentRound: room.current_round,
    actingCharacterName: myCharacter?.name ?? "Unknown",
    playerAction: actionText,
  };

  try {
    const gmResponse = await generateGMResponse(input);

    // Save GM response to story_logs
    await supabase.from("story_logs").insert({
      room_id: roomId,
      round_number: room.current_round,
      entry_type: "gm_response",
      content: gmResponse,
    });

    return NextResponse.json({ response: gmResponse });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
