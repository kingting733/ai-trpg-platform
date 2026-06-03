import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface OpeningScene {
  scene: string;
  choices: [string, string, string];
}

async function generateOpening(
  scenarioTitle: string,
  background: string | null,
  objective: string | null,
  rules: string | null,
  characters: Array<{ name: string; background: string | null }>
): Promise<OpeningScene> {
  const provider = process.env.AI_PROVIDER ?? "deepseek";
  const model = process.env.AI_MODEL ?? "deepseek-chat";
  const apiKey = process.env.AI_API_KEY;

  const charNames = characters.map((c) => c.name).join(", ");

  const systemPrompt = `You are an AI Game Master starting a TRPG adventure called "${scenarioTitle}".
${background ? `Background: ${background}` : ""}
${objective ? `Objective: ${objective}` : ""}
${rules ? `Special Rules: ${rules}` : ""}
Players: ${charNames}

Your task: Write the opening scene of the adventure. Describe the environment vividly in 3-4 sentences, setting the mood and placing the players in the world. Then suggest exactly 3 possible first actions the players could take.

Respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{"scene":"<opening narration here>","choices":["<action 1>","<action 2>","<action 3>"]}`;

  const userMessage = "Begin the adventure.";

  if (!apiKey) {
    return {
      scene: `The adventure begins. ${background ?? `You stand at the entrance of your quest for ${scenarioTitle}.`} The air is thick with anticipation.`,
      choices: [
        "Look around carefully and assess the surroundings",
        "Move forward cautiously",
        "Check your equipment and prepare for what lies ahead",
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
      scene: `The adventure begins. ${background ?? ""} The world around you feels alive with danger and possibility.`.trim(),
      choices: [
        "Look around carefully and assess the surroundings",
        "Move forward cautiously, staying alert",
        "Speak up — address your companions or call out into the unknown",
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

  const { data: characters } = await supabase
    .from("characters")
    .select("name, background")
    .eq("room_id", roomId);

  const scenario = (room as any).scenarios;
  const opening = await generateOpening(
    scenario?.title ?? "Unknown Scenario",
    scenario?.background ?? null,
    scenario?.objective ?? null,
    scenario?.rules ?? null,
    characters ?? []
  );

  await supabase.from("story_logs").insert({
    room_id: roomId,
    round_number: 1,
    entry_type: "gm_response",
    content: opening.scene,
  });

  await supabase.from("rooms").update({ current_choices: opening.choices }).eq("id", roomId);

  return NextResponse.json(opening);
}
