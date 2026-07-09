"use client";

import { useMemo, useRef, useState } from "react";
import {
  type LocationNode,
  type EvidenceDef,
  type NpcPlacement,
  type NpcEncounter,
  type ContainerDef,
  type EdgeDef,
  type TravelMode,
  coerceLocationGraph,
  validateLocationGraph,
} from "@/lib/game/locations";
import { CoverImageUpload } from "@/components/CoverImageUpload";
import { ConditionBuilder, type CondKind, type Option } from "@/components/ConditionBuilder";

// Location-system conditions support only these kinds (see evalTerm in locations.ts).
const LOC_KINDS: CondKind[] = ["visit", "item", "count", "round", "after", "objective"];

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
    // New locations are OPEN by default — with no unlock condition a place is
    // simply reachable. The creator can switch it to 已知但鎖定 / 隱藏 if they
    // want it gated.
    initial: "unlocked",
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
  unlock: `只有當此地點設為「已知但鎖定」或「隱藏」時才需要填。\n留空 = 不設額外條件（開放的地點本來就能去；鎖定的地點則只能靠其他地點的「自動發現」開啟）。\n填了條件，滿足後系統自動開門。\n\n語法：\n  visit:X        ── 去過地點 X\n  item:e1        ── 拿到證物 e1\n  count:標籤:3    ── 累積 3 件有該標籤的證物\n  round:5        ── 到第 5 回合\n  after:X:3      ── 進入 X 滿 3 回合後\n  objective:obj_1 ── 完成某個任務目標\n\n用 & 代表「且」、| 代表「或」\n例：item:e1 & visit:B | round:10`,
  discovers: `到達此地點後，系統自動把哪些「隱藏」地點變成「已知但鎖定」狀態（顯示在玩家地圖）。\n點選要自動發現的地點即可（可多選）。`,
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
  region: "「區域」只是地圖上的分組（例如一整間 1404室），玩家不會「站在區域」，而是站在區域裡的某個地點。進入區域時會落在它的入口地點。",
  entry: "玩家從外面進入這個區域時，會抵達的地點（例如 1404室 的入口是 1404門口）。",
  allConnected: "打開後，此區域內所有地點自動互相連通，不用手動拉線（例如同一間屋內的客廳、神位、廁所）。",
  showLocked: "打開後，玩家一走進此區域，就能看見裡面尚未解鎖的地點（顯示🔒，例如上鎖的睡房門）。",
};

// ── Map canvas geometry ────────────────────────────────────────────────────────

const CANVAS_H = 420;
const NODE_W = 128, NODE_H = 46;
const CONT_W = 152, CONT_H = 60;

/** Deterministic fallback layout for items that were never dragged. */
function autoPos(i: number): { x: number; y: number } {
  return { x: 24 + (i % 5) * 178, y: 24 + Math.floor(i / 5) * 96 };
}

function statusIcon(s: LocationNode["initial"]): string {
  return s === "unlocked" ? "○" : s === "discovered" ? "🔒" : "🕳";
}

