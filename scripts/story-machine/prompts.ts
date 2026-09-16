// Prompt builders for the three LLM roles in the loop. The JSON contract is
// NOT restated here: it comes from buildScenarioJsonPrompt(), the same
// generator that serves /scenarios/prompt, so the machine can never drift
// from what the importer accepts.

import fs from "node:fs";
import path from "node:path";
import { buildScenarioJsonPrompt, PROMPT_VERSION } from "@/lib/ai/scenario-json-prompt";
import { renderReport, type MachineReport } from "./validate";

export function rubricText(): string {
  return fs.readFileSync(path.join(__dirname, "rubric.md"), "utf-8");
}

/** What the WRITER must know that the interactive creator prompt leaves to a
 *  conversation: it cannot ask, so it must decide and disclose; and the
 *  objective/NPC rules the per-turn engine actually depends on. */
const WRITER_PREAMBLE = `你是一位 TRPG 劇本結構化助手，正在把一篇完整的故事轉換成一個「AI 主持的克蘇魯風跑團平台」看得懂的 JSON。
這是一個**非互動**的自動流程：你不能問我問題。故事沒寫清楚的地方，自行做最合理的決定，並把每一個決定用一行寫進 gm_notes 的開頭，格式：
【轉換決定】
- 決定 1：…
- 決定 2：…

【這個引擎怎麼判定目標——寫目標前必讀】
遊戲中有一個裁判 AI，每回合只讀「玩家這回合的行動」和「GM 這回合寫的敘事」，然後判斷目標有沒有達成。所以：
1. 每條目標必須是「一件 GM 會在敘事裡明寫出來的事件」。
   ✗「與達米恩談成合作」「決定保留酒廠」「理解真相」——這些是抽象結果或心理狀態，裁判看不到。
   ✓「達米恩親口答應把下一批威士忌交給隊伍運送」「工頭接到命令後重新啟動蒸餾器」——這些會被寫出來。
2. 一條目標只放一件事。有先後順序的拆成兩條；有「或」的改成一件事並把分支放進括號：「取得農場控制權（合作或武力）」。
3. 多步驟目標（「四個角落各放一撮米」）可以，裁判會記進度，但每一步都要是具體事件。能拆就拆。
4. 每個會「答應」「幫忙」「透露」的 NPC，goal 裡必須寫清楚「在什麼條件下才會」。沒有條件，GM 就會在骰子一次成功後直接給。
5. 每個結局都要有 description：給 AI 寫結局畫面的指示（30 字以上），寫「之後發生了什麼、每個角色的下場」。
6. full_story 必須是我的故事原文，完整、逐字，不要改寫、不要縮短。

`;

export function writerPrompt(story: string): string {
  return (
    WRITER_PREAMBLE +
    `（格式版本 ${PROMPT_VERSION}）\n\n` +
    buildScenarioJsonPrompt("json") +
    `\n\n────────────────────────\n以下是我的故事：\n\n${story}\n`
  );
}

export function criticPrompt(story: string, scenarioJson: string, report: MachineReport): string {
  return `你是一位嚴格的 TRPG 劇本評審。下面有三樣東西：作者的故事原文、由另一個 AI 轉換出來的劇本 JSON、以及程式驗證器的報告。
請依照評分表審查 JSON，只輸出評分表規定的 JSON 格式。

${rubricText()}

────────────────────────
【程式驗證器的報告（這些已經被記錄，不要重複報告）】
${renderReport(report)}

────────────────────────
【故事原文】
${story}

────────────────────────
【劇本 JSON】
${scenarioJson}
`;
}

export function fixPrompt(story: string, scenarioJson: string, report: MachineReport, criticJson: string): string {
  return (
    WRITER_PREAMBLE +
    `你之前已經把故事轉換成下面這份 JSON。程式驗證器和另一位評審找出了問題。請修正後**輸出完整的新 JSON**（不是差異、不是片段），規則：
- 只輸出一個 JSON 物件，不要說明文字，不要用 \`\`\` 包起來。
- 所有既有的 id（地點、證物、目標、結局、區域、NPC）保持不變；只有新增的項目才用新 id。
- 不要因為修一個問題而刪掉其他內容；不要加入故事裡沒有的情節。
- 驗證器的【阻斷】全部必須修掉；評審的 blocking 全部必須處理；suggestions 盡量採納。
- full_story 原封不動保留。
- 在 gm_notes 的【轉換決定】底下補上這一輪的修改摘要（每項一行）。

────────────────────────
【格式規則（不變）】
${buildScenarioJsonPrompt("json")}

────────────────────────
【驗證器報告】
${renderReport(report)}

────────────────────────
【評審意見】
${criticJson}

────────────────────────
【目前的 JSON】
${scenarioJson}

────────────────────────
【故事原文（供對照，不要改寫）】
${story}
`
  );
}
