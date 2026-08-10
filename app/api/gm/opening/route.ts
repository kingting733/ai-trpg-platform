import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildPartyRoster, buildLanguageInstruction, ROSTER_CONSTRAINT, ScenarioGMContext, NpcEntry } from "@/lib/ai/gm";
import { resolveScenarioObjectives } from "@/lib/game/objectives-def";
import { thinkingFragment } from "@/lib/ai/settings";
import {
  coerceLocationGraph,
  initLocationState,
  applyDiscovers,
  evaluateUnlocks,
  locationShortName,
} from "@/lib/game/locations";

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

// 900 was too tight to be safe: it had to cover a 6-8 sentence scene, 3
// choices, JSON syntax — and, on a reasoning model, the hidden thinking too.
const OPENING_MAX_TOKENS = 2400;

/** Tolerant parse: models wrap JSON in fences or prose often enough that a bare
 *  JSON.parse of the whole string is the single biggest source of "unusable
 *  response". Finds the outermost object and validates the shape. */
function parseOpening(raw: string): OpeningScene | null {
  const text = (raw ?? "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    const scene = typeof parsed?.scene === "string" ? parsed.scene.trim() : "";
    const choices = Array.isArray(parsed?.choices)
      ? parsed.choices.filter((c: unknown): c is string => typeof c === "string" && c.trim().length > 0).map((c: string) => c.trim())
      : [];
    if (!scene || choices.length < 3) return null;
    return { scene, choices: [choices[0], choices[1], choices[2]] };
  } catch {
    return null;
  }
}

/** The placeholder shown when generation fails. It used to be English-only,
 *  which in a zh-TW game announced the failure to the players in the wrong
 *  language on the very first screen they ever see. */
function fallbackOpening(
  language: string | null | undefined,
  firstCharName: string,
  scenarioTitle: string
): OpeningScene {
  const isEnglish = (language ?? "").trim().toLowerCase().startsWith("en");
  if (isEnglish) {
    return {
      scene: `The adventure begins. The party stands at the threshold of ${scenarioTitle}.`,
      choices: [
        `${firstCharName} looks around carefully, assessing the surroundings`,
        `${firstCharName} moves forward cautiously, staying alert`,
        `${firstCharName} speaks up, addressing the group`,
      ],
    };
  }
  return {
    scene: `故事就此開始。眾人站在《${scenarioTitle}》的起點，空氣裡有種說不出的緊繃。`,
    choices: ["[偵查] 檢查四周", "[聆聽] 留神細聽", "與同伴商量下一步"],
  };
}

function buildGMContextBlock(ctx: ScenarioGMContext): string {
  const parts: string[] = [];
  if (ctx.openingScene) parts.push(`Opening Scene to narrate:\n${ctx.openingScene}`);
  if (ctx.npcs.length) {
    const npcLines = ctx.npcs.map((n) => {
      return `  - ${n.name} | HP ${n.hp} MP ${n.mp} | STR ${n.str} CON ${n.con} SIZ ${n.siz} DEX ${n.dex} APP ${n.app} INT ${n.int} POW ${n.pow} EDU ${n.edu} LUCK ${n.luck}\n    Personality: ${n.personality}\n    Goal: ${n.goal}`;
    }).join("\n");
    parts.push(`NPCs:\n${npcLines}`);
  }
  const partyObjectives = ctx.objectives.filter((o) => o.scope === "party");
  const eachObjectives = ctx.objectives.filter((o) => o.scope === "each_player");
  if (partyObjectives.length) parts.push(`Winning Targets — any ONE player completing each satisfies it:\n${partyObjectives.map((o) => `  - ${o.text}`).join("\n")}`);
  if (eachObjectives.length) parts.push(`Per-Player Targets — EVERY surviving player must personally complete each:\n${eachObjectives.map((o) => `  - ${o.text}`).join("\n")}`);
  if (ctx.failureConditions) parts.push(`Failure Conditions — if any occurs, the adventure ends in defeat:\n${ctx.failureConditions}`);
  if (ctx.failureTurnLimit != null) parts.push(`Failure Turn Limit: Game ends in defeat if round reaches ${ctx.failureTurnLimit}`);
  if (ctx.endingConditions) parts.push(`Additional Ending Notes:\n${ctx.endingConditions}`);
  if (ctx.gmNotes) parts.push(`Additional GM Notes:\n${ctx.gmNotes}`);
  if (ctx.sourceDocument) {
    parts.push(
      `FULL STORY — ORIGINAL MODULE TEXT (canonical; open the adventure faithfully to it, but reveal only what the opening scene should show):\n${ctx.sourceDocument}`
    );
  }
  if (!parts.length) return "";
  return `\nGM WORLD CONTEXT (never share this with players directly):\n${parts.join("\n\n")}`;
}

