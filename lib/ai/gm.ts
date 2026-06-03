export interface GMAIInput {
  scenarioTitle: string;
  scenarioBackground: string | null;
  scenarioObjective: string | null;
  scenarioRules: string | null;
  characters: Array<{ name: string; playerName?: string | null; background: string | null; speed: number; hp: number; str: number; agi: number; int: number; cha: number; luck: number; san: number }>;
  storyLogSoFar: string[];
  currentRound: number;
  actingCharacterName: string;
  playerAction: string;
}

export interface GMResponseWithChoices {
  narration: string;
  choices: [string, string, string];
}

export async function generateGMResponse(input: GMAIInput): Promise<GMResponseWithChoices> {
  const provider = process.env.AI_PROVIDER ?? "deepseek";
  const model = process.env.AI_MODEL ?? "deepseek-chat";
  const apiKey = process.env.AI_API_KEY;

  if (!apiKey) {
    return {
      narration: "[AI GM is not configured. Set AI_PROVIDER, AI_MODEL, and AI_API_KEY in your environment variables.]",
      choices: ["Look around carefully", "Move forward cautiously", "Wait and listen"],
    };
  }

  const systemPrompt = buildSystemPrompt(input);
  const userMessage = `${input.actingCharacterName} declares: "${input.playerAction}"`;

  try {
    let raw = "";
    if (provider === "anthropic") {
      raw = await callAnthropic(apiKey, model, systemPrompt, userMessage);
    } else {
      const baseUrl = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com";
      raw = await callOpenAICompatible(apiKey, model, systemPrompt, userMessage, baseUrl);
    }
    raw = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(raw) as GMResponseWithChoices;
    if (parsed.narration && Array.isArray(parsed.choices) && parsed.choices.length === 3) {
      return parsed;
    }
    throw new Error("Invalid shape");
  } catch {
    return {
      narration: "[GM response could not be parsed. Please try again.]",
      choices: ["Look around carefully", "Move forward cautiously", "Wait and listen"],
    };
  }
}

/** Builds the explicit party roster shared by opening and turn prompts. */
export function buildPartyRoster(
  characters: GMAIInput["characters"],
  actingCharacterName?: string
): string {
  return characters
    .map((c) => {
      const acting = actingCharacterName && c.name === actingCharacterName ? " ← ACTING THIS TURN" : "";
      const player = c.playerName ? ` [player: ${c.playerName}]` : "";
      return `- ${c.name}${player}${acting}: HP ${c.hp}, SAN ${c.san}, STR ${c.str}, AGI ${c.agi}, INT ${c.int}, CHA ${c.cha}, LUCK ${c.luck}, SPEED ${c.speed}${c.background ? ` | Background: ${c.background}` : ""}`;
    })
    .join("\n");
}

export const ROSTER_CONSTRAINT =
  "STRICT ROSTER RULE: The party roster below is the COMPLETE and ONLY list of player characters. " +
  "You MUST only use these exact character names. Do NOT invent, rename, or add any new protagonist, " +
  "main character, hero, party member, companion, or player character. Do NOT use generic placeholders " +
  'like "the adventurer" or "you". Every player character you mention must come from this roster.';

function buildSystemPrompt(input: GMAIInput): string {
  const partySize = input.characters.length;
  const charList = buildPartyRoster(input.characters, input.actingCharacterName);
  const names = input.characters.map((c) => c.name).join(", ");

  const recentLog = input.storyLogSoFar.slice(-10).join("\n");

  return `You are an AI Game Master running a multiplayer TRPG text adventure called "${input.scenarioTitle}".
${input.scenarioBackground ? `\nBackground: ${input.scenarioBackground}` : ""}
${input.scenarioObjective ? `\nObjective: ${input.scenarioObjective}` : ""}
${input.scenarioRules ? `\nSpecial Rules: ${input.scenarioRules}` : ""}

${ROSTER_CONSTRAINT}

PARTY ROSTER (${partySize} character${partySize > 1 ? "s" : ""}) — the only valid character names are: ${names}
${charList}

NARRATION RULES:
- This is a MULTIPLAYER game. Narrate in THIRD PERSON as a neutral Game Master.
- NEVER use "you". Refer to every character by their exact roster name.
- The acting character this turn is ${input.actingCharacterName}. Focus on their action, but acknowledge other roster members when relevant.
- The 3 suggested next actions must be written for ${input.actingCharacterName} in third person (e.g., "${input.actingCharacterName} searches the room" not "Search the room" or "You search the room").

Round ${input.currentRound}. Recent story log:
${recentLog || "(Adventure just started)"}

Respond to ${input.actingCharacterName}'s action with vivid third-person narration (2-4 sentences), then suggest 3 possible next actions for ${input.actingCharacterName}.

Respond ONLY with valid JSON, no markdown, no extra text:
{"narration":"<2-4 sentence third-person narration>","choices":["<${input.actingCharacterName} action 1>","<${input.actingCharacterName} action 2>","<${input.actingCharacterName} action 3>"]}`;
}

async function callOpenAICompatible(apiKey: string, model: string, system: string, user: string, baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 500,
      temperature: 0.8,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI API error: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "[No response from AI]";
}

async function callAnthropic(apiKey: string, model: string, system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system,
      messages: [{ role: "user", content: user }],
      max_tokens: 500,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error: ${err}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text?.trim() ?? "[No response from AI]";
}
