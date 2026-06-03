import { NextResponse } from "next/server";
import { generateGMResponse, GMAIInput } from "@/lib/ai/gm";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as { roomId: string; actionText: string; actingUserId: string };
  const { roomId, actionText, actingUserId } = body;

  // actingUserId is the player who just acted — the turn may have already advanced
  // so we verify the caller is a room participant, not that it's currently their turn
  const { data: room } = await supabase
    .from("rooms")
    .select("*, scenarios(title, background, objective, rules)")
    .eq("id", roomId)
    .single();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const { data: participant } = await supabase
    .from("room_players")
    .select("user_id")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .single();
  if (!participant) return NextResponse.json({ error: "Not a participant" }, { status: 403 });

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

  const myCharacter = (characters ?? []).find((c) => c.user_id === (actingUserId || user.id));
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
