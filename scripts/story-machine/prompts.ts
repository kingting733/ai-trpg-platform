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

export function funRubricText(): string {
  return fs.readFileSync(path.join(__dirname, "fun-rubric.md"), "utf-8");
}

/**
 * The writer never copies the story. It used to: rule 6 asked for full_story
 * verbatim, so a 68k-character story meant a 68k-character echo in the
 * output — which is where the model's output limit cut a 24-minute opus run
 * off mid-sentence. Now the writer emits this placeholder and the machine
 * substitutes the text itself after extraction. Output size no longer
 * depends on input size.
 */
export const STORY_PLACEHOLDER = "__FULL_STORY__";

/**
 * The audit trail (conversion decisions, per-round fix summaries) is for the
 * reviewer and the critic, not the GM: the platform injects gm_notes into
 * the GM's system prompt on every turn. Writers put it in `conversion_notes`;
 * older outputs buried it in gm_notes under 【轉換決定】/【本輪修正】 headings.
 * finalizeScenario() pulls both out and returns them, leaving gm_notes with
 * only what belongs at the table.
 */
export const DECISIONS_KEY = "conversion_notes";
const AUDIT_HEADINGS = /^【(轉換決定|本輪修正[^】]*)】/;

export function finalizeScenario(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const o = parsed as Record<string, unknown>;
  const chunks: string[] = [];
  if (typeof o[DECISIONS_KEY] === "string" && (o[DECISIONS_KEY] as string).trim()) chunks.push((o[DECISIONS_KEY] as string).trim());
  delete o[DECISIONS_KEY];
  if (typeof o.gm_notes === "string") {
    // Split on 【…】 headings; keep GM-facing sections, lift audit sections.
    const parts = o.gm_notes.split(/(?=^【[^】]+】)/m);
    const keep: string[] = [];
    for (const p of parts) {
      if (AUDIT_HEADINGS.test(p.trim())) chunks.push(p.trim());
      else if (p.trim()) keep.push(p.trim());
    }
    o.gm_notes = keep.join("\n\n") || null;
  }
  return chunks.join("\n\n");
}

/** Put the placeholder back in a scenario JSON string, for prompts that
 *  already carry the story separately (critic, fixer). Saves the model from
 *  reading the same text twice. */
export function stripStory(scenarioJson: string): string {
  try {
    const o = JSON.parse(scenarioJson);
    if (o && typeof o === "object" && !Array.isArray(o) && "full_story" in o) o.full_story = STORY_PLACEHOLDER;
    return JSON.stringify(o, null, 2);
  } catch {
    return scenarioJson;
  }
}

export function injectStory(parsed: unknown, story: string): void {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    (parsed as Record<string, unknown>).full_story = story;
  }
}

/**
 * Condense an over-long story before the writer sees it. Structure survives
 * (every place, person, secret, item and ending); what goes is repetition,
 * atmosphere and dialogue. Plain prose out, same language as in.
 */
export function condensePrompt(story: string, targetChars: number): string {
  // Models overshoot "about N characters" by 1.5–2.5× (an opus run asked for
  // 12k returned 31k). A hard ceiling plus a per-entry budget lands closer.
  const perEntry = Math.max(60, Math.round(targetChars / 60));
  return `你是一位 TRPG 劇本編輯。下面這篇故事太長，無法直接轉成一場遊戲。請把它濃縮，給接下來負責結構化的 AI 讀。

【長度是硬性上限：${targetChars.toLocaleString()} 字，含標點】
- 超過會被截斷，後面的結局和人物就會消失，所以寧可再刪也不要超過。
- 用預算控制：背景與真相合計不超過 ${Math.round(targetChars * 0.3).toLocaleString()} 字；每一個地點、每一個人物各不超過 ${perEntry} 字（兩三句話）；每一種結局不超過 ${perEntry} 字。
- 寫完後回頭數一次；若明顯超過，先砍描述再砍支線，不要砍地點、人物、祕密、結局。

【必須保留——一個都不能少】
- 每一個地點（房間、建築、區域），以及它們之間怎麼相通。
- 每一個有名字的人物：他是誰、想要什麼、在什麼條件下會幫忙或翻臉、知道哪些事。
- 每一個祕密、真相、轉折，以及玩家要「在哪裡做什麼」才能得到它。
- 每一件關鍵物品、證物、線索：在哪裡、怎麼拿。
- 每一種結局，以及達成它的條件。
- 故事的因果鏈：為什麼事情會發生。

【可以刪掉】
- 重複的描述、氣氛鋪陳、環境細節。
- 對話原文——改成一句話說明「誰告訴誰什麼」。
- 規則數據、骰子檢定、表格。
- 跟主線無關的支線；刪了的話，在最後用一行列出「已省略的支線」。

【格式】
- 用故事原本的語言寫，散文體。可以用小標題分段：背景／真相／地點／人物／結局。
- 不要加入原文沒有的情節。
- 只輸出濃縮後的故事本身，不要前言、不要說明你做了什麼。

────────────────────────
以下是原文：

${story}
`;
}


