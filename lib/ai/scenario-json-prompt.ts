// The creator-facing prompt that turns a story into importable scenario JSON.
//
// DRIFT-PROOF BY CONSTRUCTION: every schema fact in this prompt (genres,
// difficulties, size caps, unlock-term grammar, status/type enums) is
// interpolated from the SAME constants the engine uses. When the schema
// changes, this prompt changes with it — a stale copy can't survive, because
// the page serving it always regenerates from code.
//
// Output target: the JSON fast path in lib/ai/import-scenario.ts
// (analyzeScenarioDocument detects leading `{`, parses, and imports with NO
// AI call on our side — the user's own LLM did the expensive work).

import { GRAPH_CAPS } from "@/lib/game/locations";
import { IMPORT_GENRES, IMPORT_DIFFICULTIES } from "@/lib/ai/import-scenario";

/** Bump when the prompt's contract changes materially. Shown to creators so a
 *  stale copy in someone's chat history is identifiable. */
export const PROMPT_VERSION = "1.0";

/** The six unlock terms evalTerm() actually supports (lib/game/locations.ts).
 *  An LLM inventing a seventh is the single most common import failure. */
const UNLOCK_TERMS: Array<[string, string]> = [
  ["item:<證物id>", "已取得該證物"],
  ["visit:<地點id>", "已去過該地點"],
  ["count:<標籤>:<N>", "已累積 N 件帶有該標籤的證物"],
  ["round:<N>", "已到第 N 回合"],
  ["after:<地點id>:<N>", "首次進入該地點後已過 N 回合"],
  ["objective:<目標id>", "該任務目標已完成"],
];

/** A compact, valid example — LLMs follow a worked example far more reliably
 *  than prose. Kept small on purpose so it doesn't dominate the prompt. */
const EXAMPLE = `{
  "language": "zh-TW",
  "title": "1404室的低語",
  "genre": "Horror",
  "difficulty": "Normal",
  "description": "一通半夜打來的電話，把四個陌生人帶到同一道門前。",
  "objective": "查明 1404 室發生過什麼，並在天亮前活著離開。",
  "max_players": 4,
  "estimated_play_time": 90,
  "tags": ["都市傳說", "克蘇魯", "調查"],
  "opening_scene": "電梯在十四樓停下。走廊的燈管閃了兩下，你們聞到一股香灰的味道。",
  "full_story": "（把你的故事原文完整貼在這裡——AI 主持人會讀這一段來理解全貌）",
  "npcs": [
    {
      "name": "王伯", "hp": 10, "mp": 5,
      "str": 45, "con": 50, "siz": 55, "dex": 40, "app": 45,
      "int": 60, "pow": 55, "edu": 65, "luck": 50,
      "personality": "住在對門的老管理員，話少，眼神閃避。",
      "goal": "想阻止任何人進入 1404，因為他知道裡面供的不是祖先。",
      "disposition": "neutral",
      "knowledge": [
        { "id": "k1", "topic": "1404 的前住戶", "info": "前住戶姓陳，三年前某天就沒再出來過。", "when": [] },
        { "id": "k2", "topic": "香灰", "info": "那味道每個月十五都會出現一次。", "when": [["item:e1"]] }
      ]
    }
  ],
  "objectives": [
    { "id": "obj_1", "text": "查出 1404 室前住戶的下落", "scope": "party", "required": true },
    { "id": "obj_2", "text": "找到能證明儀式存在的物證", "scope": "party", "required": true }
  ],
  "endings": [
    {
      "id": "true_end", "name": "真結局 — 把祂送回去", "type": "victory",
      "condition": [["objective:obj_1", "objective:obj_2"]],
      "summary": "你們拼出了完整的真相，並完成了中斷三年的儀式。"
    },
    {
      "id": "bad_end", "name": "失敗 — 第五個名字", "type": "failure",
      "condition": [["round:25"]],
      "summary": "天亮了。門牌上多了一個名字。"
    }
  ],
  "location_graph": {
    "travel_mode": "edges",
    "containers": [
      { "id": "flat1404", "name": "1404室", "entry": "door", "all_children_connected": true, "show_locked_children": true }
    ],
    "nodes": [
      {
        "id": "corridor", "name": "14樓走廊", "initial": "unlocked",
        "desc": "燈管接觸不良，地上有拖行痕跡。",
        "on_enter": "描述閃爍的燈與香灰味。",
        "discovers": ["door"], "unlock": [], "evidence": []
      },
      {
        "id": "door", "name": "1404門口", "initial": "unlocked", "container": "flat1404",
        "desc": "門虛掩著，門縫透出暗紅色的光。",
        "unlock": [], "discovers": [],
        "evidence": [
          { "id": "e1", "name": "發黃剪報", "how": "搜查門邊的鞋櫃", "tags": ["chen_identity"],
            "reveal_text": "剪報日期是 1985 年 7 月，標題寫著「祥安樓倫常慘案」。" }
        ]
      },
      {
        "id": "shrine", "name": "1404神位", "initial": "unlocked", "container": "flat1404",
        "desc": "供桌上香灰堆得極厚，牌位只刻了一個「陳」字。",
        "unlock": [], "discovers": [], "evidence": []
      },
      {
        "id": "attic", "name": "閣樓", "initial": "hidden", "container": "flat1404",
        "desc": "天花板暗門後的夾層，儀式的真正現場。",
        "locked_narration": "天花板看起來只是普通的石膏板。",
        "unlock": [["item:e1", "visit:shrine"]], "discovers": [], "evidence": []
      }
    ],
    "edges": [
      { "from": "corridor", "to": "door", "two_way": true }
    ],
    "npc_placements": [
      { "npc": "王伯", "at": "corridor", "when": [] }
    ],
    "npc_encounters": [
      { "npc": "王伯", "when": [["item:e1"]], "beat": "王伯堵在走廊盡頭，要求你們把剪報交出來。" }
    ]
  }
}`;

