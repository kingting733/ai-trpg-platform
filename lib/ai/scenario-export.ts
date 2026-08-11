// 劇本匯出 — turn a stored scenario back into the SAME JSON shape the importer
// accepts, wrapped in an instruction header for an external LLM.
//
// WHY THIS EXISTS: /scenarios/prompt already hands out a prompt that turns a
// story into importable scenario JSON, and analyzeScenarioDocument() has a
// fast path that ingests that JSON with no AI call at all. So the platform had
// IMPORT but no EXPORT — a creator who wanted another model's opinion on their
// scenario had to retype it, and any advice they got had to be applied by hand
// in the editor. This closes the loop:
//
//   scenario → export → any LLM ("add more detail to the 閣樓 scene")
//            → improved JSON → paste into 匯入 → same scenario, improved
//
// THE ROUND TRIP IS THE POINT, and it constrains the format absolutely: the
// emitted object must be exactly what looksLikeScenarioJSON() recognises and
// normalizeImported() reads. Both are generated from code here (never
// hand-written text) so the export cannot drift away from the importer.

/** Bumped when the emitted shape changes. Stamped into the header so a creator
 *  pasting an old export into a newer importer gets a legible mismatch rather
 *  than a silent partial import. */
export const EXPORT_VERSION = "1.0";

/** Marks where the instruction prose ends and the payload begins. The header
 *  deliberately avoids literal braces so this is the ONLY unambiguous start of
 *  JSON in the document — otherwise "output from { to }" style wording makes
 *  naive brace-scanning grab a fragment of the instructions instead. */
export const JSON_MARKER = "===== SCENARIO JSON =====";

/** The scenario columns this module reads. A loose shape on purpose: the row
 *  comes straight from Supabase and callers should not have to restate it. */