// Module-scope (NOT recreated per render — an inner component type would make
// React remount the card every parent re-render, dropping pointer capture
// mid-drag). Draggable canvas card using the same pointer-event pattern as the
// chat button drag.
function CanvasCard({
  pos, w, h, isSelected, isLinking, onMove, onTap, children, accent,
}: {
  pos: { x: number; y: number };
  w: number; h: number;
  isSelected: boolean;
  isLinking: boolean;
  onMove: (p: { x: number; y: number }) => void;
  onTap: () => void;
  children: React.ReactNode;
  accent?: boolean;
}) {
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean; active: boolean }>({
    sx: 0, sy: 0, ox: 0, oy: 0, moved: false, active: false,
  });
  return (
    <div
      onPointerDown={(e) => {
        drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false, active: true };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d.active) return;
        const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
        if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        d.moved = true;
        const parent = (e.currentTarget as HTMLElement).parentElement!;
        const maxX = Math.max(0, parent.clientWidth - w);
        onMove({
          x: Math.max(0, Math.min(maxX, d.ox + dx)),
          y: Math.max(0, Math.min(CANVAS_H - h, d.oy + dy)),
        });
      }}
      onPointerUp={() => {
        const d = drag.current;
        const wasTap = d.active && !d.moved;
        d.active = false;
        if (wasTap) onTap();
      }}
      className="absolute select-none touch-none cursor-grab active:cursor-grabbing"
      style={{ left: pos.x, top: pos.y, width: w, height: h, zIndex: isSelected || isLinking ? 20 : 10 }}
    >
      <div
        className="w-full h-full rounded-lg px-2.5 py-1.5 text-left overflow-hidden transition-shadow"
        style={{
          background: accent ? "rgba(30,26,18,0.95)" : "rgba(15,18,26,0.95)",
          border: isLinking
            ? "1.5px dashed #c9a96e"
            : isSelected
              ? "1.5px solid #c9a96e"
              : accent
                ? "1px solid rgba(201,169,110,0.4)"
                : "1px solid #334155",
          boxShadow: isSelected ? "0 0 14px rgba(201,169,110,0.25)" : "0 2px 8px rgba(0,0,0,0.4)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────

export function LocationGraphEditor({
  nodes,
  onChange,
  npcPlacements = [],
  onNpcPlacementsChange,
  npcEncounters = [],
  onNpcEncountersChange,
  npcOptions = [],
  objectiveOptions = [],
  containers = [],
  onContainersChange,
  edges = [],
  onEdgesChange,
  travelMode = "free",
  onTravelModeChange,
}: {
  nodes: LocationNode[];
  onChange: (nodes: LocationNode[]) => void;
  npcPlacements?: NpcPlacement[];
  onNpcPlacementsChange?: (v: NpcPlacement[]) => void;
  npcEncounters?: NpcEncounter[];
  onNpcEncountersChange?: (v: NpcEncounter[]) => void;
  /** NPC roster; `id` is the stable reference stored in placements/encounters. */
  npcOptions?: { id: string; name: string }[];
  objectiveOptions?: Option[];
  containers?: ContainerDef[];
  onContainersChange?: (v: ContainerDef[]) => void;
  edges?: EdgeDef[];
  onEdgesChange?: (v: EdgeDef[]) => void;
  travelMode?: TravelMode;
  onTravelModeChange?: (v: TravelMode) => void;
}) {
  const mapCapable = !!(onContainersChange && onEdgesChange && onTravelModeChange);
  const mapMode = mapCapable && travelMode === "edges";

  // Map-mode view state: full map, or inside one container. `selected` opens
  // the node detail form; `linking` arms click-click edge creation.
  const [view, setView] = useState<{ kind: "full" } | { kind: "container"; id: string }>({ kind: "full" });
  const [selected, setSelected] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<number | null>(null);
  const [edgeListOpen, setEdgeListOpen] = useState(false);

  // Valid NPC references = ids AND names (names tolerate legacy data).
  const npcRefs = useMemo(
    () => new Set(npcOptions.flatMap((n) => [n.id, n.name].filter(Boolean))),
    [npcOptions]
  );
  const warnings = useMemo(() => {
    if (nodes.length === 0) return [];
    const graph = coerceLocationGraph({
      nodes, containers, edges, travel_mode: travelMode,
      npc_placements: npcPlacements, npc_encounters: npcEncounters,
    });
    return graph
      ? validateLocationGraph(
          graph,
          npcRefs.size ? npcRefs : undefined,
          objectiveOptions.length ? new Set(objectiveOptions.map((o) => o.id)) : undefined
        )
      : [];
  }, [nodes, containers, edges, travelMode, npcPlacements, npcEncounters, npcRefs, objectiveOptions]);

  // Options for the ConditionBuilder dropdowns, derived from the graph itself.
  const nodeOptions = useMemo(
    () => nodes.filter((n) => n.id).map((n) => ({ id: n.id, name: n.name })),
    [nodes]
  );
  const itemOptions = useMemo(
    () => nodes.flatMap((n) => n.evidence).filter((e) => e.id).map((e) => ({ id: e.id, name: e.name })),
    [nodes]
  );
  const tagOptions = useMemo(
    () => Array.from(new Set(nodes.flatMap((n) => n.evidence).flatMap((e) => e.tags))).filter(Boolean),
    [nodes]
  );

  function update(i: number, patch: Partial<LocationNode>) {
    onChange(nodes.map((n, j) => (j === i ? { ...n, ...patch } : n)));
  }
  function updateEvidence(i: number, ei: number, patch: Partial<EvidenceDef>) {
    const node = nodes[i];
    const evidence = node.evidence.map((e, j) => (j === ei ? { ...e, ...patch } : e));
    update(i, { evidence });
  }
  function deleteNode(i: number) {
    const id = nodes[i]?.id;
    onChange(nodes.filter((_, j) => j !== i));
    if (id && onEdgesChange) onEdgesChange(edges.filter((e) => e.from !== id && e.to !== id));
    if (selected === id) setSelected(null);
  }
  function updateContainer(id: string, patch: Partial<ContainerDef>) {
    onContainersChange?.(containers.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function deleteContainer(id: string) {
    onContainersChange?.(containers.filter((c) => c.id !== id));
    // Children become top-level rather than vanishing.
    onChange(nodes.map((n) => (n.container === id ? { ...n, container: undefined } : n)));
    onEdgesChange?.(edges.filter((e) => e.from !== id && e.to !== id));
    if (view.kind === "container" && view.id === id) setView({ kind: "full" });
  }
  function updatePlacement(pi: number, patch: Partial<NpcPlacement>) {
    onNpcPlacementsChange?.(npcPlacements.map((p, j) => (j === pi ? { ...p, ...patch } : p)));
  }
  function updateEncounter(ei: number, patch: Partial<NpcEncounter>) {
    onNpcEncountersChange?.(npcEncounters.map((e, j) => (j === ei ? { ...e, ...patch } : e)));
  }

  function nextId(prefix: string, taken: Set<string>): string {
    for (let i = 1; ; i++) {
      const id = `${prefix}${i}`;
      if (!taken.has(id)) return id;
    }
  }
  function addNode(containerId?: string) {
    const taken = new Set([...nodes.map((n) => n.id), ...containers.map((c) => c.id)]);
    const id = nextId("p", taken);
    const inView = containerId ? nodes.filter((n) => n.container === containerId) : nodes.filter((n) => !n.container);
    onChange([
      ...nodes,
      { ...emptyLocationNode(), id, name: "", container: containerId, pos: autoPos(inView.length) },
    ]);
    setSelected(id);
  }
  function addContainer() {
    const taken = new Set([...nodes.map((n) => n.id), ...containers.map((c) => c.id)]);
    const id = nextId("c", taken);
    onContainersChange?.([
      ...containers,
      { id, name: "新區域", entry: "", all_children_connected: true, show_locked_children: true, pos: autoPos(containers.length) },
    ]);
  }

  function handleCardTap(id: string, isContainer: boolean) {
    if (linking) {
      if (linking !== id && onEdgesChange) {
        const dup = edges.some(
          (e) => (e.from === linking && e.to === id) || (e.two_way && e.from === id && e.to === linking)
        );
        if (!dup) onEdgesChange([...edges, { from: linking, to: id, two_way: true }]);
      }
      setLinking(null);
      return;
    }
    if (isContainer) setView({ kind: "container", id });
    else setSelected(selected === id ? null : id);
  }

  // NPC picker — stores the stable id; falls back to a free-text input when no
  // roster exists, and keeps any unrecognised legacy ref visible/selectable.
  function NpcSelect({ value, onChange: onSel }: { value: string; onChange: (v: string) => void }) {
    if (npcOptions.length === 0) {
      return (
        <input className={`${baseCls} w-full`} placeholder="NPC 名稱" value={value} onChange={(e) => onSel(e.target.value)} />
      );
    }
    const known = npcOptions.some((n) => n.id === value);
    return (
      <select className={`${baseCls} w-full`} value={value} onChange={(e) => onSel(e.target.value)}>
        <option value="">選擇 NPC</option>
        {npcOptions.map((n) => <option key={n.id} value={n.id}>{n.name || n.id}</option>)}
        {value && !known && <option value={value}>{value}</option>}
      </select>
    );
  }

  // ── Shared per-node detail form (used by both list mode and map mode).
  // Called as a plain function (renderNodeForm(i)), NOT as <NodeForm/> — an
  // inner component type changes identity every render, which would remount
  // the inputs and drop keyboard focus on every keystroke. ──────────────────
  function renderNodeForm(i: number, showRegion: boolean) {
    const node = nodes[i];
    if (!node) return null;
    return (
      <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 space-y-3">
        {/* Row 1: name / status / region / delete — the ID is auto-generated by
            the system and never shown; creators reference locations by name. */}
        <div className="flex items-end gap-2">
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
          {showRegion && (
            <div className="shrink-0 w-36">
              <FieldLabel label="所在區域" tip={FIELD_TIPS.region} />
              <select
                className={`${baseCls} w-full`}
                value={node.container ?? ""}
                onChange={(e) => update(i, { container: e.target.value || undefined })}
              >
                <option value="">（最外層）</option>
                {containers.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
              </select>
            </div>
          )}
          <button
            type="button"
            onClick={() => deleteNode(i)}
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
        <div className="grid grid-cols-2 gap-3 items-start">
          <div>
            <FieldLabel label="解鎖條件" tip={FIELD_TIPS.unlock} />
            <ConditionBuilder
              value={node.unlock}
              onChange={(v) => update(i, { unlock: v })}
              kinds={LOC_KINDS}
              nodes={nodeOptions}
              items={itemOptions}
              tags={tagOptions}
              objectives={objectiveOptions}
              emptyHint="留空 = 開放的地點可直接前往；鎖定／隱藏的地點靠「自動發現」開啟"
            />
          </div>
          <div>
            <FieldLabel label="進入後自動發現的地點" tip={FIELD_TIPS.discovers} />
            {nodeOptions.filter((o) => o.id !== node.id).length === 0 ? (
              <p className="text-xs text-zinc-500 py-1.5">先新增其他地點才能選擇</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {nodeOptions
                  .filter((o) => o.id !== node.id)
                  .map((o) => {
                    const active = node.discovers.includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() =>
                          update(i, {
                            discovers: active
                              ? node.discovers.filter((d) => d !== o.id)
                              : [...node.discovers, o.id],
                          })
                        }
                        className={`px-2 py-1 rounded text-xs border transition-colors ${
                          active
                            ? "border-gold text-gold bg-[rgba(201,169,110,0.12)]"
                            : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                        }`}
                      >
                        {o.name?.trim() ? o.name : "（未命名）"}
                      </button>
                    );
                  })}
              </div>
            )}
            {node.discovers.filter((d) => !nodeOptions.some((o) => o.id === d)).length > 0 && (
              <p className="text-xs text-amber-500/80 mt-1">
                有 {node.discovers.filter((d) => !nodeOptions.some((o) => o.id === d)).length} 個已刪除的地點連結（儲存後會自動清除）
              </p>
            )}
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
    );
  }

  // ── Canvas for the current view (Layer 1: full map / Layer 2: container).
  // Plain render function for the same focus/remount reason as renderNodeForm.
  function renderMapCanvas() {
    const inContainer = view.kind === "container" ? view.id : null;
    const container = inContainer ? containers.find((c) => c.id === inContainer) ?? null : null;
    const visContainers = inContainer ? [] : containers;
    const visNodes = inContainer
      ? nodes.filter((n) => n.container === inContainer)
      : nodes.filter((n) => !n.container);

    // Item center for edge lines — a child endpoint resolves to its container
    // card on the full map, so cross-container doors still show as lines.
    const centerOf = (rawId: string): { x: number; y: number } | null => {
      const node = nodes.find((n) => n.id === rawId);
      let vid = rawId;
      if (node && !inContainer && node.container) vid = node.container;
      if (node && inContainer && node.container !== inContainer) return null;
      const ci = visContainers.findIndex((c) => c.id === vid);
      if (ci >= 0) {
        const p = visContainers[ci].pos ?? autoPos(ci);
        return { x: p.x + CONT_W / 2, y: p.y + CONT_H / 2 };
      }
      const ni = visNodes.findIndex((n) => n.id === vid);
      if (ni >= 0) {
        const p = visNodes[ni].pos ?? autoPos(visContainers.length + ni);
        return { x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 };
      }
      return null;
    };

    const visibleEdges = edges
      .map((e, idx) => ({ e, idx, a: centerOf(e.from), b: centerOf(e.to) }))
      .filter((x) => x.a && x.b && !(x.a!.x === x.b!.x && x.a!.y === x.b!.y));

    // Faint auto-links between siblings when the container interconnects them.
    const autoLinks: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
    if (container?.all_children_connected) {
      for (let i = 0; i < visNodes.length; i++) {
        for (let j = i + 1; j < visNodes.length; j++) {
          const a = centerOf(visNodes[i].id), b = centerOf(visNodes[j].id);
          if (a && b) autoLinks.push({ a, b });
        }
      }
    }

    return (
      <div className="space-y-2">
        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {inContainer ? (
            <>
              <button type="button" onClick={() => { setView({ kind: "full" }); setLinking(null); }} className="text-zinc-400 hover:text-gold">← 返回全圖</button>
              <span className="text-gold font-medium">{container?.name || inContainer}</span>
            </>
          ) : (
            <span className="text-slate-400">全圖</span>
          )}
          <span className="flex-1" />
          {linking ? (
            <span className="text-gold">點擊另一個地點完成連接（再點原地點取消）</span>
          ) : (
            <span className="text-slate-500">拖曳移動 · 點擊地點編輯 · 點擊區域進入</span>
          )}
          <button type="button" onClick={() => addNode(inContainer ?? undefined)} className="border border-slate-600 hover:border-gold text-slate-300 hover:text-gold rounded px-2 py-1">+ 新地點</button>
          {!inContainer && (
            <button type="button" onClick={addContainer} className="border border-slate-600 hover:border-gold text-slate-300 hover:text-gold rounded px-2 py-1">+ 新區域</button>
          )}
        </div>

        {/* Container settings strip (Layer 2) */}
        {container && (
          <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 flex items-end gap-3 flex-wrap text-xs">
            <div className="w-40">
              <FieldLabel label="區域名稱" tip={FIELD_TIPS.region} />
              <input className={`${baseCls} w-full`} value={container.name} onChange={(e) => updateContainer(container.id, { name: e.target.value })} />
            </div>
            <div className="w-44">
              <FieldLabel label="入口地點" tip={FIELD_TIPS.entry} />
              <select
                className={`${baseCls} w-full`}
                value={container.entry}
                onChange={(e) => updateContainer(container.id, { entry: e.target.value })}
              >
                <option value="">（自動：第一個地點）</option>
                {nodes.filter((n) => n.container === container.id).map((n) => (
                  <option key={n.id} value={n.id}>{n.name || n.id}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-slate-300 pb-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={container.all_children_connected}
                onChange={(e) => updateContainer(container.id, { all_children_connected: e.target.checked })}
              />
              此區域內地點可互相前往
            </label>
            <label className="flex items-center gap-1.5 text-slate-300 pb-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={container.show_locked_children}
                onChange={(e) => updateContainer(container.id, { show_locked_children: e.target.checked })}
              />
              讓玩家看見未解鎖的內部地點
            </label>
            <span className="flex-1" />
            <button type="button" onClick={() => deleteContainer(container.id)} className="text-red-400/70 hover:text-red-400 pb-1.5">刪除區域（地點保留）</button>
          </div>
        )}

        {/* Canvas */}
        <div
          className="relative rounded-xl overflow-hidden"
          style={{ height: CANVAS_H, background: "radial-gradient(circle, rgba(201,169,110,0.05) 1px, transparent 1px) 0 0 / 26px 26px, #0b0e14", border: "1px solid #1e293b" }}
          onClick={() => { setEdgeMenu(null); }}
        >
          {/* Edge lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <defs>
              {/* userSpaceOnUse so the arrow is a fixed, clearly-visible size
                  instead of scaling down with the thin stroke width. */}
              <marker id="loc-arrow" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="16" refX="13" refY="8" orient="auto">
                <path d="M2,2 L14,8 L2,14 Z" fill="#c9a96e" />
              </marker>
            </defs>
            {autoLinks.map((l, i) => (
              <line key={`auto-${i}`} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="rgba(201,169,110,0.12)" strokeDasharray="3 4" />
            ))}
            {visibleEdges.map(({ e, idx, a, b }) => (
              <line
                key={idx}
                x1={a!.x} y1={a!.y} x2={b!.x} y2={b!.y}
                stroke="rgba(201,169,110,0.55)"
                strokeWidth={e.two_way ? 1.5 : 2}
                markerEnd={e.two_way ? undefined : "url(#loc-arrow)"}
              />
            ))}
          </svg>

          {/* Edge midpoint handles */}
          {visibleEdges.map(({ e, idx, a, b }) => (
            <div key={`h-${idx}`} className="absolute" style={{ left: (a!.x + b!.x) / 2 - 9, top: (a!.y + b!.y) / 2 - 9, zIndex: 15 }}>
              <button
                type="button"
                onClick={(ev) => { ev.stopPropagation(); setEdgeMenu(edgeMenu === idx ? null : idx); }}
                className="w-[18px] h-[18px] rounded-full text-[10px] leading-none flex items-center justify-center"
                style={{ background: "#141822", border: "1px solid rgba(201,169,110,0.5)", color: "#c9a96e" }}
                title="編輯路徑"
              >
                {e.two_way ? "⇄" : "→"}
              </button>
              {edgeMenu === idx && (() => {
                const nameOf = (id: string) =>
                  nodes.find((nn) => nn.id === id)?.name?.trim() || containers.find((c) => c.id === id)?.name?.trim() || id;
                return (
                <div className="absolute left-5 top-0 z-30 bg-slate-800 border border-slate-600 rounded-lg p-2 flex flex-col gap-1.5 text-[11px] whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
                  {/* Direction readout — updates live so 反向 has visible effect. */}
                  <div className="px-1 text-slate-300">
                    <span className="text-gold font-medium">{nameOf(e.from)}</span>
                    <span className="mx-1 text-gold">{e.two_way ? "⇄" : "→"}</span>
                    <span className="text-gold font-medium">{nameOf(e.to)}</span>
                    <span className="ml-1.5 text-slate-500">{e.two_way ? "（雙向）" : "（單向）"}</span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => onEdgesChange?.(edges.map((x, j) => (j === idx ? { ...x, two_way: !x.two_way } : x)))}
                      className="px-2 py-1 rounded border border-slate-600 text-slate-300 hover:border-gold hover:text-gold"
                    >
                      {e.two_way ? "改為單向 →" : "改為雙向 ⇄"}
                    </button>
                    {!e.two_way && (
                      <button
                        type="button"
                        onClick={() => onEdgesChange?.(edges.map((x, j) => (j === idx ? { ...x, from: x.to, to: x.from } : x)))}
                        className="px-2 py-1 rounded border border-slate-600 text-slate-300 hover:border-gold hover:text-gold"
                        title="調換單向路徑的方向"
                      >
                        反向 ⇋
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { onEdgesChange?.(edges.filter((_, j) => j !== idx)); setEdgeMenu(null); }}
                      className="px-2 py-1 rounded border border-slate-600 text-red-400/80 hover:border-red-400 hover:text-red-400"
                    >
                      刪除
                    </button>
                  </div>
                </div>
                );
              })()}
            </div>
          ))}

          {/* Container cards */}
          {visContainers.map((c, ci) => {
            const childCount = nodes.filter((n) => n.container === c.id).length;
            return (
              <CanvasCard
                key={c.id}
                pos={c.pos ?? autoPos(ci)}
                w={CONT_W} h={CONT_H}
                accent
                isSelected={selected === c.id}
                isLinking={linking === c.id}
                onMove={(p) => updateContainer(c.id, { pos: p })}
                onTap={() => handleCardTap(c.id, true)}
              >
                <div className="flex items-center justify-between gap-1">
                  <p className="text-[12px] font-medium truncate" style={{ color: "#e4d8be" }}>▣ {c.name || c.id}</p>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setLinking(linking === c.id ? null : c.id); }}
                    className="text-[10px] shrink-0 px-1 rounded border border-slate-600 text-slate-400 hover:text-gold hover:border-gold"
                    title="從這裡連一條路徑"
                  >
                    連接
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5">{childCount} 個地點 · 點擊進入</p>
              </CanvasCard>
            );
          })}

          {/* Place-node cards */}
          {visNodes.map((n, ni) => {
            const i = nodes.indexOf(n);
            return (
              <CanvasCard
                key={n.id || `idx${i}`}
                pos={n.pos ?? autoPos(visContainers.length + ni)}
                w={NODE_W} h={NODE_H}
                isSelected={selected === n.id}
                isLinking={linking === n.id}
                onMove={(p) => update(i, { pos: p })}
                onTap={() => handleCardTap(n.id, false)}
              >
                <div className="flex items-center justify-between gap-1">
                  <p className="text-[12px] truncate text-slate-200">
                    {statusIcon(n.initial)} {n.name?.trim() || n.id || "（未命名）"}
                  </p>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setLinking(linking === n.id ? null : n.id); }}
                    className="text-[10px] shrink-0 px-1 rounded border border-slate-600 text-slate-400 hover:text-gold hover:border-gold"
                    title="從這裡連一條路徑"
                  >
                    連接
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 truncate">
                  {container?.entry === n.id ? "🚪 入口 · " : ""}
                  {n.evidence.length > 0 ? `${n.evidence.length} 證物` : ""}
                </p>
              </CanvasCard>
            );
          })}

          {visContainers.length === 0 && visNodes.length === 0 && (
            <p className="absolute inset-0 flex items-center justify-center text-slate-600 text-sm">
              {inContainer ? "此區域還沒有地點 — 點右上「+ 新地點」" : "點右上「+ 新地點」或「+ 新區域」開始畫地圖"}
            </p>
          )}
        </div>

        {/* Edge list — collapsed by default (the canvas covers normal editing);
            still the only way to edit paths whose endpoints live in different
            layers and can't be drawn on the current canvas view. */}
        {edges.length > 0 && (
          <div className="bg-slate-800/40 border border-slate-700 rounded-lg p-3">
            <button
              type="button"
              onClick={() => setEdgeListOpen((o) => !o)}
              className="text-[11px] text-slate-400 hover:text-slate-200 font-medium flex items-center gap-1"
            >
              {edgeListOpen ? "▾" : "▸"} 路徑一覽（{edges.length}）
            </button>
            {edgeListOpen && <div className="space-y-1.5 mt-2">
            {edges.map((e, idx) => {
              const nameOf = (id: string) =>
                nodes.find((n) => n.id === id)?.name || containers.find((c) => c.id === id)?.name || id;
              return (
                <div key={idx} className="flex items-center gap-2 text-xs text-slate-300">
                  <span className="flex-1 truncate">
                    {nameOf(e.from)} <span className="text-gold">{e.two_way ? "⇄" : "→"}</span> {nameOf(e.to)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onEdgesChange?.(edges.map((x, j) => (j === idx ? { ...x, two_way: !x.two_way } : x)))}
                    className="text-slate-500 hover:text-gold"
                  >
                    {e.two_way ? "改單向" : "改雙向"}
                  </button>
                  {!e.two_way && (
                    <button
                      type="button"
                      onClick={() => onEdgesChange?.(edges.map((x, j) => (j === idx ? { ...x, from: x.to, to: x.from } : x)))}
                      className="text-slate-500 hover:text-gold"
                      title="調換方向"
                    >
                      反向
                    </button>
                  )}
                  <button type="button" onClick={() => onEdgesChange?.(edges.filter((_, j) => j !== idx))} className="text-red-400/70 hover:text-red-400">✕</button>
                </div>
              );
            })}
            </div>}
          </div>
        )}
      </div>
    );
  }

  const selectedIdx = selected ? nodes.findIndex((n) => n.id === selected) : -1;

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-2 text-xs text-slate-400">
        <p className="text-slate-300 font-medium">📖 地點系統說明</p>
        <p>伺服器會追蹤隊伍位置、已取得的證物，以及每個地點的解鎖狀態。AI GM 無法讓玩家進入未解鎖的地點。</p>
        {mapMode ? (
          <p>
            <span className="text-emerald-400">地圖模式</span>：玩家只能沿著你畫的路徑移動。用「區域」把同一空間的地點包起來（例如 1404室），區域內可設定自動互通。
          </p>
        ) : (
          <p>
            <span className="text-emerald-400">留空</span> = 維持自由探索模式（AI GM 自由主持，無地點限制）。
            <span className="text-amber-400"> 填了就啟用</span>：至少要有一個「開放（起點）」的地點。
          </p>
        )}
        <p className="text-slate-500">欄位旁的 ？ 可懸停查看說明。</p>
      </div>

      {/* Mode switch */}
      {mapCapable && !mapMode && (
        <button
          type="button"
          onClick={() => onTravelModeChange!("edges")}
          className="w-full rounded-xl py-3 text-sm transition-colors"
          style={{ background: "rgba(201,169,110,0.08)", border: "1px dashed rgba(201,169,110,0.5)", color: "#c9a96e" }}
        >
          ✨ 升級為地圖模式 — 視覺化地圖、區域分組、路徑連接（玩家將只能沿路徑移動）
        </button>
      )}
      {mapCapable && mapMode && (
        <p className="text-right text-[11px] text-slate-600">
          <button type="button" onClick={() => onTravelModeChange!("free")} className="hover:text-slate-400 underline decoration-dotted">
            回到自由移動模式
          </button>
          （地圖與路徑會保留，只是不再限制移動）
        </p>
      )}

      {warnings.length > 0 && (
        <div className="bg-amber-950/40 border border-amber-900/50 rounded-lg px-4 py-2.5 text-xs text-amber-300/90 space-y-1">
          {warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      )}

      {mapMode ? (
        <>
          {renderMapCanvas()}
          {selectedIdx >= 0 && (
            <div>
              <p className="text-xs text-gold mb-1.5">✏️ 節點詳情：{nodes[selectedIdx].name || nodes[selectedIdx].id}
                <button type="button" onClick={() => setSelected(null)} className="ml-2 text-slate-500 hover:text-slate-300">收起</button>
              </p>
              {renderNodeForm(selectedIdx, true)}
            </div>
          )}
        </>
      ) : (
        <>
          {nodes.map((_, i) => (
            <div key={i}>{renderNodeForm(i, false)}</div>
          ))}
          <button
            type="button"
            onClick={() => addNode()}
            className="w-full border border-dashed border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white rounded-xl py-2.5 text-sm transition-colors"
          >
            + 新增地點節點
          </button>
        </>
      )}

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
              <FieldLabel label="所在地點" tip={FIELD_TIPS.npcAt} />
              <FieldLabel label="條件（可留空）" tip={FIELD_TIPS.npcWhen} />
              <span />
            </div>
          )}

          {npcPlacements.map((p, pi) => (
            <div key={pi} className="grid grid-cols-[1fr_1fr_2fr_auto] gap-1.5 items-start">
              <NpcSelect value={p.npc} onChange={(v) => updatePlacement(pi, { npc: v })} />
              {nodeOptions.length > 0 ? (
                <select
                  className={`${baseCls} w-full`}
                  value={p.at}
                  onChange={(e) => updatePlacement(pi, { at: e.target.value })}
                >
                  <option value="">選擇地點</option>
                  {nodeOptions.map((o) => <option key={o.id} value={o.id}>{o.name || o.id}</option>)}
                  {p.at && !nodeOptions.some((o) => o.id === p.at) && <option value={p.at}>{p.at}</option>}
                </select>
              ) : (
                <input
                  className={`${baseCls} w-full font-mono`}
                  placeholder="地點 ID"
                  value={p.at}
                  onChange={(e) => updatePlacement(pi, { at: e.target.value })}
                />
              )}
              <ConditionBuilder
                value={p.when}
                onChange={(v) => updatePlacement(pi, { when: v })}
                kinds={LOC_KINDS}
                nodes={nodeOptions}
                items={itemOptions}
                tags={tagOptions}
                objectives={objectiveOptions}
                emptyHint="留空 = 一直在此"
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
              <div className="grid grid-cols-[1fr_2fr_auto] gap-1.5 items-start">
                <NpcSelect value={enc.npc} onChange={(v) => updateEncounter(ei, { npc: v })} />
                <div>
                  <FieldLabel label="觸發條件" tip={FIELD_TIPS.npcEncounterWhen} />
                  <ConditionBuilder
                    value={enc.when}
                    onChange={(v) => updateEncounter(ei, { when: v })}
                    kinds={LOC_KINDS}
                    nodes={nodeOptions}
                    items={itemOptions}
                    tags={tagOptions}
                    objectives={objectiveOptions}
                    emptyHint="必填，留空不會觸發"
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