/**
 * Gate for the phase-0 interview prompt (「我只有一個點子」).
 *
 * OFF deliberately. It lowers the barrier from "write a whole scenario" to
 * "have an idea", and any creator can self-publish (app/scenarios/new sets
 * status directly, /scenarios lists every published row) — so shipping it
 * before a quality gate exists would fill the public list with thin scenarios
 * faster than anyone could curate them.
 *
 * Flip to true once publishing is gated (review queue, or a bar on
 * locations/evidence/endings before 發佈 is allowed). The prompt itself, its
 * steps and its tests are all kept live so re-enabling is this one line.
 */
export const STORY_BRIEF_ENABLED = false;

/**
 * PHASE 0 — the story-DESIGN prompt, for a creator who has an idea rather than
 * a finished story.
 *
 * WHY THIS IS SEPARATE: buildScenarioJsonPrompt starts with 「我有一個完整的故
 * 事」. A story written without knowing this engine's shape converts badly no
 * matter how good it is — the converter has to invent locations, or interrogate
 * the author for twenty answers. The failure is never bad prose; it is a story
 * whose secrets are not attached to PLACES and ACTIONS.
 *
 * So this prompt does not teach the schema. It INTERVIEWS the author, asking
 * exactly the questions whose answers make a convertible story, and emits prose
 * plus a structured appendix. Prose (not JSON) on purpose: the appendix feeds
 * the converter, while the prose becomes full_story, which the in-game GM reads
 * every turn to understand the whole picture.
 *
 * Condition vocabulary is described in PLAIN LANGUAGE here — a fiction writer
 * should never be handed `[["item:e1","visit:attic"]]` — but it is derived from
 * the same UNLOCK_TERMS the engine evaluates, so the two cannot drift apart.
 */
