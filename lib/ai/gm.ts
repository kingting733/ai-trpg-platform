export interface LedgerEntry {
  turn: number;
  type: string;
  character: string;
  fact: string;
}

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
  winningTargets: string | null;
  eachPlayerTargets: string | null;
  failureConditions: string | null;
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
  characters: Array<{
    name: string; playerName?: string | null; background: string | null;
    dex: number; hp: number; san: number; mp: number;
    str: number; con: number; siz: number; app: number;
    int: number; pow: number; edu: number; luck: number;
  }>;
  /** Compressed arc of older turns — stays ~2 sentences regardless of game length. */
  storySummary: string | null;
  /** Structured key facts that must never be dropped (clues found, deaths, etc.). */
  storyLedger: LedgerEntry[];
  /** Last 3 raw turns for immediate continuity. */
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
    target: number | null;   // roll-under value (skill or stat %)
    d100: number | null;
    outcome: string | null;
    consequenceSummary: string;
    hpChange: number;
    sanChange: number;
    actorDied: boolean;
    actorBroke: boolean;
    sanCheck?: {
      severityLabel: string;
      pow: number;
      roll: number;
      success: boolean;
      sanLoss: number;
    } | null;
  } | null;
}

export interface GMResponseWithChoices {
  narration: string;
  choices: [string, string, string];
  /** 0-2 short player-visible facts to persist in the story ledger (e.g. "found the key"). */
  memory?: string[];
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
      return `- ${c.name}${player}${acting}: HP ${c.hp}, SAN ${c.san}, MP ${c.mp}, STR ${c.str}, CON ${c.con}, SIZ ${c.siz}, DEX ${c.dex}, APP ${c.app}, INT ${c.int}, POW ${c.pow}, EDU ${c.edu}, LUCK ${c.luck}${c.background ? ` | Background: ${c.background}` : ""}`;
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
      return `- ${c.name}${player}: STR ${c.str}, CON ${c.con}, SIZ ${c.siz}, DEX ${c.dex}, APP ${c.app}, INT ${c.int}, POW ${c.pow}, EDU ${c.edu}, LUCK ${c.luck}${c.background ? ` | Background: ${c.background}` : ""}`;
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
      return `- ${c.name}: HP ${c.hp}, SAN ${c.san}, MP ${c.mp}${down}${acting}`;
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
  if (ctx.winningTargets) parts.push(`Winning Targets — any ONE player completing each satisfies it (game ends when all required ones are met):\n${ctx.winningTargets}`);
  if (ctx.eachPlayerTargets) parts.push(`Per-Player Targets — EVERY surviving player must personally complete each of these:\n${ctx.eachPlayerTargets}`);
  if (ctx.failureConditions) parts.push(`Failure Conditions — if any of these occurs, the adventure ends in defeat. Steer outcomes honestly; do not contrive to avoid them:\n${ctx.failureConditions}`);
  if (ctx.endingConditions) parts.push(`Additional Ending Notes:\n${ctx.endingConditions}`);
  if (ctx.gmNotes) parts.push(`Additional GM Notes:\n${ctx.gmNotes}`);
  // source_document intentionally omitted: curated fields above already capture
  // all structured knowledge; injecting the full raw module every turn would
  // blow the prefix cache on every cold start and cost 10× more per cache miss.
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
- TONE & ATMOSPHERE: Match the mood of the genre and setting at all times (e.g. dread and tension for horror, wonder for fantasy, grit for cyberpunk). Use sensory detail to keep the world vivid and immersive.
- INFORMATION GATING (STRICT): Clues, secrets, and key plot information are LOCKED behind skill checks. Rules:
  (a) If no dice check was made, describe only what is visible to the naked eye — surfaces, sounds, smells. Reveal NOTHING about hidden contents, secrets, or puzzle answers.
  (b) If a dice check FAILED or CRITICALLY FAILED, the character learns nothing useful (or worse, is misled). Do NOT accidentally slip in the real answer.
  (c) Only on a SUCCESS or CRITICAL SUCCESS for the correct type of investigation (spot hidden, library use, psychology, etc.) may you reveal one specific clue. A critical success may reveal a bonus detail.
  (d) Entering a room or location alone reveals ZERO clues. A character must actively declare an investigation action AND pass the check to find anything.
  (e) NEVER summarise the full plot, all suspects, all item locations, or the solution unprompted.
- NO RAILROADING: Let players solve problems their own way. React fairly to creative or unexpected actions instead of forcing them back onto a scripted path. Never override player choices to make the "intended" plot happen; advance scenes only as their triggers are genuinely met.

DICE SYSTEM:
- Each turn may include a resolved dice result. When one is provided, it is FINAL — you MUST obey it. Do NOT change a failure into a success, and do NOT rescue the actor with a lucky coincidence unless the outcome itself is a success. A failure must visibly cost the actor something.
- When a turn states no dice check was needed, narrate the action naturally without inventing a dramatic success or failure.

NARRATION FORMAT:
- Write 3-5 paragraphs separated by blank lines (\\n\\n).
- Use **bold text** for important names, locations, or dramatic moments.
- First paragraph: immediate outcome of the action.
- Middle paragraph(s): atmosphere, NPC reactions, environmental details.
- Last paragraph: what the characters notice or feel as the scene settles.
- Do NOT use bullet points or numbered lists inside the narration.

OUTPUT: Respond ONLY with valid JSON as specified in the user message each turn.`;
}

/**
 * DYNAMIC per-turn user message — everything that changes each turn. Placed
 * AFTER the cached static system prefix so the cacheable portion stays stable.
 *
 * Memory architecture keeps this message small:
 *   - storySummary: 2 sentences covering everything older than the last few turns
 *   - storyLedger: structured list of key facts (clues, deaths, objectives)
 *   - storyLogSoFar: only the last 3 raw turns for immediate continuity
 */
export function buildTurnMessage(input: GMAIInput): string {
  const liveStatus = buildLiveStatus(input.characters, input.actingCharacterName);
  const diceBlock = buildDiceDirective(input);
  const recentLog = input.storyLogSoFar.slice(-3).join("\n");

  const summaryBlock = input.storySummary
    ? `STORY SO FAR:\n${input.storySummary}\n`
    : "";

  const ledgerBlock = input.storyLedger.length
    ? `KEY FACTS (clues found, deaths, important events — never forget these):\n${input.storyLedger.map((e) => `[Turn ${e.turn}] ${e.character}: ${e.fact}`).join("\n")}\n`
    : "";

  return `CURRENT PARTY STATUS (Round ${input.currentRound}):
${liveStatus}

ACTING THIS TURN: ${input.actingCharacterName}
NEXT TO ACT: ${input.nextCharacterName}
${diceBlock}
${summaryBlock}${ledgerBlock}RECENT TURNS:
${recentLog || "(Adventure just started)"}

${input.actingCharacterName} declares: "${input.playerAction}"

Narrate the outcome of ${input.actingCharacterName}'s action (6-8 sentences, third person, rich in atmosphere and sensory detail; reveal information only as it is actively uncovered), then suggest 3 next actions for ${input.nextCharacterName} (whose turn is now active).

OUTPUT FORMAT — Respond ONLY with valid JSON, no markdown, no extra text:
{"narration":"<paragraphs separated by \\n\\n, **bold** for emphasis>","choices":["<next character action 1>","<next character action 2>","<next character action 3>"],"memory":["<0 to 2 short player-visible facts worth remembering, e.g. found a key, met an NPC. Omit if nothing notable happened.>"]}`;
}

// Context-sensitive guidance for critical outcomes, keyed by stat and action text.
function criticalGuidance(
  outcome: "critical_success" | "critical_failure",
  skillOrStat: string | null,
): string {
  const s = (skillOrStat ?? "").toLowerCase();

  if (outcome === "critical_success") {
    if (s === "偵查")         return "找到線索，且額外發現一個隱藏細節——向玩家揭示一條額外資訊。";
    if (s === "聆聽")         return "聽到了異常聲音，並得知其確切方向或來源。";
    if (s === "圖書館使用")   return "找到資料，並意外發現一個相關的額外線索。";
    if (s === "心理學")       return "完全看穿對方——揭示NPC隱藏的動機或祕密。";
    if (s === "說服")         return "對方完全被說服，主動提供額外幫助、資訊或善意。";
    if (s === "話術")         return "謊言天衣無縫，對方完全相信並配合。";
    if (s === "魅惑")         return "對方深受吸引，主動提供協助、資訊或額外好感。";
    if (s === "恐嚇")         return "對方被嚇到完全屈服，甚至主動洩露資訊。";
    if (s === "閃避")         return "完美閃避，並發現一個反擊或脫逃的機會。";
    if (s === "急救")         return "治療效果極佳——額外恢復1 HP，且無後遺症。";
    if (s === "潛行")         return "毫無痕跡——同時發現一條有用的隱蔽路線或藏身處。";
    if (s === "開鎖")         return "無聲無息開鎖，無損壞，無痕跡。";
    if (s === "駕駛汽車")     return "完美操控——最佳位置，加快速度，未引起注意。";
    if (s === "str")          return "命中要害——描述一次有效打擊，給予明顯戰術優勢。";
    return "超乎預期——描述一個超過原本目標的額外收益或發現。";
  } else {
    if (s === "偵查")         return "不但什麼都沒找到，還把假線索當真——誤導調查方向。";
    if (s === "聆聽")         return "什麼都沒聽到，甚至因為動作暴露了自己的位置。";
    if (s === "圖書館使用")   return "找到錯誤資料，角色信以為真——設下一條錯誤的軌跡。";
    if (s === "心理學")       return "完全誤判對方——產生錯誤結論，後患無窮。";
    if (s === "說服")         return "對方不但不信，還對角色產生敵意或懷疑。";
    if (s === "話術")         return "謊言被識破，對方現在戒心大增或準備反擊。";
    if (s === "魅惑")         return "對方反感，可能向他人散播負面印象或拒絕進一步接觸。";
    if (s === "恐嚇")         return "對方非但不怕，反而更加憤怒或決心對抗。";
    if (s === "閃避")         return "閃避失敗，承受全部傷害，並陷入不利的位置。";
    if (s === "急救")         return "讓傷勢更嚴重，或浪費了關鍵醫療物資。";
    if (s === "潛行")         return "發出聲響或完全暴露位置——描述被察覺的後果。";
    if (s === "開鎖")         return "工具斷裂或鎖被卡死，入口已無法再使用。";
    if (s === "駕駛汽車")     return "失控——撞車、打滑，或引起嘈雜的注意。";
    if (s === "str")          return "攻擊反噬——武器卡住、失去平衡或誤傷。";
    return "不但失敗，還帶來新的危機——描述一個新的危險、暴露或連鎖後果。";
  }
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

  const isCrit = r.outcome === "critical_success" || r.outcome === "critical_failure";
  const critLine = isCrit
    ? `\n- CRITICAL NARRATION GUIDE: ${criticalGuidance(r.outcome as "critical_success" | "critical_failure", r.statUsed)}`
    : "";

  const sc = r.sanCheck;
  const sanLine = sc
    ? `\n- SAN CHECK (${sc.severityLabel}): ${input.actingCharacterName} rolled d100 ${sc.roll} vs POW ${sc.pow} → ${sc.success ? "held their nerve" : "FAILED"}, losing ${sc.sanLoss} SAN. Narrate the psychological impact of witnessing this horror: ${sc.success ? "shaken but composed" : "a visible crack in their sanity — trembling, nausea, dread, or a brief loss of composure"}. Do NOT downplay the horror.`
    : "";

  return `
DICE RESULT (THIS IS FINAL — YOU MUST OBEY IT):
- ${input.actingCharacterName} attempted an action requiring a ${r.statUsed?.toUpperCase()} check.
- d100 roll: ${r.d100} vs target ${r.target}% → OUTCOME: ${r.outcome?.replace(/_/g, " ").toUpperCase()}
- Mechanical consequence: ${r.consequenceSummary}${r.hpChange ? ` HP ${r.hpChange}.` : ""}${r.sanChange ? ` SAN ${r.sanChange}.` : ""}${deathNote}${critLine}${sanLine}

STRICT DICE RULE: The dice result is final. Do NOT change a failure into a success. Do NOT rescue ${input.actingCharacterName} with a lucky coincidence unless the outcome itself is a success. Narrate exactly what the outcome dictates, and describe the consequences clearly and concretely. A failure must visibly cost ${input.actingCharacterName} something.
INFORMATION RULE: If the outcome is FAILURE or CRITICAL FAILURE on an investigation/search check, ${input.actingCharacterName} finds NOTHING useful. Do not reveal any clue, secret, or hidden information. Describe only the fruitless attempt and the cost.
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
      max_tokens: 900,
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
      max_tokens: 900,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error: ${err}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text?.trim() ?? "[No response from AI]";
}
