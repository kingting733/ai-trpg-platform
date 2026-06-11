"use client";

import { useMemo, useState } from "react";
import {
  type LocationNode,
  type EvidenceDef,
  type NpcPlacement,
  type NpcEncounter,
  coerceLocationGraph,
  validateLocationGraph,
} from "@/lib/game/locations";
import { CoverImageUpload } from "@/components/CoverImageUpload";

// Base input styles — no w-full so flex rows work correctly
const baseCls =
  "bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-zinc-500";
// Full-width variant for block-level inputs (textarea, standalone inputs)
const blockCls = `${baseCls} w-full`;

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
    node_image: "",
    node_text: "",
  };
}

export function emptyNpcPlacement(): NpcPlacement {
  return { npc: "", at: "", when: [] };
}

export function emptyNpcEncounter(): NpcEncounter {
  return { npc: "", when: [], beat: "" };
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
          <div className="absolute left-0 top-5 z-50 w-64 bg-slate-800 border border-slate-600 rounded-lg p-2.5 text-[11px] text-slate-300 leading-relaxed shadow-xl text-left font-normal">
            {tip}
          </div>
        )}
      </button>
    </div>
  );
}

const FIELD_TIPS = {
  id: "英文或數字短代號，在整個劇本中唯一。\n例：A、B、lab1\n用途：其他地點的解鎖條件會引用這個 id。",
  name: "玩家看得到的地點名稱，例：「阿澤住所」、「林士站月台」。",
  initial: `開放（起點）：遊戲一開始玩家就可以去。\n已知但鎖定：玩家知道這裡存在，但暫時進不去（地圖上顯示🔒）。\n隱藏：玩家完全不知道這裡存在，需要被「發現」後才會出現在地圖。`,
  desc: "GM 看的場景備註，不會給玩家看。描述這個地點的氛圍、有什麼重要道具、NPC 狀態等。",
  unlock: `填解鎖條件，滿足後系統自動開門。\n留空 = 永遠鎖定（只靠 discovers 才能解開）。\n\n語法：\n  visit:X     ── 去過地點 X\n  item:e1     ── 拿到證物 e1\n  count:標籤:3 ── 累積 3 件有該標籤的證物\n  round:5     ── 到第 5 回合\n  after:X:3   ── 進入 X 滿 3 回合後\n\n用 & 代表「且」、| 代表「或」\n例：item:e1 & visit:B | round:10`,
  discovers: `到達此地點後，系統自動把哪些「隱藏」地點變成「已知但鎖定」狀態（顯示在玩家地圖）。\n填地點 id，逗號分隔。\n例：D, E`,
  on_enter: "第一次進入此地點時，GM 收到的敘事提示。例：「描述昏黃路燈、遠處傳來貓叫聲」",
  locked_narration: "玩家試圖進入但還沒解鎖時，GM 用來拒絕的故事理由。例：「鐵閘已拉下，無法進入」",
  stuck_hint: "玩家在此地點停滯太久時，GM 會自然帶出的暗示。例：「桌上有一張字條...」",
  evidenceId: "證物的唯一代號，例：e1、keycard。\n會被解鎖條件 item:e1 引用。",
  evidenceName: "玩家看到的證物名稱，例：「舊工程圖」、「血跡照片」。",
  evidenceTags: `用於解鎖條件 count:<標籤>:<數量>。\n例如標籤填「身份證據」，條件 count:身份證據:3 = 累積 3 件有此標籤的證物。\n多個標籤用逗號分隔。`,
  evidenceHow: "玩家要怎麼取得這件證物，例：「成功搜查書桌（偵查 60）」。系統用這段文字來判斷玩家行動是否在找這件物品。",
  nodeMedia: "玩家「第一次抵達」此地點時，系統會直接揭示給玩家的圖片與／或文字（例如場景照片、初見描述）。可留空。",
  evidenceMedia: "玩家成功取得這件證物時，系統會直接揭示給玩家的圖片與／或文字（例如信件照片、線索內容）。可留空。",
  npcAt: "此 NPC 所在的地點 ID（與上方地點節點的 id 相同）。",
  npcWhen: `這個位置的生效條件（同解鎖條件語法）。留空 = 一直在此。\n多筆同一 NPC 的設定會依序套用，最後一條滿足的為準。\n例：round:5 表示第 5 回合後才移到這個地點。`,
  npcEncounterWhen: `觸發條件，不可留空（留空不會觸發）。每個事件只觸發一次。\n語法同解鎖條件，例：item:e3 表示玩家取得 e3 後觸發。`,
  npcEncounterBeat: "NPC 出現時 GM 收到的指示，例：「老闆突然推門而入，神色慌張，要求玩家立刻離開」。",
};