export function buildStoryBriefPrompt(): string {
  const plainTerms = UNLOCK_TERMS
    .map(([term, desc]) => `  ・${desc}（對應 ${term}）`)
    .join("\n");

  return `你是一位 TRPG 劇本設計師，正在協助我為一個「AI 主持的克蘇魯風跑團平台」寫一個劇本。
我現在只有一個模糊的點子，還沒有完整故事。請你用訪談的方式，一步一步幫我把它變成一個完整、
而且「這個平台跑得動」的故事。

────────────────────────
【這個平台的故事長什麼樣子（你必須遵守的設計規則）】
1. 故事是一張「地圖」，不是一條「時間線」。玩家一次只站在一個地點，只能在該地點行動，
   想去別的地方要先移動。所以請把故事拆成 5–12 個可以走進去的實體地點。
2. 每一個祕密都必須「藏在某個地點的某個東西裡，而且要有一個具體動作才拿得到」。
   ✗ 不行：「調查員發現死者其實是被滅口的。」（沒有地點、沒有東西、沒有動作）
   ✓ 可以：「死亡證明的副本壓在 1404 鞋櫃最底層，要把鞋子全搬開才看得到。」
   沒有地點、沒有實體、沒有動作的線索，在這個平台上等於不存在。
3. NPC 是「有鎖的情報庫」，不是自由發揮的角色。每個 NPC 請列出他知道的每一條情報，
   以及每一條的解鎖條件（可以是「一問就答」）。主持人只會講你列出來的東西，不會自己編。
4. 結局必須是「程式判斷得出來的條件」，不能是「玩家理解了真相」。
   可用的條件只有這幾種，請用它們來描述每個結局的觸發方式：
${plainTerms}
   （條件可以「而且」也可以「或者」，例如「拿到剪報 而且 去過閣樓」。）
5. 目標請寫成「一件做得完、判斷得出來的事」，避免「重複做 N 次」這種。

【規模建議】
地點 5–12、NPC 2–6、證物 4–10、目標 2–5、結局 2–4（至少一個好結局、一個壞結局）。
上限：地點 ${GRAPH_CAPS.nodes}、證物每個地點 ${GRAPH_CAPS.evidence_per_node} 件。故事太大就砍成主線。

────────────────────────
【訪談流程：一次只問一組，等我回答再問下一組】
請「一組一組」問，不要一次丟 20 個問題給我。每一組都先給我 2–3 個你的建議選項，
讓我可以直接說「用第二個」或「都好，你決定」。順序如下：

第 1 組 — 核心：這個故事的真相是什麼？誰做了什麼、為什麼？（一段話就好）
第 2 組 — 舞台：故事發生在哪裡？請提出 5–12 個具體地點，並說明哪些一開始就能進去、
         哪些要有條件才進得去、哪些是玩家一開始根本不知道存在的祕密地點。
第 3 組 — 線索：真相要拆成哪幾件「找得到的東西」？每一件請寫：在哪個地點、是什麼東西、
         玩家要做什麼動作才拿得到（請用玩家會打出來的動詞，例如「翻找鞋櫃」「掀開供桌的紅布」）。
第 4 組 — 人：有哪些 NPC？各自知道什麼、隱瞞什麼、想要什麼？每條情報的解鎖條件是什麼？
第 5 組 — 目標與結局：玩家要達成什麼？有哪幾種結局？每個結局的觸發條件是什麼
         （用上面那幾種條件寫）？
第 6 組 — 氣氛：開場的第一個畫面是什麼？（玩家看到的第一段文字）

每一組結束時，簡短覆述我的決定，然後進到下一組。如果我的回答會讓某條規則跑不動
（例如線索沒有地點、結局沒有可判斷的條件），請當場指出來並提出修法。

────────────────────────
【最後輸出：一份完整故事 + 一份結構附錄】
六組都問完後，輸出下面兩段（用我的語言書寫，不要翻譯）：

〈第一部分：故事原文〉
把整個故事寫成一篇完整、好看的散文（1000–2500 字）。這一段之後會被主持人在遊玩時反覆閱讀，
所以真相、動機、每個地點的樣子、每個 NPC 的底細都要寫清楚——這裡不需要對玩家保密。

〈第二部分：結構附錄〉
用條列寫出下面五塊，供下一步轉成平台格式時使用：
- 地點：名稱｜一開始能不能進去｜場景描述｜從這裡可以走到哪裡
- 證物：名稱｜在哪個地點｜玩家要做什麼才拿得到｜拿到時看到什麼
- NPC：名字｜性格與目的｜他知道的每一條情報＋各自的解鎖條件
- 目標：一句話一個，要判斷得出來
- 結局：名稱｜好結局/壞結局/中性｜觸發條件（用上面那幾種）｜結局描述

輸出完之後提醒我：把這兩部分一起貼進平台的「產生 JSON」Prompt，就能轉成可以匯入的格式。

────────────────────────
我的點子是：
【把你的點子寫在這裡，一句話也可以】`;
}

/**
 * Build the full creator prompt. `phase` controls which half is emitted:
 * - "full" (default): the complete two-phase prompt.
 * - "json": only the strict JSON-output instruction, for someone who already
 *   discussed their story with the LLM and just wants the final emit step.
 */