export interface ScenarioRowLike {
  title?: string | null;
  genre?: string | null;
  difficulty?: string | null;
  description?: string | null;
  objective?: string | null;
  max_players?: number | null;
  estimated_play_time?: number | null;
  tags?: string[] | null;
  opening_scene?: string | null;
  source_document?: string | null;
  npcs?: unknown;
  objectives?: unknown;
  endings?: unknown;
  location_graph?: unknown;
  winning_targets?: string | null;
  each_player_targets?: string | null;
  failure_conditions?: string | null;
  failure_turn_limit?: number | null;
  ending_conditions?: string | null;
  gm_notes?: string | null;
  language?: string | null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * The scenario as importable JSON.
 *
 * Key names mirror lib/ai/scenario-json-prompt.ts and are read by
 * normalizeImported(). Two deliberate choices:
 *  - `source_document` is emitted as `full_story`, the name the import fast
 *    path looks for; emitting it under its column name would silently drop the
 *    entire original story on re-import.
 *  - Empty/null fields are KEPT rather than omitted, so the LLM can see which
 *    parts of the scenario are unfinished — that is exactly what a creator is
 *    asking it to help fill in.
 */
export function buildScenarioJson(row: ScenarioRowLike): Record<string, unknown> {
  return {
    export_version: EXPORT_VERSION,
    language: str(row.language) || "zh-TW",
    title: str(row.title),
    genre: str(row.genre),
    difficulty: str(row.difficulty),
    description: str(row.description),
    objective: str(row.objective),
    max_players: typeof row.max_players === "number" ? row.max_players : 4,
    estimated_play_time: typeof row.estimated_play_time === "number" ? row.estimated_play_time : null,
    tags: arr(row.tags),
    opening_scene: str(row.opening_scene) || null,
    full_story: str(row.source_document) || null,
    npcs: arr(row.npcs),
    objectives: arr(row.objectives),
    endings: arr(row.endings),
    location_graph: row.location_graph ?? null,
    winning_targets: str(row.winning_targets) || null,
    each_player_targets: str(row.each_player_targets) || null,
    failure_conditions: str(row.failure_conditions) || null,
    failure_turn_limit: typeof row.failure_turn_limit === "number" ? row.failure_turn_limit : null,
    ending_conditions: str(row.ending_conditions) || null,
    gm_notes: str(row.gm_notes) || null,
  };
}

/** Short, factual notes on what is thin — appended to the header so the LLM is
 *  pointed at the real gaps instead of rewriting whatever it happens to read
 *  first. Derived from the data, never guessed. */
export function scenarioGaps(row: ScenarioRowLike): string[] {
  const gaps: string[] = [];
  const graph = row.location_graph as { nodes?: unknown[] } | null | undefined;
  const nodes = arr(graph?.nodes);
  const evidenceCount = nodes.reduce<number>(
    (n, node) => n + arr((node as { evidence?: unknown }).evidence).length,
    0
  );

  if (!str(row.source_document)) gaps.push("full_story 是空的——主持人遊玩時讀不到故事原文，敘事品質會明顯下降。");
  if (!str(row.opening_scene)) gaps.push("opening_scene 是空的。");
  if (arr(row.npcs).length === 0) gaps.push("完全沒有 NPC。");
  if (arr(row.objectives).length === 0) gaps.push("沒有任何目標（objectives）。");
  if (arr(row.endings).length === 0) gaps.push("沒有任何結局（endings）——遊戲不會有結束條件。");
  if (nodes.length === 0) gaps.push("沒有地點圖（location_graph）。");
  else if (evidenceCount === 0) gaps.push("地點圖裡沒有任何證物（evidence），玩家沒有東西可以找。");
  for (const node of nodes) {
    const n = node as { name?: string; desc?: string };
    if (!str(n.desc)) { gaps.push(`地點「${str(n.name) || "?"}」沒有 desc 場景描述。`); break; }
  }
  return gaps;
}

/**
 * The full copy-paste payload: instructions, then the JSON.
 *
 * The header does the work that makes the round trip survive contact with a
 * chatbot: it tells the model the JSON is a live format (not a sample to
 * redesign), forbids inventing new condition syntax — the one class of edit
 * that imports "successfully" and then silently does nothing at play time —
 * and demands the reply end with a complete JSON object rather than a diff.
 */
export function buildScenarioExport(row: ScenarioRowLike): string {
  const json = JSON.stringify(buildScenarioJson(row), null, 2);
  const gaps = scenarioGaps(row);
  const title = str(row.title) || "（未命名劇本）";

  return `我有一個跑團劇本，想請你幫我改得更好。下面是它的完整資料（JSON 格式）。

【你的任務】
1. 先讀完整份 JSON，然後用「${str(row.language) || "zh-TW"}」跟我討論：這個劇本哪裡薄弱？哪裡的細節不夠？
   線索夠不夠玩家推理？節奏會不會拖？結局條件合不合理？
2. 等我說「改吧」之後，才輸出改好的完整 JSON。

【硬性規則——違反的話我沒辦法用】
- 這份 JSON 是一個實際運作中的平台格式，不是範例。**欄位名稱一個都不可以改、不可以新增、不可以刪除。**
- 最後輸出時只輸出「一個完整的 JSON 物件」：第一個字元是左大括號，最後一個字元是右大括號，
  中間不要有任何說明文字。（包在程式碼區塊裡也可以，系統會自動取出。）
  不要只給我「改動的部分」或 diff——我需要完整的整份 JSON 才能貼回平台。
- 所有 id（地點、證物、目標、結局、NPC knowledge）維持原本的值。**改 id 會讓所有條件失效。**
- condition / unlock / when 這些欄位的語法**不可以自創**。只能沿用這份 JSON 裡已經出現過的寫法
  （例如 item:xxx、visit:xxx、objective:xxx、round:N）。自創的條件在平台上會被直接忽略——
  匯入時看起來成功，實際遊玩時完全不會觸發。
- 所有文字用劇本原本的語言書寫，不要翻譯。
- **full_story 請保留並可以補寫**：平台的 AI 主持人遊玩時會讀這一段來理解全貌。

【我最想要的改進】
（在這裡寫你自己的要求，例如：把 1404 神位的場景描述寫得更陰森、多加兩條線索、讓王伯的動機更清楚）
${gaps.length ? `\n【這份劇本目前明顯缺少的東西】\n${gaps.map((g) => `- ${g}`).join("\n")}\n` : ""}
【劇本：${title}】——以下是完整資料
${JSON_MARKER}
${json}
`;
}
