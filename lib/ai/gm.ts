export interface ScenarioGMContext {
  openingScene: string | null;
  sceneFlow: string | null;
  secretRules: string | null;
  locations: string[];
  npcs: string[];
  clues: string[];
  threats: string[];
  traps: string[];
  keyItems: string[];
  endingConditions: string | null;
  gmNotes: string | null;
}

export interface GMAIInput {
  scenarioTitle: string;
  scenarioBackground: string | null;
  scenarioObjective: string | null;
  scenarioRules: string | null;
  scenarioLanguage?: string | null;
  scenarioGMContext?: ScenarioGMContext | null;
  characters: Array<{ name: string; playerName?: string | null; background: string | null; speed: number; hp: number; str: number; agi: number; int: number; cha: number; luck: number; san: number }>;
  storyLogSoFar: string[];
  currentRound: number;
  /** The character who just submitted the action — narration resolves THIS actor. */
  actingCharacterName: string;
  /** The character whose turn is now active — suggested choices are for THIS actor. */
  nextCharacterName: string;
  playerAction: string;
  /** Resolved dice outcome the GM MUST follow (null when no check was needed). */
  resolution?: {
    requiresCheck: boolean;
    statUsed: string | null;
    d20: number | null;
    modifier: number | null;
    dc: number | null;
    total: number | null;
    outcome: string | null;
    consequenceSummary: string;
    hpChange: number;
    sanChange: number;
    actorDied: boolean;
    actorBroke: boolean;
  } | null;
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
  const userMessage = buildTurnMessage(input);

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

/**
 * STATIC roster line — identity + immutable base attributes only (no HP/SAN,
 * no per-turn acting marker). Lives in the cacheable system prefix because it
 * never changes during a room's session.
 */
export function buildStaticRoster(characters: GMAIInput["characters"]): string {
  return characters
    .map((c) => {
      const player = c.playerName ? ` [player: ${c.playerName}]` : "";
      return `- ${c.name}${player}: STR ${c.str}, AGI ${c.agi}, INT ${c.int}, CHA ${c.cha}, LUCK ${c.luck}, SPEED ${c.speed}${c.background ? ` | Background: ${c.background}` : ""}`;
    })
    .join("\n");
}

/**
 * DYNAMIC per-turn status — the values that change every turn (HP/SAN, downed
 * state, who is acting). Lives in the user message, AFTER the cached prefix.
 */
export function buildLiveStatus(
  characters: GMAIInput["characters"],
  actingCharacterName?: string
): string {
  return characters
    .map((c) => {
      const acting = actingCharacterName && c.name === actingCharacterName ? " ← ACTING THIS TURN" : "";
      const down = c.hp <= 0 ? " (DOWN)" : "";
      return `- ${c.name}: HP ${c.hp}, SAN ${c.san}${down}${acting}`;
    })
    .join("\n");
}

const LANGUAGE_LABELS: Record<string, string> = {
  "zh-TW": "Traditional Chinese (繁體中文)",
  "zh-CN": "Simplified Chinese (简体中文)",
  "en": "English",
  "ja": "Japanese (日本語)",
  "ko": "Korean (한국어)",
};

export function buildLanguageInstruction(language: string | null | undefined): string {
  if (!language || language === "auto") return "";
  const label = LANGUAGE_LABELS[language] ?? language;
  return `\nLANGUAGE RULE: This scenario is written in ${label}. You MUST write ALL narration, all suggested player actions, and all responses in ${label}. Do NOT switch to English or any other language under any circumstances.\n`;
}

export const ROSTER_CONSTRAINT =
  "STRICT ROSTER RULE: The party roster below is the COMPLETE and ONLY list of player characters. " +
  "You MUST only use these exact character names. Do NOT invent, rename, or add any new protagonist, " +
  "main character, hero, party member, companion, or player character. Do NOT use generic placeholders " +
  'like "the adventurer" or "you". Every player character you mention must come from this roster.';

function buildGMContextBlock(ctx: ScenarioGMContext): string {
  const parts: string[] = [];
  if (ctx.openingScene) parts.push(`Opening Scene Context:\n${ctx.openingScene}`);
  if (ctx.sceneFlow) parts.push(`Scene Flow & Progression (follow this spine; advance scenes as their triggers are met):\n${ctx.sceneFlow}`);
  if (ctx.locations.length) parts.push(`Key Locations:\n${ctx.locations.map((l) => `  - ${l}`).join("\n")}`);
  if (ctx.npcs.length) parts.push(`NPCs (play them per their goals, knowledge, and reactions):\n${ctx.npcs.map((n) => `  - ${n}`).join("\n")}`);
  if (ctx.clues.length) parts.push(`Clues (reveal when players investigate the right place/way):\n${ctx.clues.map((c) => `  - ${c}`).join("\n")}`);
  if (ctx.threats.length) parts.push(`Threats & Enemies:\n${ctx.threats.map((t) => `  - ${t}`).join("\n")}`);
  if (ctx.traps.length) parts.push(`Traps & Hazards:\n${ctx.traps.map((t) => `  - ${t}`).join("\n")}`);
  if (ctx.keyItems.length) parts.push(`Key Items:\n${ctx.keyItems.map((i) => `  - ${i}`).join("\n")}`);
  if (ctx.secretRules) parts.push(`GM Rules & Pacing:\n${ctx.secretRules}`);
  if (ctx.endingConditions) parts.push(`Victory/Failure Conditions (all branches):\n${ctx.endingConditions}`);
  if (ctx.gmNotes) parts.push(`Additional GM Notes:\n${ctx.gmNotes}`);
  if (!parts.length) return "";
  return `\nGM WORLD CONTEXT (never share this with players directly):\n${parts.join("\n\n")}`;
}

/**
 * STATIC system prompt — identical for every turn of a given room, so providers
 * with automatic prefix caching (DeepSeek, OpenAI) and Anthropic's explicit
 * cache_control can reuse it. Contains NOTHING that changes per turn: no HP/SAN,
 * no acting/next names, no dice result, no round number, no story log. All of
 * that dynamic content lives in the user message (see buildTurnMessage).
 */
function buildSystemPrompt(input: GMAIInput): string {
  const partySize = input.characters.length;
  const roster = buildStaticRoster(input.characters);
  const names = input.characters.map((c) => c.name).join(", ");

  const gmCtxBlock = input.scenarioGMContext ? buildGMContextBlock(input.scenarioGMContext) : "";
  const langBlock = buildLanguageInstruction(input.scenarioLanguage);

  return `You are an AI Game Master running a multiplayer TRPG text adventure called "${input.scenarioTitle}".
${langBlock}${input.scenarioBackground ? `\nBackground: ${input.scenarioBackground}` : ""}
${input.scenarioObjective ? `\nObjective: ${input.scenarioObjective}` : ""}
${input.scenarioRules ? `\nSpecial Rules: ${input.scenarioRules}` : ""}
${gmCtxBlock}

${ROSTER_CONSTRAINT}

PARTY ROSTER (${partySize} character${partySize > 1 ? "s" : ""}) — the only valid character names are: ${names}
${roster}

NARRATION RULES:
- This is a MULTIPLAYER game. Narrate in THIRD PERSON as a neutral Game Master.
- NEVER use "you". Refer to every character by their exact roster name.
- Each turn, ONE character acts. Your narration must resolve and describe the outcome of THAT acting character's action, acknowledging other roster members when relevant.
- After narrating, it becomes the NEXT character's turn. The 3 suggested next actions MUST be written for the NEXT acting character, NOT the character who just acted.
- Write the suggested actions in third person for the next character (e.g., "<Name> searches the room" not "Search the room" or "You search the room").

DICE SYSTEM:
- Each turn may include a resolved dice result. When one is provided, it is FINAL — you MUST obey it. Do NOT change a failure into a success, and do NOT rescue the actor with a lucky coincidence unless the outcome itself is a success. A failure must visibly cost the actor something.
- When a turn states no dice check was needed, narrate the action naturally without inventing a dramatic success or failure.

OUTPUT FORMAT — Respond ONLY with valid JSON, no markdown, no extra text:
{"narration":"<2-4 sentence third-person narration of the acting character's outcome>","choices":["<next character action 1>","<next character action 2>","<next character action 3>"]}`;
}

/**
 * DYNAMIC per-turn user message — everything that changes each turn. Placed
 * AFTER the cached static system prefix so the cacheable portion stays stable.
 */
export function buildTurnMessage(input: GMAIInput): string {
  const liveStatus = buildLiveStatus(input.characters, input.actingCharacterName);
  const diceBlock = buildDiceDirective(input);
  const recentLog = input.storyLogSoFar.slice(-10).join("\n");

  return `CURRENT PARTY STATUS (Round ${input.currentRound}):
${liveStatus}

ACTING THIS TURN: ${input.actingCharacterName}
NEXT TO ACT: ${input.nextCharacterName}
${diceBlock}
RECENT STORY LOG:
${recentLog || "(Adventure just started)"}

${input.actingCharacterName} declares: "${input.playerAction}"

Narrate the outcome of ${input.actingCharacterName}'s action (2-4 sentences, third person), then suggest 3 next actions for ${input.nextCharacterName} (whose turn is now active). Respond ONLY with the JSON object described in the system instructions.`;
}

function buildDiceDirective(input: GMAIInput): string {
  const r = input.resolution;
  if (!r) return "";
  if (!r.requiresCheck) {
    return `\nDICE RESULT: ${input.actingCharacterName}'s action was low-risk and needed no dice check. Narrate it naturally without inventing a dramatic success or failure.\n`;
  }
  const deathNote = r.actorDied
    ? ` IMPORTANT: ${input.actingCharacterName}'s HP has dropped to 0 — ${input.actingCharacterName} DIES in this room as a result. Narrate this death clearly and somberly. ${input.actingCharacterName} can no longer act.`
    : r.actorBroke
    ? ` IMPORTANT: ${input.actingCharacterName}'s SAN has dropped to 0 — ${input.actingCharacterName}'s mind BREAKS and they lose control in this room. Narrate this clearly. ${input.actingCharacterName} can no longer act normally.`
    : "";
  return `
DICE RESULT (THIS IS FINAL — YOU MUST OBEY IT):
- ${input.actingCharacterName} attempted an action requiring a ${r.statUsed?.toUpperCase()} check.
- Roll: d20(${r.d20}) + modifier(${(r.modifier ?? 0) >= 0 ? "+" : ""}${r.modifier}) = ${r.total} vs DC ${r.dc}
- OUTCOME: ${r.outcome?.replace("_", " ").toUpperCase()}
- Mechanical consequence: ${r.consequenceSummary}${r.hpChange ? ` HP ${r.hpChange}.` : ""}${r.sanChange ? ` SAN ${r.sanChange}.` : ""}${deathNote}

STRICT DICE RULE: The dice result is final. Do NOT change a failure into a success. Do NOT rescue ${input.actingCharacterName} with a lucky coincidence unless the outcome itself is a success. Narrate exactly what the outcome dictates, and describe the consequences clearly and concretely. A failure must visibly cost ${input.actingCharacterName} something.
`;
}

async function callOpenAICompatible(apiKey: string, model: string, system: string, user: string, baseUrl: string): Promise<string> {
  // DeepSeek and OpenAI both perform AUTOMATIC prompt caching on the longest
  // repeated prefix — no explicit markers needed. Because `system` is now fully
  // static per room (all dynamic content moved into `user`), the system prefix
  // is reused across every turn and billed at the cheaper cache-hit rate.
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
      // Mark the static system prefix as cacheable. Anthropic caches up to this
      // breakpoint, so repeated turns within a room reuse the cached prefix
      // (the dynamic per-turn content is sent separately in `messages`).
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
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