export function buildScenarioJsonPrompt(phase: "full" | "json" = "full"): string {
  const terms = UNLOCK_TERMS.map(([t, d]) => `  ${t}  —— ${d}`).join("\n");

  const jsonSpec = `【輸出格式：只輸出 JSON】
最後一則訊息只包含一個 JSON 物件，不要有任何說明文字、不要用 \`\`\` 包起來。以 { 開始，以 } 結束。

【硬性規則】
1. 只使用我故事裡真正有的內容。缺的地方在第一階段問我，不要自己編。
2. 所有文字用故事本身的語言書寫（繁體中文故事就寫繁體中文，不要翻譯）。
3. **full_story 必填**：把我的故事原文完整放進去。AI 主持人在遊玩時會讀這一段來理解全貌；
   少了它，主持人只能讀到這份 JSON，敘事品質會明顯下降。
4. 所有 id（地點、證物、目標、結局、區域）只能用英數字與底線，並且在整份 JSON 內唯一。
5. 條件語法只能用下面六種，**不可以自創**（自創的條件會被系統直接忽略）：
${terms}
   寫法：condition / unlock / when 都是「二維陣列」= 任一組成立即可，組內全部成立才算該組成立。
   例：[["item:e1","visit:shrine"]] = 同時拿到 e1 且去過 shrine。
       [["item:e1"],["round:10"]] = 拿到 e1 或 到第 10 回合，任一即可。
   結局的 condition 另外可用 npc_dead:<NPC名> 與 npc_alive:<NPC名>。

【列舉值（只能用這些）】
- genre: ${IMPORT_GENRES.join(" / ")}
- difficulty: ${IMPORT_DIFFICULTIES.join(" / ")}
- 地點 initial: unlocked（開放）/ discovered（已知但進不去）/ hidden（玩家還不知道它存在）
- 目標 scope: party（任一人完成即可）/ each_player（每個人都要各自完成）
- 結局 type: victory / failure / neutral
- NPC disposition: friendly / neutral / hostile
- travel_mode: free（任何已解鎖地點都能直接去）/ edges（只能沿著 edges 走，較有地圖感）

【數量上限（超過的部分會被系統丟棄）】
- 地點 ${GRAPH_CAPS.nodes} 個、區域 ${GRAPH_CAPS.containers} 個、路徑 ${GRAPH_CAPS.edges} 條
- NPC 位置設定 ${GRAPH_CAPS.npc_placements} 筆、NPC 觸發事件 ${GRAPH_CAPS.npc_encounters} 筆
- 每個地點的證物 ${GRAPH_CAPS.evidence_per_node} 件
建議規模：地點 5–12、NPC 2–6、證物 4–10、目標 2–5、結局 2–4。故事太長就挑主線。

【設計要點】
- 大部分地點用 unlocked。需要條件才能進的用 discovered（並寫 locked_narration 解釋為什麼進不去）；
  真正的祕密處用 hidden，並讓某個地點的 discovers 陣列指向它，或給它 unlock 條件。
- 證物的 how 是「玩家要做什麼才拿得到」。寫「搜查…」「翻查…」類的，玩家搜索成功就能拿到；
  寫特定動作（例如「撬開保險箱」）就必須做那個動作。這句話會被系統拿來比對玩家的行動文字。
- NPC 的 knowledge 是情報庫：topic 是玩家問到什麼會觸發，content 是他會說的內容，
  when 是解鎖條件（留空 = 一問就答）。主持人只能講出這裡列的東西，不會自己編。
- 每個目標必須是「一件可判定的事」。避免「重複做 N 次」型目標（系統目前判定不佳），改寫成一次性動作。
- travel_mode 用 edges 時，記得用 edges 把地點連起來，否則玩家走不到。
  同一個 container 內且 all_children_connected 為 true 的地點會自動互通，不用再拉線。

【完整範例（照這個結構輸出）】
${EXAMPLE}`;

  if (phase === "json") return jsonSpec;

  return `你是一位 TRPG 劇本結構化助手。我有一個完整的故事，想把它匯入一個「AI 主持的克蘇魯風跑團平台」。
這個平台的伺服器會自動管理地點、證物、NPC 情報、任務目標與結局，所以我需要你把我的故事轉換成平台看得懂的 JSON。

請分兩個階段進行。

────────────────────────
【第一階段：先讀故事，然後問我】
先讀完我的故事，然後用條列方式輸出：
1. 你打算怎麼拆解（地點清單、NPC 清單、主要證物、目標、結局各幾個），一行一個，讓我快速確認。
2. 「❓需要我決定的事項」：所有你拿不準、故事沒寫清楚、或有多種合理拆法的地方，一次問完。

這個階段**不要輸出 JSON**。等我回答完你的問題、或我直接說「可以了」之後，再進入第二階段。

────────────────────────
【第二階段：輸出 JSON】
${jsonSpec}

────────────────────────
以下是我的故事：
【把你的故事貼在這裡】`;
}

/** Usage steps for the phase-0 story-design prompt. */
export const BRIEF_STEPS: string[] = [
  "複製下面整段 Prompt。",
  "貼到任何 AI，並在最後寫上你的點子 —— 一句話也可以。",
  "AI 會一組一組問你（真相 → 地點 → 線索 → NPC → 結局 → 開場），照著回答就好；不確定的就說「你決定」。",
  "問完後它會輸出「故事原文 + 結構附錄」。",
  "把那兩段一起貼進「產生 JSON 的 Prompt」，轉成可匯入的 JSON。",
];

/** Short usage steps shown next to the prompt on the creator page. */
export const PROMPT_STEPS: string[] = [
  "複製下面整段 Prompt。",
  "貼到任何 AI（ChatGPT / Claude / Gemini / DeepSeek 都可以），並在最後附上你的故事原文。",
  "AI 會先跟你確認拆解方式並提問 —— 回答它，直到你滿意為止。",
  "跟它說「可以了，輸出 JSON」，它會給你一段以 { 開頭的 JSON。",
  "把整段 JSON 複製回來，貼進「貼上 JSON」框，按匯入。",
  "檢查匯入報告（會列出實際保留了多少地點／NPC／結局，以及任何被忽略的內容），確認後儲存。",
];