/** What the WRITER must know that the interactive creator prompt leaves to a
 *  conversation: it cannot ask, so it must decide and disclose; and the
 *  objective/NPC rules the per-turn engine actually depends on. */
const WRITER_PREAMBLE = `你是一位 TRPG 劇本結構化助手，正在把一篇完整的故事轉換成一個「AI 主持的克蘇魯風跑團平台」看得懂的 JSON。
這是一個**非互動**的自動流程：你不能問我問題。故事沒寫清楚的地方，自行做最合理的決定，並把每一個決定用一行寫進**頂層欄位 conversion_notes**（字串），格式：
【轉換決定】
- 決定 1：…
- 決定 2：…

conversion_notes 是給審稿人看的，遊戲裡不會出現。gm_notes 則是主持人**每一回合都會讀**的桌邊規則，只放跑團時要用的東西：回合與時間的對應、哪些事件由 GM 在第幾回合結算、NPC 抉擇的判定方式、節奏提醒、該藏到什麼時候的伏筆。不要把結構選擇（travel_mode、id 命名、合併了哪些 NPC、數值怎麼設）或修改歷程寫進 gm_notes。

【這個引擎怎麼判定目標——寫目標前必讀】
遊戲中有一個裁判 AI，每回合只讀「玩家這回合的行動」和「GM 這回合寫的敘事」，然後判斷目標有沒有達成。所以：
1. 每條目標必須是「一件 GM 會在敘事裡明寫出來的事件」。
   ✗「與達米恩談成合作」「決定保留酒廠」「理解真相」——這些是抽象結果或心理狀態，裁判看不到。
   ✓「達米恩親口答應把下一批威士忌交給隊伍運送」「工頭接到命令後重新啟動蒸餾器」——這些會被寫出來。
2. 一條目標只放一件事。有先後順序的拆成兩條；有「或」的改成一件事並把分支放進括號：「取得農場控制權（合作或武力）」。
3. 多步驟目標（「四個角落各放一撮米」）可以，裁判會記進度，但每一步都要是具體事件。能拆就拆。
4. 每個會「答應」「幫忙」「透露」的 NPC，goal 裡必須寫清楚「在什麼條件下才會」。沒有條件，GM 就會在骰子一次成功後直接給。
5. 每個結局都要有 description：給 AI 寫結局畫面的指示（30 字以上），寫「之後發生了什麼、每個角色的下場」。
6. full_story 這個欄位**只寫佔位字串 "__FULL_STORY__"**。系統會在你輸出之後自動把故事原文填進去。不要自己抄原文——那會讓輸出過長而被截斷。（格式規則裡「full_story 必填、完整貼上」在這個自動流程中由系統代勞。）
7. **起點只有一個。** nodes 陣列的第一個地點就是開場地點（opening_scene 發生的地方），initial 用 unlocked。其他地點**不要**一開始就 unlocked——自由移動模式下那等於多個起點，引擎會讓玩家直接跳過去。其他地點用 discovered 加 unlock 條件（例如 visit:起點id、item:某證物），或 hidden 加 discovers 由某個地點帶到；若用 edges 模式，鄰接地點可以 unlocked，但必須用 edges 從起點連過去。（格式規則裡「大部分地點用 unlocked」在這裡不適用。）
8. **證物與地點的文字只寫玩家看到的，不寫它代表什麼。** reveal_text 是玩家拿到證物那一刻的所見：外觀、狀態、上面寫的字、氣味、聲音。不下結論、不解釋真相、不寫 NPC 看到它會怎麼反應。✗「胎痕顯示是麵包車，駕駛技術不錯」✗「郭玄機對它一無所知，若讓他看清會改口」✓「胎紋寬厚，邊緣有側滑痕，通往南邊那扇柵欄門」。真相放 gm_notes，NPC 的反應放他的 goal 或 knowledge。地點的 desc（瀏覽描述）同理，只寫外觀。
9. **可以補載體，不能補事實。** 原文寫明的真相如果沒說玩家在哪裡怎麼拿到，你可以補一個證物、文件或 NPC 情報來承載它——但載體裡的每一句話都必須是原文已有的事實，不要加人名、金額、日期、機構、對話、物證細節。補了什麼、承載原文哪一段，在【轉換決定】裡列出。
10. **NPC 觸發事件要有合理的地點與時機。** npc_encounters 在 when 成立的那一回合就觸發，預設無論隊伍在哪都出現。所以每一條反應「拿到某物／完成某事」的事件，都要加 at（那個 NPC 平常在的地點或區域 id），必要時加 delay（回合數）。只有電話、託夢、鬼魂、追殺者這類原文說明「能隨時找上門」的情況才可以不加 at。✗ 在岩洞拿到日誌，鎮長下一回合出現在岩洞。✓ at 設鎮公所，玩家回去時她已在等。

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
${stripStory(scenarioJson)}
`;
}