export function LocationGraphEditor({
  nodes,
  onChange,
  npcPlacements = [],
  onNpcPlacementsChange,
  npcEncounters = [],
  onNpcEncountersChange,
  npcNames = [],
}: {
  nodes: LocationNode[];
  onChange: (nodes: LocationNode[]) => void;
  npcPlacements?: NpcPlacement[];
  onNpcPlacementsChange?: (v: NpcPlacement[]) => void;
  npcEncounters?: NpcEncounter[];
  onNpcEncountersChange?: (v: NpcEncounter[]) => void;
  npcNames?: string[];
}) {
  const warnings = useMemo(() => {
    if (nodes.length === 0) return [];
    const graph = coerceLocationGraph({ nodes, npc_placements: npcPlacements, npc_encounters: npcEncounters });
    return graph ? validateLocationGraph(graph, npcNames.length ? new Set(npcNames) : undefined) : [];
  }, [nodes, npcPlacements, npcEncounters, npcNames]);

  function update(i: number, patch: Partial<LocationNode>) {
    onChange(nodes.map((n, j) => (j === i ? { ...n, ...patch } : n)));
  }

  function updateEvidence(i: number, ei: number, patch: Partial<EvidenceDef>) {
    const node = nodes[i];
    const evidence = node.evidence.map((e, j) => (j === ei ? { ...e, ...patch } : e));
    update(i, { evidence });
  }

  function updatePlacement(pi: number, patch: Partial<NpcPlacement>) {
    onNpcPlacementsChange?.(npcPlacements.map((p, j) => (j === pi ? { ...p, ...patch } : p)));
  }

  function updateEncounter(ei: number, patch: Partial<NpcEncounter>) {
    onNpcEncountersChange?.(npcEncounters.map((e, j) => (j === ei ? { ...e, ...patch } : e)));
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-2 text-xs text-slate-400">
        <p className="text-slate-300 font-medium">📖 地點解鎖系統說明</p>
        <p>伺服器會追蹤隊伍位置、已取得的證物，以及每個地點的解鎖狀態。AI GM 無法讓玩家進入未解鎖的地點。</p>
        <p>
          <span className="text-emerald-400">留空</span> = 維持自由探索模式（AI GM 自由主持，無地點限制）。
        </p>
        <p>
          <span className="text-amber-400">填了就啟用</span>：至少要有一個「開放（起點）」的地點，玩家才知道從哪裡開始。
        </p>
        <p className="text-slate-500">欄位旁的 ？ 可懸停查看說明。</p>
      </div>

      {warnings.length > 0 && (
        <div className="bg-amber-950/40 border border-amber-900/50 rounded-lg px-4 py-2.5 text-xs text-amber-300/90 space-y-1">
          {warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      )}

      {nodes.map((node, i) => (
        <div key={i} className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 space-y-3">

          {/* Row 1: id / name / status / delete */}
          <div className="flex items-end gap-2">
            <div className="shrink-0 w-24">
              <FieldLabel label="地點 ID" tip={FIELD_TIPS.id} />
              <input
                className={`${baseCls} w-full font-mono`}
                placeholder="如：A"
                value={node.id}
                onChange={(e) => update(i, { id: e.target.value })}
              />
            </div>
            <div className="flex-1 min-w-0">
              <FieldLabel label="地點名稱" tip={FIELD_TIPS.name} />
              <input
                className={`${baseCls} w-full`}
                placeholder="如：阿澤住所"
                value={node.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </div>
            <div className="shrink-0 w-36">
              <FieldLabel label="初始狀態" tip={FIELD_TIPS.initial} />
              <select
                className={`${baseCls} w-full`}
                value={node.initial}
                onChange={(e) => update(i, { initial: e.target.value as LocationNode["initial"] })}
              >
                <option value="unlocked">開放（起點）</option>
                <option value="discovered">已知但鎖定</option>
                <option value="hidden">隱藏</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => onChange(nodes.filter((_, j) => j !== i))}
              className="text-red-400/70 hover:text-red-400 text-xs shrink-0 pb-1.5"
            >
              刪除
            </button>
          </div>

          {/* Row 2: scene description */}
          <div>
            <FieldLabel label="場景描述（GM 專用）" tip={FIELD_TIPS.desc} />
            <textarea
              className={`${blockCls} resize-none`}
              rows={2}
              placeholder="氛圍、重要道具、NPC 狀態——GM 看的備註，不給玩家看"
              value={node.desc}
              onChange={(e) => update(i, { desc: e.target.value })}
            />
          </div>

          {/* Row 3: unlock / discovers */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel label="解鎖條件" tip={FIELD_TIPS.unlock} />
              <input
                className={blockCls}
                placeholder="例：item:e1 & visit:B | round:10"
                value={serializeUnlock(node.unlock)}
                onChange={(e) => update(i, { unlock: parseUnlock(e.target.value) })}
              />
            </div>
            <div>
              <FieldLabel label="進入後自動發現的地點 id" tip={FIELD_TIPS.discovers} />
              <input
                className={blockCls}
                placeholder="例：D, E"
                value={node.discovers.join(", ")}
                onChange={(e) =>
                  update(i, { discovers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                }
              />
            </div>
          </div>

          {/* Row 4: on_enter / locked_narration / stuck_hint */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <FieldLabel label="首次進入提示" tip={FIELD_TIPS.on_enter} />
              <input className={blockCls} placeholder="GM 收到的敘事提示" value={node.on_enter} onChange={(e) => update(i, { on_enter: e.target.value })} />
            </div>
            <div>
              <FieldLabel label="鎖定時的拒絕描述" tip={FIELD_TIPS.locked_narration} />
              <input className={blockCls} placeholder="如：鐵閘已拉下" value={node.locked_narration} onChange={(e) => update(i, { locked_narration: e.target.value })} />
            </div>
            <div>
              <FieldLabel label="卡關提示" tip={FIELD_TIPS.stuck_hint} />
              <input className={blockCls} placeholder="玩家停滯時 GM 給的暗示" value={node.stuck_hint} onChange={(e) => update(i, { stuck_hint: e.target.value })} />
            </div>
          </div>

          {/* Row 5: first-visit media reveal */}
          <div className="pt-3 border-t border-slate-700/60">
            <FieldLabel label="首次抵達揭示給玩家（圖片與／或文字，可留空）" tip={FIELD_TIPS.nodeMedia} />
            <CoverImageUpload
              value={node.node_image ?? ""}
              onChange={(url) => update(i, { node_image: url })}
            />
            <textarea
              className={`${blockCls} resize-none mt-2`}
              rows={2}
              placeholder="第一次抵達時直接顯示給玩家的文字（例如初見場景描述）"
              value={node.node_text ?? ""}
              onChange={(e) => update(i, { node_text: e.target.value })}
            />
          </div>

          {/* Evidence list */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <FieldLabel label="此地點可取得的證物" tip="玩家在這個地點進行搜查且成功時，系統會給予的證物。每件證物需要一個唯一 id。" />
              <button
                type="button"
                onClick={() => update(i, { evidence: [...node.evidence, { id: "", name: "", tags: [], how: "" }] })}
                className="text-zinc-400 hover:text-white text-[11px]"
              >
                + 新增證物
              </button>
            </div>

            {node.evidence.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5 text-[10px] text-slate-500 px-0.5">
                <FieldLabel label="證物 ID" tip={FIELD_TIPS.evidenceId} />
                <FieldLabel label="證物名稱" tip={FIELD_TIPS.evidenceName} />
                <FieldLabel label="標籤" tip={FIELD_TIPS.evidenceTags} />
                <FieldLabel label="取得方式" tip={FIELD_TIPS.evidenceHow} />
              </div>
            )}

            {node.evidence.map((e, ei) => (
              <div key={ei} className="space-y-1.5 bg-slate-900/40 border border-slate-700/60 rounded-lg p-2">
                <div className="grid grid-cols-4 gap-1.5 items-center">
                  <input
                    className={`${baseCls} w-full font-mono`}
                    placeholder="e1"
                    value={e.id}
                    onChange={(ev) => updateEvidence(i, ei, { id: ev.target.value })}
                  />
                  <input
                    className={`${baseCls} w-full`}
                    placeholder="舊工程圖"
                    value={e.name}
                    onChange={(ev) => updateEvidence(i, ei, { name: ev.target.value })}
                  />
                  <input
                    className={`${baseCls} w-full`}
                    placeholder="身份證據"
                    value={e.tags.join(",")}
                    onChange={(ev) =>
                      updateEvidence(i, ei, { tags: ev.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                    }
                  />
                  <div className="flex gap-1 items-center">
                    <input
                      className={`${baseCls} w-full`}
                      placeholder="搜查書桌（偵查 60）"
                      value={e.how}
                      onChange={(ev) => updateEvidence(i, ei, { how: ev.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => update(i, { evidence: node.evidence.filter((_, j) => j !== ei) })}
                      className="text-red-400/70 hover:text-red-400 text-xs shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="pt-1">
                  <FieldLabel label="取得後揭示給玩家（圖片與／或文字，可留空）" tip={FIELD_TIPS.evidenceMedia} />
                  <CoverImageUpload
                    value={e.reveal_image ?? ""}
                    onChange={(url) => updateEvidence(i, ei, { reveal_image: url })}
                  />
                  <textarea
                    className={`${baseCls} w-full resize-none mt-1.5`}
                    rows={2}
                    placeholder="取得此證物時直接顯示給玩家的文字（例如信件內容）"
                    value={e.reveal_text ?? ""}
                    onChange={(ev) => updateEvidence(i, ei, { reveal_text: ev.target.value })}
                  />
                </div>
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

      {/* ── NPC 位置設定 ─────────────────────────────────────────────────────── */}
      {onNpcPlacementsChange && (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-300 font-medium">🧑 NPC 位置設定</p>
              <p className="text-[11px] text-slate-500 mt-0.5">伺服器根據條件告訴 GM 誰在當前地點，GM 不能自行決定 NPC 的位置。</p>
            </div>
            <button
              type="button"
              onClick={() => onNpcPlacementsChange([...npcPlacements, emptyNpcPlacement()])}
              className="text-zinc-400 hover:text-white text-[11px]"
            >
              + 新增
            </button>
          </div>

          {npcPlacements.length > 0 && (
            <div className="grid grid-cols-[1fr_1fr_2fr_auto] gap-1.5 text-[10px] text-slate-500 px-0.5">
              <FieldLabel label="NPC 名稱" tip="必須與上方 NPC 列表的名稱完全相同。" />
              <FieldLabel label="所在地點 ID" tip={FIELD_TIPS.npcAt} />
              <FieldLabel label="條件（可留空）" tip={FIELD_TIPS.npcWhen} />
              <span />
            </div>
          )}

          {npcPlacements.map((p, pi) => (
            <div key={pi} className="grid grid-cols-[1fr_1fr_2fr_auto] gap-1.5 items-center">
              {npcNames.length > 0 ? (
                <select
                  className={`${baseCls} w-full`}
                  value={p.npc}
                  onChange={(e) => updatePlacement(pi, { npc: e.target.value })}
                >
                  <option value="">選擇 NPC</option>
                  {npcNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              ) : (
                <input
                  className={`${baseCls} w-full`}
                  placeholder="NPC 名稱"
                  value={p.npc}
                  onChange={(e) => updatePlacement(pi, { npc: e.target.value })}
                />
              )}
              <input
                className={`${baseCls} w-full font-mono`}
                placeholder="地點 ID"
                value={p.at}
                onChange={(e) => updatePlacement(pi, { at: e.target.value })}
              />
              <input
                className={`${baseCls} w-full`}
                placeholder="留空 = 一直在此；例：round:5"
                value={serializeUnlock(p.when)}
                onChange={(e) => updatePlacement(pi, { when: parseUnlock(e.target.value) })}
              />
              <button
                type="button"
                onClick={() => onNpcPlacementsChange(npcPlacements.filter((_, j) => j !== pi))}
                className="text-red-400/70 hover:text-red-400 text-xs"
              >
                ✕
              </button>
            </div>
          ))}

          {npcPlacements.length === 0 && (
            <p className="text-[11px] text-slate-600 italic">尚無設定。不設定則 GM 可自由安排 NPC 位置。</p>
          )}
        </div>
      )}

      {/* ── NPC 觸發事件 ─────────────────────────────────────────────────────── */}
      {onNpcEncountersChange && (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-300 font-medium">⚡ NPC 觸發事件</p>
              <p className="text-[11px] text-slate-500 mt-0.5">條件成立時，NPC 會主動找上玩家（無論位置），每個事件只觸發一次。</p>
            </div>
            <button
              type="button"
              onClick={() => onNpcEncountersChange([...npcEncounters, emptyNpcEncounter()])}
              className="text-zinc-400 hover:text-white text-[11px]"
            >
              + 新增
            </button>
          </div>

          {npcEncounters.map((enc, ei) => (
            <div key={ei} className="bg-slate-900/40 border border-slate-700/60 rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-[1fr_2fr_auto] gap-1.5 items-center">
                {npcNames.length > 0 ? (
                  <select
                    className={`${baseCls} w-full`}
                    value={enc.npc}
                    onChange={(e) => updateEncounter(ei, { npc: e.target.value })}
                  >
                    <option value="">選擇 NPC</option>
                    {npcNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                ) : (
                  <input
                    className={`${baseCls} w-full`}
                    placeholder="NPC 名稱"
                    value={enc.npc}
                    onChange={(e) => updateEncounter(ei, { npc: e.target.value })}
                  />
                )}
                <div>
                  <FieldLabel label="觸發條件" tip={FIELD_TIPS.npcEncounterWhen} />
                  <input
                    className={`${baseCls} w-full`}
                    placeholder="例：item:e3 | visit:C"
                    value={serializeUnlock(enc.when)}
                    onChange={(e) => updateEncounter(ei, { when: parseUnlock(e.target.value) })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onNpcEncountersChange(npcEncounters.filter((_, j) => j !== ei))}
                  className="text-red-400/70 hover:text-red-400 text-xs self-end pb-1.5"
                >
                  ✕
                </button>
              </div>
              <div>
                <FieldLabel label="出現方式／GM 提示" tip={FIELD_TIPS.npcEncounterBeat} />
                <textarea
                  className={`${blockCls} resize-none`}
                  rows={2}
                  placeholder="例：老闆突然推門而入，神色慌張，要求玩家立刻離開"
                  value={enc.beat}
                  onChange={(e) => updateEncounter(ei, { beat: e.target.value })}
                />
              </div>
            </div>
          ))}

          {npcEncounters.length === 0 && (
            <p className="text-[11px] text-slate-600 italic">尚無設定。</p>
          )}
        </div>
      )}
    </div>
  );
}