async function generateOpening(
  scenarioTitle: string,
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
${langBlock}${objective ? `Objective: ${objective}` : ""}
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

${openingInstruction} Then suggest exactly 3 possible first actions. Write each as the action itself WITHOUT naming any character and WITHOUT "you" (e.g. "檢查大門" / "examine the door", NOT "${firstCharName} examines the door") — the game already knows whose turn it is. Keep each short and action-only.

Respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{"scene":"<opening narration here>","choices":["<action 1>","<action 2>","<action 3>"]}`;

  const userMessage = "Begin the adventure.";

  if (!apiKey) {
    console.error("[opening] AI_API_KEY is not set — serving the placeholder opening scene.");
    return fallbackOpening(language, firstCharName, scenarioTitle);
  }

  // The opening is a GM narration, so it follows the "gm" call site's toggle.
  // WITHOUT this the request omitted the flag entirely — and DeepSeek V4
  // defaults reasoning ON, so the model spent the whole max_tokens budget
  // thinking and returned an empty string. JSON.parse("") then threw straight
  // into the silent catch below, which is why round 1 was ALWAYS the English
  // placeholder rather than occasionally.
  const thinking = await thinkingFragment("gm", provider);

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
          max_tokens: OPENING_MAX_TOKENS,
        }),
      });
      const data = await res.json();
      raw = data.content?.[0]?.text?.trim() ?? "";
    } else {
      const baseOverride = process.env.AI_BASE_URL?.trim().replace(/\/+$/, "");
      const defaultBase = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com";
      const baseUrl = baseOverride ?? defaultBase;
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
          max_tokens: OPENING_MAX_TOKENS,
          temperature: 0.85,
          ...thinking,
        }),
      });
      const data = await res.json();
      raw = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!raw) {
        const choice = data.choices?.[0];
        console.error(
          `[opening] HTTP 200 but EMPTY content (model=${model}, provider=${provider}, ` +
          `thinking=${Object.keys(thinking).length === 0 ? "enabled" : "disabled"}). ` +
          `finish_reason=${choice?.finish_reason} usage=${JSON.stringify(data.usage)} ` +
          `apiError=${JSON.stringify(data.error ?? null)}. ` +
          `reasoning_tokens at or near max_tokens=${OPENING_MAX_TOKENS} means reasoning ate the budget.`
        );
      }
    }

    const parsed = parseOpening(raw);
    if (parsed) return parsed;
    throw new Error(`unusable response (${raw.length} chars): ${JSON.stringify(raw.slice(0, 300))}`);
  } catch (err) {
    // NEVER silent: this fallback is the English placeholder players were
    // seeing on round 1 of every game, and the old bare `catch {}` gave no
    // way to tell an API failure from a parse failure.
    console.error(
      `[opening] generation failed for "${scenarioTitle}" (model=${model}, provider=${provider}) — ` +
      `serving the placeholder opening scene. Cause:`,
      err instanceof Error ? err.message : err
    );
    return fallbackOpening(language, firstCharName, scenarioTitle);
  }
}

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId } = await request.json() as { roomId: string };

  const { data: room } = await supabase
    .from("rooms")
    .select("*, scenarios(title, objective, rules, opening_scene, npcs, objectives, winning_targets, each_player_targets, failure_conditions, failure_turn_limit, ending_conditions, gm_notes, source_document, language, location_graph)")
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
  const structuredNpcs: NpcEntry[] = Array.isArray(scenario?.npcs)
    ? scenario.npcs.filter((n: any) => n && typeof n === "object" && typeof n.name === "string" && typeof n.hp === "number") as NpcEntry[]
    : [];
  const gmContext: ScenarioGMContext | null = scenario ? {
    openingScene: scenario.opening_scene ?? null,
    npcs: structuredNpcs,
    objectives: resolveScenarioObjectives(scenario.objectives, scenario.winning_targets, scenario.each_player_targets),
    failureConditions: scenario.failure_conditions ?? null,
    failureTurnLimit: scenario.failure_turn_limit ?? null,
    endingConditions: scenario.ending_conditions ?? null,
    gmNotes: scenario.gm_notes ?? null,
    sourceDocument: scenario.source_document ?? null,
  } : null;

  const opening = await generateOpening(
    scenario?.title ?? "Unknown Scenario",
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

  // === SEED THE LOCATION SYSTEM AT GAME START ===
  // The location panel (current location + travelable exits) only renders once
  // the room has a location_state. Initialise it here — when the opening scene
  // is created — so players know where they are and where they can go BEFORE
  // their first action, instead of the map appearing a turn late. Also reveal
  // the start node's discovers[]/unlocks and its scene image/intro text.
  const locationGraph = coerceLocationGraph((room as any).scenarios?.location_graph);
  let locationState: ReturnType<typeof initLocationState> | null = null;
  if (locationGraph) {
    locationState = initLocationState(locationGraph);
    if (locationState.current) {
      // Split-party: every character starts at the entry node.
      for (const c of sortedChars) locationState.positions[c.id] = locationState.current;
      const startNode = locationGraph.nodes.find((n) => n.id === locationState!.current);
      // Starting scene media (image/text) — the start node is never "arrived
      // at", so reveal it here or it never shows.
      const startImage = startNode?.node_image?.trim();
      const startText = startNode?.node_text?.trim();
      if (startImage || startText) {
        await supabase.from("story_logs").insert({
          room_id: roomId,
          round_number: 1,
          entry_type: "location_media",
          content:
            startText && startText.length > 0
              ? startText
              : `📍 你身處「${locationShortName(startNode!.name)}」。`,
          media_url: startImage || null,
        });
      }
      // Reveal neighbours the start node discovers, and unlock any node whose
      // conditions are already met (e.g. visit:<start>). Only unlocks announce
      // (one merged line); discovered-but-locked places just show 🔒 on the map.
      applyDiscovers(locationGraph, locationState, locationState.current);
      const unlocks = evaluateUnlocks(locationGraph, locationState, 1, {});
      if (unlocks.unlocked.length) {
        await supabase.from("story_logs").insert({
          room_id: roomId,
          round_number: 1,
          entry_type: "system",
          content: `🗺 新地點解鎖：${unlocks.unlocked.map((n) => locationShortName(n.name)).join("、")}`,
        });
      }
    }
  }

  await supabase.from("rooms").update({
    current_choices: opening.choices,
    current_choices_for_player_id: firstPlayerId,
    ...(locationState ? { location_state: locationState } : {}),
  }).eq("id", roomId);

  return NextResponse.json({ ...opening, choicesForPlayerId: firstPlayerId });
}
