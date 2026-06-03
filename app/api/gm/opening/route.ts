import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildPartyRoster, ROSTER_CONSTRAINT } from "@/lib/ai/gm";

export interface OpeningScene {
  scene: string;
  choices: [string, string, string];
}

type PartyMember = {
  name: string; playerName?: string | null; background: string | null;
  speed: number; hp: number; str: number; agi: number;
  int: number; cha: number; luck: number; san: number;
};

async function generateOpening(
  scenarioTitle: string,
  background: string | null,
  objective: string | null,
  rules: string | null,
  characters: PartyMember[]
): Promise<OpeningScene> {
  const provider = process.env.AI_PROVIDER ?? "deepseek";
  const model = process.env.AI_MODEL ?? "deepseek-chat";
  const apiKey = process.env.AI_API_KEY;

  const partySize = characters.length;
  const charList = buildPartyRoster(characters);
  const names = characters.map((c) => c.name).join(", ");
  const firstCharName = characters[0]?.name ?? "the party";

  const systemPrompt = `You are an AI Game Master starting a multiplayer TRPG adventure called "${scenarioTitle}".
${background ? `Background: ${background}` : ""}
${objective ? `Objective: ${objective}` : ""}
${rules ? `Special Rules: ${rules}` : ""}

${ROSTER_CONSTRAINT}

PARTY ROSTER (${partySize} character${partySize > 1 ? "s" : ""}) — the only valid character names are: ${names}
${charList}

NARRATION RULES:
- This is a MULTIPLAYER game. Narrate in THIRD PERSON as a neutral Game Master.
- NEVER use "you". Refer to each character by their exact roster name, or collectively as "the party"/"the group".
- Introduce all roster characters in the opening scene by name.

Your task: Write the opening scene. Describe the environment vividly in 3-4 sentences, placing all party members in the world. Then suggest exactly 3 possible first actions written for ${firstCharName} in third person (e.g., "${firstCharName} examines the door" not "Examine the door").

Respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{"scene":"<opening narration here>","choices":["<${firstCharName} action 1>","<${firstCharName} action 2>","<${firstCharName} action 3>"]}`;

  const userMessage = "Begin the adventure.";

  if (!apiKey) {
    return {
      scene: `The adventure begins. ${background ?? `The party stands at the threshold of their quest — ${scenarioTitle}.`} The air is thick with anticipation.`,
      choices: [
        `${firstCharName} looks around carefully and assesses the surroundings`,
        `${firstCharName} moves forward cautiously`,
        `${firstCharName} checks their equipment and addresses the group`,
      ],
    };
  }

  try {
    let raw = "";
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
          max_tokens: 500,
        }),
      });
      const data = await res.json();
      raw = data.content?.[0]?.text?.trim() ?? "";
    } else {
      const baseUrl = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com";
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
          max_tokens: 500,
          temperature: 0.85,
        }),
      });
      const data = await res.json();
      raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    }

    // Strip markdown code fences if present
    raw = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(raw) as OpeningScene;
    if (parsed.scene && Array.isArray(parsed.choices) && parsed.choices.length === 3) {
      return parsed;
    }
    throw new Error("Invalid shape");
  } catch {
    // Fallback if AI fails or returns bad JSON
    return {
      scene: `The adventure begins. ${background ?? ""} The world feels alive with danger and possibility.`.trim(),
      choices: [
        `${firstCharName} looks around carefully, assessing the surroundings`,
        `${firstCharName} moves forward cautiously, staying alert`,
        `${firstCharName} speaks up, addressing the group`,
      ],
    };
  }
}

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId } = await request.json() as { roomId: string };

  const { data: room } = await supabase
    .from("rooms")
    .select("*, scenarios(title, background, objective, rules)")
    .eq("id", roomId)
    .single();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // Fetch the real party from the database — characters + their player usernames
  const { data: characters } = await supabase
    .from("characters")
    .select("*, users(username)")
    .eq("room_id", roomId);

  if (!characters || characters.length === 0) {
    return NextResponse.json(
      { error: "No characters found in this room — cannot generate opening scene." },
      { status: 400 }
    );
  }

  const sortedChars = [...characters].sort((a: any, b: any) => b.speed - a.speed);
  // The opening choices are for the FIRST acting player (highest speed)
  const firstPlayerId = sortedChars[0]?.user_id ?? null;

  const party: PartyMember[] = sortedChars.map((c: any) => ({
    name: c.name,
    playerName: c.users?.username ?? null,
    background: c.background ?? null,
    speed: c.speed, hp: c.hp, str: c.str, agi: c.agi,
    int: c.int, cha: c.cha, luck: c.luck, san: c.san,
  }));

  const scenario = (room as any).scenarios;
  const opening = await generateOpening(
    scenario?.title ?? "Unknown Scenario",
    scenario?.background ?? null,
    scenario?.objective ?? null,
    scenario?.rules ?? null,
    party
  );

  await supabase.from("story_logs").insert({
    room_id: roomId,
    round_number: 1,
    entry_type: "gm_response",
    content: opening.scene,
  });

  await supabase.from("rooms").update({
    current_choices: opening.choices,
    current_choices_for_player_id: firstPlayerId,
  }).eq("id", roomId);

  return NextResponse.json({ ...opening, choicesForPlayerId: firstPlayerId });
}
