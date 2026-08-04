// Scene-locked choice generation for split parties.
//
// WHY THIS EXISTS: when the next actor stands in a DIFFERENT location than the
// scene just narrated, asking the narrating GM to also write the next actor's
// choices kept leaking the acting scene into them. Every text-level filter
// failed the same way: the GM names OBJECTS from its own narration (供桌, 香爐,
// a crack in the wall) which exist in no structured data, so no blacklist can
// catch them. The only airtight guarantee is ISOLATION: this module makes a
// separate, tiny AI call whose entire context is the next actor's own location.
// It cannot mention the other scene because it has never seen it.
//
// The call runs IN PARALLEL with the main narration call (it does not depend on
// the narration — the actor's turn cannot change the next actor's scene), so it
// adds no latency. On failure/empty output the route falls back to
// composeSceneChoices (deterministic, creator-authored data).

import { callAI } from "@/lib/ai/objectives";

export interface SceneChoicesInput {
  /** The character these 3 buttons are for. */
  characterName: string;
  /** Their location: name, optional region, GM scene notes. */
  nodeName: string;
  regionName?: string | null;
  nodeDesc?: string | null;
  /** NPCs actually placed at this node (alive). */
  npcsHere: string[];
  /** Open exits FROM this node (server-computed). */
  exitsOpen: string[];
  /** The subset of exitsOpen nobody in the party has ever entered. Movement
   *  suggestions should prefer these — without the split, the model just picks
   *  whichever exit is listed first, which is usually where they came from. */
  exitsUnvisited?: string[];
  /** Ledger facts that happened AT this node — the scene's own story. */
  sceneFacts: string[];
  /** The character's most recent action text, if any (their own thread). */
  lastAction?: string | null;
  /** The GM narration that answered that action — i.e. the last thing that
   *  happened TO THIS CHARACTER, in their own scene. This is the richest
   *  "what's going on right now" signal; ledger facts alone are too terse
   *  ("取得證物X") to write choices that follow the story. Isolation-safe: it
   *  describes THIS character's scene, never the acting player's. */
  lastNarration?: string | null;
  /** zh skill names usable as [tags], e.g. 偵查/聆聽/心理學. */
  skillTags: string[];
}

/** Pure prompt builder — testable, and the isolation guarantee lives here:
 *  the input type simply has no field that could carry another scene. */
export function buildSceneChoicesPrompt(input: SceneChoicesInput): { system: string; user: string } {
  const system = `你是跑團平台的「建議行動」產生器。你只知道下面描述的這一個場景，為指定角色寫出 3 個此刻可行的建議行動按鈕。

規則（嚴格）：
1. 只能根據下面提供的場景資訊。不要發明這裡沒提到的人物、物件或地點。
2. 每個行動 6–15 個中文字，可在最前面加一個技能標籤，格式「[技能] 行動」。技能只能從允許清單挑選。
3. 行動只有兩種：
   (a) 在此地點做一件事 —— 不要寫出目前所在地點的名字（角色就站在那裡，寫了是多餘的）。
   (b) 移動 —— 必須寫成「前往<出口名>」，不可用其他動詞、不可附加任何子句，
       而且**不可加技能標籤**（走去一個已知的出口不需要檢定）。
       如果有「未去過的出口」，移動一定要優先選那些；沒有才可以選去過的地方。
   一個行動最多只能提到一個地點，而且要用出口清單上的完整名稱（例如「1404門口」，不可簡寫成「門口」）。
   提到兩個地點的行動會被系統直接丟棄（例如「行近門口，望走廊外面」）。
4. 三個行動要彼此不同（例如：一個調查、一個社交/聆聽、一個移動或謹慎行動）。
   **最重要**：如果有提供「眼前最新的情況」，行動必須直接回應那段敘述裡剛發生的事、剛出現的東西或剛聽到的聲音，
   不要寫「檢查四周」這種放諸四海皆準的空泛選項。
5. 只輸出一個 JSON 陣列，例如 ["[偵查] 檢查供桌","與王伯交談","前往走廊"]。不要任何其他文字。`;

  const lines: string[] = [];
  lines.push(`角色：${input.characterName}`);
  lines.push(`所在地點：${input.regionName ? `${input.regionName} › ` : ""}${input.nodeName}`);
  if (input.nodeDesc?.trim()) lines.push(`場景描述：${input.nodeDesc.trim()}`);
  lines.push(input.npcsHere.length ? `在場 NPC：${input.npcsHere.join("、")}` : "在場 NPC：無");
  lines.push(input.exitsOpen.length ? `可前往的出口：${input.exitsOpen.join("、")}` : "可前往的出口：無");
  if (input.exitsUnvisited?.length) {
    lines.push(`未去過的出口（移動時優先選這些）：${input.exitsUnvisited.join("、")}`);
  }
  if (input.sceneFacts.length) lines.push(`此地已發生的事：${input.sceneFacts.join("；")}`);
  if (input.lastAction?.trim()) lines.push(`${input.characterName} 上一個行動：${input.lastAction.trim()}`);
  if (input.lastNarration?.trim()) {
    lines.push(`${input.characterName} 眼前最新的情況（主持人上次對他/她敘述的內容）：\n${input.lastNarration.trim()}`);
  }
  lines.push(`允許的技能標籤：${input.skillTags.join("、")}`);
  return { system, user: lines.join("\n") };
}

/** Pure parser — accepts a raw JSON array, a fenced one, or line-split text. */
export function parseSceneChoices(raw: string): string[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  // Try a JSON array first (possibly inside fences or surrounding prose).
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const arr = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(arr)) {
        return arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()).slice(0, 3);
      }
    } catch {
      // fall through to line splitting
    }
  }
  return text
    .split("\n")
    .map((l) => l.replace(/^[\s\-*\d.、]+/, "").trim())
    .filter((l) => l.length >= 2 && l.length <= 40 && !/^```/.test(l))
    .slice(0, 3);
}

/**
 * Generate scene-locked choices. Empty array on any failure — the caller falls
 * back to composeSceneChoices, never to nothing.
 *
 * Budget: this used to request only 200 tokens, which is enough for the answer
 * but NOT for a model that emits any preamble or reasoning first — those
 * returned HTTP 200 with empty content (finish_reason "length"), so the
 * deterministic fallback fired every single turn and the buttons looked frozen.
 * Everything else in this codebase gives JSON calls 600–900.
 *
 * Temperature: deliberately well above callAI's 0.1 default — these are
 * creative suggestions, and near-greedy sampling on a barely-changing scene
 * produced near-identical options round after round.
 */
export async function generateSceneChoices(input: SceneChoicesInput): Promise<string[]> {
  const { system, user } = buildSceneChoicesPrompt(input);
  const maxTokens = Number(process.env.AI_CLASSIFY_MAX_TOKENS) || 700;
  const temperature = Number(process.env.AI_CHOICES_TEMPERATURE) || 0.8;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await callAI(system, user, maxTokens, "scene-choices", temperature);
    const parsed = parseSceneChoices(raw);
    if (parsed.length > 0) return parsed;
    console.warn(
      `[scene-choices] attempt ${attempt}/2 produced no usable choices for ${input.characterName} @ ${input.nodeName}. ` +
      `raw=${JSON.stringify((raw ?? "").slice(0, 300))}`
    );
  }
  return [];
}
