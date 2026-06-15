"use client";

import { useState } from "react";
import type { ScenarioEnding, EndingType } from "@/lib/game/endings";
import { coerceEndings } from "@/lib/game/endings";

const baseCls =
  "bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-zinc-500";
const blockCls = `${baseCls} w-full`;

export function emptyEnding(): ScenarioEnding {
  return { id: "", name: "", type: "victory", condition: [], description: "", priority: 0 };
}

function serializeCond(cond: string[][]): string {
  return cond.map((g) => g.join(" & ")).join(" | ");
}

function parseCond(text: string): string[][] {
  return text
    .split("|")
    .map((g) => g.split("&").map((t) => t.trim()).filter(Boolean))
    .filter((g) => g.length > 0);
}

function FieldLabel({ label, tip }: { label: string; tip: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center gap-1 mb-1">
      <span className="text-[11px] text-slate-400">{label}</span>
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="text-slate-600 hover:text-slate-400 text-[10px] leading-none relative"
      >
        ？
        {show && (
          <div className="absolute left-0 top-5 z-50 w-72 bg-slate-800 border border-slate-600 rounded-lg p-2.5 text-[11px] text-slate-300 leading-relaxed shadow-xl text-left font-normal whitespace-pre-line">
            {tip}
          </div>
        )}
      </button>
    </div>
  );
}

const TYPE_LABELS: Record<EndingType, string> = {
  victory: "勝利結局",
  failure: "失敗結局",
  neutral: "中立結局",
};

const CONDITION_TIP = `條件成立時此結局自動觸發。用 & 表示「且」、| 表示「或」。

目標條件（對應「通關條件」欄位各行，「世界與故事」頁籤下方有 ID 提示）：
  objective:obj_1  ── 第 1 行通關條件已完成
  objective:obj_2  ── 第 2 行通關條件已完成
  （每名玩家目標接著排，例如第 3 行起是 obj_3…）

地點系統條件（需已啟用地點圖）：
  visit:地點id    ── 去過該地點
  item:證物id     ── 取得該證物
  count:標籤:數字  ── 累積 N 件有該標籤的證物
  round:數字      ── 到達第 N 回合
  after:地點id:N  ── 進入某地點滿 N 回合後

NPC 條件：
  npc_dead:名稱   ── 該 NPC 已死亡
  npc_alive:名稱  ── 該 NPC 仍然存活

範例：
  objective:obj_1 & npc_alive:阿澤 | round:20`;

const DESCRIPTION_TIP = `AI 在結局觸發時會收到這段文字作為「劇本指示」，並結合玩家的實際行動（劇情日誌）生成個性化的結局描述。

建議寫法：
• 描述這個結局的核心情感與走向（勝利的代價、失敗的遺憾等）
• 點名希望 AI 提到的角色命運或事件後果
• 可以提到玩家的選擇如何影響這個結局

AI 會自動把「玩家實際做了什麼」織入你的描述裡，不需要親自寫出完整故事。`;

const PRIORITY_TIP = `數字越大，優先級越高。當多個結局的條件同時成立時，優先級最高的那個觸發。

建議：
  隱藏真結局：10
  一般勝利：5
  分支結局：3
  失敗結局：1`;

