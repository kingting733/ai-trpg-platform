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

/** Short usage steps shown next to the prompt on the creator page. */
export const PROMPT_STEPS: string[] = [
  "複製下面整段 Prompt。",
  "貼到任何 AI（ChatGPT / Claude / Gemini / DeepSeek 都可以），並在最後附上你的故事原文。",
  "AI 會先跟你確認拆解方式並提問 —— 回答它，直到你滿意為止。",
  "跟它說「可以了，輸出 JSON」，它會給你一段以 { 開頭的 JSON。",
  "把整段 JSON 複製回來，貼進「貼上 JSON」框，按匯入。",
  "檢查匯入報告（會列出實際保留了多少地點／NPC／結局，以及任何被忽略的內容），確認後儲存。",
];
