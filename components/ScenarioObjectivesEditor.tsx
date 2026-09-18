"use client";
import { type ScenarioObjective, emptyObjective } from "@/lib/game/objectives-def";

// Structured editor for a scenario's objectives (the old 通關條件 free-text
// boxes). Each objective is a discrete, checkable goal with a STABLE id — the
// id never shows to the creator (friendly text is the label everywhere), and it
// never shifts when goals are reordered, so multi-ending / location-unlock
// references that point at "objective:<id>" stay valid. Every objective is
// team-wide: any one player completing it counts for the whole party.

const inputCls =
  "w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500";

/**
 * The writing rules, right where objectives get written. Mirrors
 * docs/creator-guide/objectives.md; the long form explains WHY (how the
 * per-turn judge reads narration), this is the checklist.
 */
function ObjectiveWritingTips() {
  return (
    <details className="group border border-slate-700 rounded-lg bg-slate-900/40 text-xs text-slate-400">
      <summary className="cursor-pointer select-none px-3 py-2 text-slate-300 hover:text-white">
        怎麼寫目標才會被正確判定？（點開看 5 條規則）
      </summary>
      <div className="px-3 pb-3 flex flex-col gap-2">
        <p>
          每回合有一個裁判 AI 只讀「玩家的行動」和「主持人寫的敘事」，判斷目標有沒有<strong className="text-slate-200">在這回合真的發生</strong>。
          所以：<strong className="text-slate-200">一條目標 = 一件主持人會明寫出來的事。</strong>寫完問自己：「完成那回合，GM 會寫出哪一句話？」
        </p>
        <ol className="list-decimal pl-5 flex flex-col gap-1">
          <li><strong className="text-slate-200">寫事件，不寫決定或狀態。</strong>✗ 與達米恩談成合作 → ✓ 達米恩親口答應把下一批威士忌交給隊伍運送</li>
          <li><strong className="text-slate-200">一條只放一件事。</strong>有先後就拆開；有「或」就放進括號：「取得農場控制權（合作或武力）」</li>
          <li><strong className="text-slate-200">用劇本裡的正式名字。</strong>NPC、證物、地點的寫法要和其他欄位一字不差</li>
          <li><strong className="text-slate-200">多步驟可以，但每步都要具體。</strong>「四個角落各放一撮米」可以，裁判會記進度；能拆就拆</li>
          <li><strong className="text-slate-200">系統本來就知道的事，不要交給裁判。</strong>拿到證物用 item:、到過地點用 visit:、NPC 生死用 npc_dead: —— 直接寫在結局條件裡</li>
        </ol>
        <p className="text-slate-500">
          所有目標都是全隊共有（任一人做到即算）。「活著離開」這類持續狀態請用結局條件，不要寫成目標。玩家看不到目標文字。
        </p>
      </div>
    </details>
  );
}

export function ScenarioObjectivesEditor({
  objectives,
  onChange,
}: {
  objectives: ScenarioObjective[];
  onChange: (next: ScenarioObjective[]) => void;
}) {
  function update(i: number, patch: Partial<ScenarioObjective>) {
    const next = [...objectives];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <ObjectiveWritingTips />
      {objectives.length === 0 && (
        <p className="text-xs text-slate-500">
          尚未設定目標。目標是劇情中可判定「完成 / 未完成」的具體事件，供結局系統與地點解鎖引用。
        </p>
      )}

      {objectives.map((o, i) => (
        <div key={o.id} className="border border-slate-600 rounded-lg p-3 bg-slate-900/50 flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <span className="text-xs text-slate-500 mt-2.5 w-5 shrink-0">{i + 1}.</span>
            <input
              value={o.text}
              onChange={(e) => update(i, { text: e.target.value })}
              placeholder="例：取回聖石並逃出神廟"
              className={inputCls}
            />
            <button
              type="button"
              onClick={() => onChange(objectives.filter((_, j) => j !== i))}
              className="text-slate-500 hover:text-red-400 text-sm mt-2"
              title="刪除此目標"
            >
              ×
            </button>
          </div>
          <div className="flex items-center gap-4 pl-7 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={o.required}
                onChange={(e) => update(i, { required: e.target.checked })}
                className="accent-zinc-500 w-3.5 h-3.5"
              />
              必要目標（非必要＝加分項）
            </label>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...objectives, emptyObjective()])}
        className="text-sm text-zinc-100 hover:text-white border border-dashed border-slate-600 hover:border-zinc-400 rounded-lg py-2 transition-colors"
      >
        + 新增目標
      </button>
    </div>
  );
}
