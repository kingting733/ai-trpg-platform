"use client";
// Editor for the optional per-scenario location unlock graph.
// Unlock conditions are typed as text: groups separated by 「|」(OR), terms
// within a group by 「&」(AND). Terms: visit:<地點id> item:<證物id>
// count:<標籤>:<數量> round:<回合> after:<地點id>:<回合數>

import { useMemo } from "react";
import {
  type LocationNode,
  type EvidenceDef,
  coerceLocationGraph,
  validateLocationGraph,
} from "@/lib/game/locations";

const inputCls =
  "w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500 text-sm";
const smallCls = `${inputCls} px-2 py-1.5 text-xs`;

export function emptyLocationNode(): LocationNode {
  return {
    id: "",
    name: "",
    desc: "",
    initial: "hidden",
    unlock: [],
    evidence: [],
    on_enter: "",
    locked_narration: "",
    stuck_hint: "",
    discovers: [],
  };
}

function serializeUnlock(unlock: string[][]): string {
  return unlock.map((g) => g.join(" & ")).join(" | ");
}

function parseUnlock(text: string): string[][] {
  return text
    .split("|")
    .map((g) => g.split("&").map((t) => t.trim()).filter(Boolean))
    .filter((g) => g.length > 0);
}

export function LocationGraphEditor({
  nodes,
  onChange,
}: {
  nodes: LocationNode[];
  onChange: (nodes: LocationNode[]) => void;
}) {
  const warnings = useMemo(() => {
    if (nodes.length === 0) return [];
    const graph = coerceLocationGraph({ nodes });
    return graph ? validateLocationGraph(graph) : [];
  }, [nodes]);

  function update(i: number, patch: Partial<LocationNode>) {
    onChange(nodes.map((n, j) => (j === i ? { ...n, ...patch } : n)));
  }

  function updateEvidence(i: number, ei: number, patch: Partial<EvidenceDef>) {
    const node = nodes[i];
    const evidence = node.evidence.map((e, j) => (j === ei ? { ...e, ...patch } : e));
    update(i, { evidence });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        選填。建立後遊戲將啟用「地點解鎖系統」：伺服器追蹤隊伍位置、證物與解鎖狀態，AI 主持人無法讓玩家進入未解鎖的地點。
        留空則維持自由探索模式。
      </p>

      {warnings.length > 0 && (
        <div className="bg-amber-950/40 border border-amber-900/50 rounded-lg px-4 py-2.5 text-xs text-amber-300/90 space-y-1">
          {warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      )}

      {nodes.map((node, i) => (
        <div key={i} className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <input
              className={`${smallCls} w-24 shrink-0 font-mono`}
              placeholder="id（如 B）"
              value={node.id}
              onChange={(e) => update(i, { id: e.target.value })}
            />
            <input
              className={smallCls}
              placeholder="地點名稱（如 阿澤住所）"
              value={node.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <select
              className={`${smallCls} w-32 shrink-0`}
              value={node.initial}
              onChange={(e) => update(i, { initial: e.target.value as LocationNode["initial"] })}
            >
              <option value="unlocked">開放（起點）</option>
              <option value="discovered">已知但鎖定</option>
              <option value="hidden">隱藏</option>
            </select>
            <button
              type="button"
              onClick={() => onChange(nodes.filter((_, j) => j !== i))}
              className="text-red-400/70 hover:text-red-400 text-xs shrink-0 px-1"
            >
              刪除
            </button>
          </div>

          <textarea
            className={`${smallCls} resize-none`}
            rows={2}
            placeholder="場景描述（GM 專用，敘事參考）"
            value={node.desc}
            onChange={(e) => update(i, { desc: e.target.value })}
          />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                解鎖條件（| 分隔多組「或」，& 為「且」）
              </label>
              <input
                className={smallCls}
                placeholder="例：item:e11 | count:身份證據:2 | visit:N"
                value={serializeUnlock(node.unlock)}
                onChange={(e) => update(i, { unlock: parseUnlock(e.target.value) })}
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                進入後「發現」的地點 id（逗號分隔）
              </label>
              <input
                className={smallCls}
                placeholder="例：D, E"
                value={node.discovers.join(", ")}
                onChange={(e) =>
                  update(i, { discovers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <input
              className={smallCls}
              placeholder="首次進入提示（GM beat）"
              value={node.on_enter}
              onChange={(e) => update(i, { on_enter: e.target.value })}
            />
            <input
              className={smallCls}
              placeholder="鎖定時的拒絕描述（如：鐵閘已拉下）"
              value={node.locked_narration}
              onChange={(e) => update(i, { locked_narration: e.target.value })}
            />
            <input
              className={smallCls}
              placeholder="卡關提示（玩家停滯時 GM 給的暗示）"
              value={node.stuck_hint}
              onChange={(e) => update(i, { stuck_hint: e.target.value })}
            />
          </div>

          {/* Evidence list */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-slate-500">此地點可取得的證物</label>
              <button
                type="button"
                onClick={() =>
                  update(i, { evidence: [...node.evidence, { id: "", name: "", tags: [], how: "" }] })
                }
                className="text-zinc-400 hover:text-white text-[11px]"
              >
                + 新增證物
              </button>
            </div>
            {node.evidence.map((e, ei) => (
              <div key={ei} className="flex items-center gap-1.5">
                <input
                  className={`${smallCls} w-20 shrink-0 font-mono`}
                  placeholder="id（e3）"
                  value={e.id}
                  onChange={(ev) => updateEvidence(i, ei, { id: ev.target.value })}
                />
                <input
                  className={smallCls}
                  placeholder="名稱（舊工程圖）"
                  value={e.name}
                  onChange={(ev) => updateEvidence(i, ei, { name: ev.target.value })}
                />
                <input
                  className={`${smallCls} w-32 shrink-0`}
                  placeholder="標籤（供 count 用）"
                  value={e.tags.join(",")}
                  onChange={(ev) =>
                    updateEvidence(i, ei, { tags: ev.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                  }
                />
                <input
                  className={smallCls}
                  placeholder="取得方式（搜索書桌）"
                  value={e.how}
                  onChange={(ev) => updateEvidence(i, ei, { how: ev.target.value })}
                />
                <button
                  type="button"
                  onClick={() => update(i, { evidence: node.evidence.filter((_, j) => j !== ei) })}
                  className="text-red-400/70 hover:text-red-400 text-xs shrink-0 px-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...nodes, emptyLocationNode()])}
        className="w-full border border-dashed border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white rounded-xl py-2.5 text-sm transition-colors"
      >
        + 新增地點節點
      </button>
    </div>
  );
}