export function EndingsEditor({
  endings,
  onChange,
  npcNames = [],
}: {
  endings: ScenarioEnding[];
  onChange: (endings: ScenarioEnding[]) => void;
  npcNames?: string[];
}) {
  function update(i: number, patch: Partial<ScenarioEnding>) {
    onChange(endings.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  }

  // Live validation: check for condition syntax issues
  const warnings: string[] = [];
  for (const e of endings) {
    if (!e.name.trim()) warnings.push("有結局未填寫名稱。");
    if (e.condition.length === 0) warnings.push(`結局「${e.name || "(未命名)"}」沒有觸發條件，將永遠不會觸發。`);
  }
  // Check for duplicate ids
  const ids = endings.map((e) => e.id).filter(Boolean);
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupIds.length > 0) warnings.push(`結局 ID 重複：${dupIds.join("、")}。請確保每個結局有唯一 ID。`);

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-2 text-xs text-slate-400">
        <p className="text-slate-300 font-medium">🎭 多重結局系統說明</p>
        <p>
          定義多個具名結局，系統每回合自動以純程式邏輯檢查觸發條件，無需 AI 判斷。觸發後，AI 根據實際劇情生成個性化的結局描述。
        </p>
        <p>
          <span className="text-amber-400">啟用後</span>：舊版的「勝利目標」和「失敗條件」欄位會被此系統取代；回合上限失敗仍然有效。
        </p>
        <p>
          <span className="text-emerald-400">留空</span> = 繼續使用舊版「勝利目標 / 失敗條件」模式。
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="bg-amber-950/40 border border-amber-900/50 rounded-lg px-4 py-2.5 text-xs text-amber-300/90 space-y-1">
          {warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
        </div>
      )}

      {endings.map((ending, i) => (
        <div
          key={i}
          className={`bg-slate-800/40 border rounded-xl p-4 space-y-3 ${
            ending.type === "victory"
              ? "border-emerald-800/50"
              : ending.type === "failure"
              ? "border-red-900/50"
              : "border-slate-700"
          }`}
        >
          {/* Row 1: id / name / type / priority / delete */}
          <div className="flex items-end gap-2">
            <div className="shrink-0 w-24">
              <FieldLabel label="結局 ID" tip="唯一代號，可被 objective:<id> 條件引用。英數字。" />
              <input
                className={`${baseCls} w-full font-mono`}
                placeholder="true_end"
                value={ending.id}
                onChange={(e) => update(i, { id: e.target.value.replace(/\s/g, "_") })}
              />
            </div>
            <div className="flex-1 min-w-0">
              <FieldLabel label="結局名稱" tip="顯示給玩家看的結局名稱，例：「真結局 — 阿澤的救贖」。" />
              <input
                className={`${baseCls} w-full`}
                placeholder="真結局 — 阿澤的救贖"
                value={ending.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </div>
            <div className="shrink-0 w-28">
              <FieldLabel label="類型" tip="影響結局畫面的顏色和氛圍。" />
              <select
                className={`${baseCls} w-full`}
                value={ending.type}
                onChange={(e) => update(i, { type: e.target.value as EndingType })}
              >
                {(Object.entries(TYPE_LABELS) as [EndingType, string][]).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="shrink-0 w-16">
              <FieldLabel label="優先級" tip={PRIORITY_TIP} />
              <input
                className={`${baseCls} w-full text-center`}
                type="number"
                min={0}
                max={99}
                value={ending.priority}
                onChange={(e) => update(i, { priority: Number(e.target.value) || 0 })}
              />
            </div>
            <button
              type="button"
              onClick={() => onChange(endings.filter((_, j) => j !== i))}
              className="text-red-400/70 hover:text-red-400 text-xs shrink-0 pb-1.5"
            >
              刪除
            </button>
          </div>

          {/* Row 2: condition */}
          <div>
            <FieldLabel label="觸發條件" tip={CONDITION_TIP} />
            <input
              className={blockCls}
              placeholder="例：item:e3 & npc_alive:阿澤 | round:20"
              value={serializeCond(ending.condition)}
              onChange={(e) => update(i, { condition: parseCond(e.target.value) })}
            />
            {npcNames.length > 0 && (
              <p className="text-[10px] text-slate-600 mt-1">
                可用 NPC：{npcNames.map((n) => `npc_alive:${n} / npc_dead:${n}`).join("、")}
              </p>
            )}
          </div>

          {/* Row 3: description directive */}
          <div>
            <FieldLabel label="結局描述（AI 指示）" tip={DESCRIPTION_TIP} />
            <textarea
              className={`${blockCls} resize-none`}
              rows={3}
              placeholder="描述這個結局的核心情感與走向，AI 會結合玩家的實際行動生成個性化結局……"
              value={ending.description}
              onChange={(e) => update(i, { description: e.target.value })}
            />
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...endings, emptyEnding()])}
        className="w-full border border-dashed border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white rounded-xl py-2.5 text-sm transition-colors"
      >
        + 新增結局
      </button>
    </div>
  );
}