export function fixPrompt(story: string, scenarioJson: string, report: MachineReport, criticJson: string): string {
  return (
    WRITER_PREAMBLE +
    `你之前已經把故事轉換成下面這份 JSON。程式驗證器和另一位評審找出了問題。請修正後**輸出完整的新 JSON**（不是差異、不是片段），規則：
- 只輸出一個 JSON 物件，不要說明文字，不要用 \`\`\` 包起來。
- 所有既有的 id（地點、證物、目標、結局、區域、NPC）保持不變；只有新增的項目才用新 id。
- 不要因為修一個問題而刪掉其他內容。
- 不要加入原文沒有的新事實（人名、金額、日期、機構、對話、物證細節）。為了讓原文真相可取得而補的證物或情報可以，但內容只能是原文已有的事實，並在【轉換決定】列出。
- 只改被點名的地方，其他欄位一個字不要動——每一次多餘的改寫都會製造下一輪的新問題。
- 驗證器的【阻斷】全部必須修掉；評審的 blocking 全部必須處理；suggestions 盡量採納。
- full_story 一律寫佔位字串 "__FULL_STORY__"，系統會自動填回原文。
- 在 conversion_notes 末尾補上【本輪修正】摘要（每項一行）；gm_notes 不記修改歷程。

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
${stripStory(scenarioJson)}

────────────────────────
【故事原文（供對照，不要改寫）】
${story}
`
  );
}

/**
 * The playtest pass. Deliberately runs AFTER the hard gate and never blocks:
 * the validator and the critic answer "does this run"; this one answers "is
 * this worth two hours", which is taste, and taste does not belong in a gate.
 * It reads the scenario the way a player meets it — no full_story, no
 * gm_notes — because that is the only view that reveals a dead end.
 */
export function funPrompt(story: string, scenarioJson: string): string {
  return `你是一位資深的 TRPG 主持人，看過很多劇本，也被很多劇本悶到過。
下面是一份已經通過格式檢查的劇本 JSON，以及它的故事原文。請照評分表在腦中試玩一遍，然後誠實回答它好不好玩。

不要再挑格式或引用問題——那些已經有別人檢查過了。你唯一的工作是「玩起來如何」。

${funRubricText()}

────────────────────────
【劇本 JSON】
${stripStory(scenarioJson)}

────────────────────────
【故事原文（供你判斷改編有沒有把好東西丟掉）】
${story}
`;
}
