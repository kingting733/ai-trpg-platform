"use client";
import {
  type ScenarioObjective,
  type ObjectiveScope,
  emptyObjective,
} from "@/lib/game/objectives-def";

// Structured editor for a scenario's objectives (the old 通關條件 free-text
// boxes). Each objective is a discrete, checkable goal with a STABLE id — the
// id never shows to the creator (friendly text is the label everywhere), and it
// never shifts when goals are reordered, so multi-ending / location-unlock
// references that point at "objective:<id>" stay valid.

const inputCls =
  "w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500";

const SCOPE_LABEL: Record<ObjectiveScope, string> = {
  party: "任一人完成即可",
  each_player: "每名存活玩家都要做",
};

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
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              範圍
              <select
                value={o.scope}
                onChange={(e) => update(i, { scope: e.target.value as ObjectiveScope })}
                className="bg-slate-800 border border-slate-600 rounded-md px-2 py-1 text-slate-200"
              >
                {(["party", "each_player"] as ObjectiveScope[]).map((s) => (
                  <option key={s} value={s}>{SCOPE_LABEL[s]}</option>
                ))}
              </select>
            </label>
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
        onClick={() => onChange([...objectives, emptyObjective("party")])}
        className="text-sm text-zinc-100 hover:text-white border border-dashed border-slate-600 hover:border-zinc-400 rounded-lg py-2 transition-colors"
      >
        + 新增目標
      </button>
    </div>
  );
}
