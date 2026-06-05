import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildPartyRoster, buildLanguageInstruction, ROSTER_CONSTRAINT, ScenarioGMContext } from "@/lib/ai/gm";

export interface OpeningScene {
  scene: string;
  choices: [string, string, string];
}

type PartyMember = {
  name: string; playerName?: string | null; background: string | null;
  dex: number; hp: number; san: number; mp: number;
  str: number; con: number; siz: number; app: number;
  int: number; pow: number; edu: number; luck: number;
};

function buildGMContextBlock(ctx: ScenarioGMContext): string {
  const parts: string[] = [];
  if (ctx.openingScene) parts.push(`Opening Scene to narrate:\n${ctx.openingScene}`);
  if (ctx.sceneFlow) parts.push(`Scene Flow & Progression (the adventure's spine):\n${ctx.sceneFlow}`);
  if (ctx.locations.length) parts.push(`Key Locations:\n${ctx.locations.map((l) => `  - ${l}`).join("\n")}`);
  if (ctx.npcs.length) parts.push(`NPCs:\n${ctx.npcs.map((n) => `  - ${n}`).join("\n")}`);
  if (ctx.clues.length) parts.push(`Clues:\n${ctx.clues.map((c) => `  - ${c}`).join("\n")}`);
  if (ctx.threats.length) parts.push(`Threats & Enemies:\n${ctx.threats.map((t) => `  - ${t}`).join("\n")}`);
  if (ctx.traps.length) parts.push(`Traps & Hazards:\n${ctx.traps.map((t) => `  - ${t}`).join("\n")}`);
  if (ctx.keyItems.length) parts.push(`Key Items:\n${ctx.keyItems.map((i) => `  - ${i}`).join("\n")}`);
  if (ctx.secretRules) parts.push(`GM Rules & Pacing:\n${ctx.secretRules}`);
  if (ctx.winningTargets) parts.push(`Winning Targets — any ONE player completing each satisfies it:\n${ctx.winningTargets}`);
  if (ctx.eachPlayerTargets) parts.push(`Per-Player Targets — EVERY surviving player must personally complete each:\n${ctx.eachPlayerTargets}`);
  if (ctx.failureConditions) parts.push(`Failure Conditions — if any occurs, the adventure ends in defeat:\n${ctx.failureConditions}`);
  if (ctx.endingConditions) parts.push(`Additional Ending Notes:\n${ctx.endingConditions}`);
  if (ctx.gmNotes) parts.push(`Additional GM Notes:\n${ctx.gmNotes}`);
  // source_document intentionally omitted — curated structured fields capture all needed knowledge.
  if (!parts.length) return "";
  return `\nGM WORLD CONTEXT (never share this with players directly):\n${parts.join("\n\n")}`;
}

async function generateOpening(
  scenarioTitle: string,
  background: string | null,
  objective: string | null,
  rules: string | null,
  gmContext: ScenarioGMContext | null,
  characters: PartyMember[],
  language?: string | null
): Promise<OpeningScene> {
  const provider = process.env.AI_PROVIDER ?? "deepseek";
  const model = process.env.AI_MODEL ?? "deepseek-chat";
  const apiKey = process.env.AI_API_KEY;

  const partySize = characters.length;
  const charList = buildPartyRoster(characters);
  const names = characters.map((c) => c.name).join(", ");
  const firstCharName = characters[0]?.name ?? "the party";
  const gmCtxBlock = gmContext ? buildGMContextBlock(gmContext) : "";
  const langBlock = buildLanguageInstruction(language);

  const openingInstruction = gmContext?.openingScene
    ? `Use the "Opening Scene to narrate" above as the basis for your opening narration — expand it into a vivid 6-8 sentence scene, rich in atmosphere and sensory detail, that introduces all party members.`
    : `Write the opening scene. Describe the environment vividly in 6-8 sentences, rich in atmosphere and sensory detail, placing all party members in the world.`;

  const systemPrompt = `You are an AI Game Master starting a multiplayer TRPG adventure called "${scenarioTitle}".
${langBlock}${background ? `Background: ${background}` : ""}
${objective ? `Objective: ${objective}` : ""}
${rules ? `Special Rules: ${rules}` : ""}
${gmCtxBlock}

${ROSTER_CONSTRAINT}

PARTY ROSTER (${partySize} character${partySize > 1 ? "s" : ""}) — the only valid character names are: ${names}
${charList}

NARRATION RULES:
- This is a MULTIPLAYER game. Narrate in THIRD PERSON as a neutral Game Master.
- NEVER use "you". Refer to each character by their exact roster name, or collectively as "the party"/"the group".
- Introduce all roster characters in the opening scene by name.
- TONE & ATMOSPHERE: Match the mood of the genre and setting, using sensory detail to make the world vivid and immersive.
- INFORMATION GATING: Set the scene and hook the players, but do NOT reveal the plot, clues, secrets, or twists up front — those are uncovered through play.

${openingInstruction} Then suggest exactly 3 possible first actions written for ${firstCharName} in third person (e.g., "${firstCharName} examines the door" not "Examine the door").

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
          max_tokens: 900,
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
          max_tokens: 900,
          temperature: 0.85,
        }),
      });
      const data = await res.json();
      raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    }

    raw = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(raw) as OpeningScene;
    if (parsed.scene && Array.isArray(parsed.choices) && parsed.choices.length === 3) {
      return parsed;
    }
    throw new Error("Invalid shape");
  } catch {
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
    .select("*, scenarios(title, background, objective, rules, opening_scene, scene_flow, secret_rules, locations, npcs, clues, threats, traps, key_items, winning_targets, each_player_targets, failure_conditions, ending_conditions, gm_notes, language)")
    .eq("id", roomId)
    .single();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

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

  const sortedChars = [...characters].sort((a: any, b: any) => b.dex - a.dex);
  const firstPlayerId = sortedChars[0]?.user_id ?? null;

  const party: PartyMember[] = sortedChars.map((c: any) => ({
    name: c.name,
    playerName: c.users?.username ?? null,
    background: c.background ?? null,
    dex: c.dex, hp: c.hp, san: c.san, mp: c.mp ?? 0,
    str: c.str, con: c.con, siz: c.siz, app: c.app,
    int: c.int, pow: c.pow, edu: c.edu, luck: c.luck,
  }));

  const scenario = (room as any).scenarios;
  const gmContext: ScenarioGMContext | null = scenario ? {
    openingScene: scenario.opening_scene ?? null,
    sceneFlow: scenario.scene_flow ?? null,
    secretRules: scenario.secret_rules ?? null,
    locations: Array.isArray(scenario.locations) ? scenario.locations : [],
    npcs: Array.isArray(scenario.npcs) ? scenario.npcs : [],
    clues: Array.isArray(scenario.clues) ? scenario.clues : [],
    threats: Array.isArray(scenario.threats) ? scenario.threats : [],
    traps: Array.isArray(scenario.traps) ? scenario.traps : [],
    keyItems: Array.isArray(scenario.key_items) ? scenario.key_items : [],
    winningTargets: scenario.winning_targets ?? null,
    eachPlayerTargets: scenario.each_player_targets ?? null,
    failureConditions: scenario.failure_conditions ?? null,
    endingConditions: scenario.ending_conditions ?? null,
    gmNotes: scenario.gm_notes ?? null,
  } : null;

  const opening = await generateOpening(
    scenario?.title ?? "Unknown Scenario",
    scenario?.background ?? null,
    scenario?.objective ?? null,
    scenario?.rules ?? null,
    gmContext,
    party,
    scenario?.language ?? null
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
