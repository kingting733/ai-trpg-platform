"use client";

// Shared visual builder for the `string[][]` condition syntax used across the
// location unlock graph and the multi-ending system. Renders each term as a
// chip; groups of chips are joined by AND, groups themselves by OR. Creators
// never type the raw `item:e3 & npc_alive:阿澤 | round:20` syntax — they pick a
// condition type from a dropdown and choose/enter the value.
//
// Data model is identical to serializeUnlock/parseUnlock: value is an
// any-of array of all-of arrays of term strings.

import { useState } from "react";
import { Footprints, Key, BarChart3, Clock, Hourglass, Skull, Heart, Target, X } from "lucide-react";

export type CondKind =
  | "visit"
  | "item"
  | "count"
  | "round"
  | "after"
  | "npc_dead"
  | "npc_alive"
  | "objective";

export interface Option {
  id: string;
  name?: string;
}

const baseCls =
  "bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-zinc-500";

const KIND_LABELS: Record<CondKind, string> = {
  visit: "去過地點",
  item: "取得證物",
  count: "證物標籤累積數量",
  round: "到達回合數",
  after: "進入地點後 N 回合",
  npc_dead: "NPC 已死亡",
  npc_alive: "NPC 仍存活",
  objective: "完成目標",
};

const ALL_KINDS: CondKind[] = [
  "visit", "item", "count", "round", "after", "npc_dead", "npc_alive", "objective",
];

// Parse a stored term string back into kind + parts so existing chips render.
function parseTerm(term: string): { kind: CondKind | null; a: string; b: string } {
  const idx = term.indexOf(":");
  if (idx === -1) return { kind: null, a: term, b: "" };
  const kind = term.slice(0, idx) as CondKind;
  const rest = term.slice(idx + 1);
  if (kind === "count" || kind === "after") {
    const sep = rest.lastIndexOf(":");
    if (sep !== -1) return { kind, a: rest.slice(0, sep), b: rest.slice(sep + 1) };
    return { kind, a: rest, b: "" };
  }
  if (!ALL_KINDS.includes(kind)) return { kind: null, a: term, b: "" };
  return { kind, a: rest, b: "" };
}

function buildTerm(kind: CondKind, a: string, b: string): string {
  switch (kind) {
    case "count": return `count:${a}:${b || "1"}`;
    case "after": return `after:${a}:${b || "1"}`;
    default: return `${kind}:${a}`;
  }
}

// Human-readable chip label using option name maps where available.
function humanize(
  term: string,
  nodes: Option[],
  items: Option[],
  objectives: Option[],
  npcs: Option[],
): { icon: React.ReactNode; text: string } {
  const { kind, a, b } = parseTerm(term);
  const nodeName = (id: string) => nodes.find((n) => n.id === id)?.name || id;
  const itemName = (id: string) => items.find((n) => n.id === id)?.name || id;
  const objName = (id: string) => objectives.find((n) => n.id === id)?.name || id;
  const npcName = (id: string) => npcs.find((n) => n.id === id)?.name || id;
  const icon = <Footprints size={12} strokeWidth={2} />;
  switch (kind) {
    case "visit": return { icon: <Footprints size={12} strokeWidth={2} />, text: `去過「${nodeName(a)}」` };
    case "item": return { icon: <Key size={12} strokeWidth={2} />, text: `取得「${itemName(a)}」` };
    case "count": return { icon: <BarChart3 size={12} strokeWidth={2} />, text: `「${a}」標籤 ≥ ${b}` };
    case "round": return { icon: <Clock size={12} strokeWidth={2} />, text: `第 ${a} 回合` };
    case "after": return { icon: <Hourglass size={12} strokeWidth={2} />, text: `進入「${nodeName(a)}」滿 ${b} 回合` };
    case "npc_dead": return { icon: <Skull size={12} strokeWidth={2} />, text: `${npcName(a)} 死亡` };
    case "npc_alive": return { icon: <Heart size={12} strokeWidth={2} />, text: `${npcName(a)} 存活` };
    case "objective": return { icon: <Target size={12} strokeWidth={2} />, text: `${objName(a)}` };
    default: return { icon, text: term };
  }
}

function ValueInput({
  kind,
  a,
  b,
  setA,
  setB,
  nodes,
  items,
  tags,
  npcs,
  objectives,
}: {
  kind: CondKind;
  a: string;
  b: string;
  setA: (v: string) => void;
  setB: (v: string) => void;
  nodes: Option[];
  items: Option[];
  tags: string[];
  npcs: Option[];
  objectives: Option[];
}) {
  function optSelect(opts: Option[], placeholder: string) {
    if (opts.length === 0) {
      return (
        <input className={`${baseCls} w-full`} placeholder={placeholder} value={a} onChange={(e) => setA(e.target.value)} />
      );
    }
    const known = opts.some((o) => o.id === a);
    return (
      <select className={`${baseCls} w-full`} value={a} onChange={(e) => setA(e.target.value)}>
        <option value="">{placeholder}</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.name ? `${o.name}（${o.id}）` : o.id}</option>)}
        {a && !known && <option value={a}>{a}</option>}
      </select>
    );
  }

  function npcSelect() {
    if (npcs.length === 0) {
      return <input className={`${baseCls} w-full`} placeholder="NPC 名稱" value={a} onChange={(e) => setA(e.target.value)} />;
    }
    const known = npcs.some((n) => n.id === a);
    return (
      <select className={`${baseCls} w-full`} value={a} onChange={(e) => setA(e.target.value)}>
        <option value="">選擇 NPC</option>
        {npcs.map((n) => <option key={n.id} value={n.id}>{n.name || n.id}</option>)}
        {a && !known && <option value={a}>{a}</option>}
      </select>
    );
  }

  switch (kind) {
    case "visit": return optSelect(nodes, "選擇地點");
    case "item": return optSelect(items, "選擇證物");
    case "objective": return optSelect(objectives, "選擇目標");
    case "npc_dead":
    case "npc_alive": return npcSelect();
    case "round":
      return <input type="number" min={1} className={`${baseCls} w-full`} placeholder="回合數" value={a} onChange={(e) => setA(e.target.value)} />;
    case "count":
      return (
        <div className="flex gap-1 items-center">
          {tags.length > 0 ? (
            <select className={`${baseCls} flex-1`} value={a} onChange={(e) => setA(e.target.value)}>
              <option value="">選擇標籤</option>
              {tags.map((t) => <option key={t} value={t}>{t}</option>)}
              {a && !tags.includes(a) && <option value={a}>{a}</option>}
            </select>
          ) : (
            <input className={`${baseCls} flex-1`} placeholder="標籤" value={a} onChange={(e) => setA(e.target.value)} />
          )}
          <span className="text-slate-500 text-xs">≥</span>
          <input type="number" min={1} className={`${baseCls} w-14`} placeholder="N" value={b} onChange={(e) => setB(e.target.value)} />
        </div>
      );
    case "after":
      return (
        <div className="flex gap-1 items-center">
          {optSelect(nodes, "選擇地點")}
          <span className="text-slate-500 text-xs whitespace-nowrap">滿</span>
          <input type="number" min={1} className={`${baseCls} w-14`} placeholder="N" value={b} onChange={(e) => setB(e.target.value)} />
          <span className="text-slate-500 text-xs whitespace-nowrap">回合</span>
        </div>
      );
    default: return null;
  }
}

export function ConditionBuilder({
  value,
  onChange,
  kinds = ALL_KINDS,
  nodes = [],
  items = [],
  tags = [],
  npcs = [],
  objectives = [],
  emptyHint = "尚未設定條件",
}: {
  value: string[][];
  onChange: (v: string[][]) => void;
  kinds?: CondKind[];
  nodes?: Option[];
  items?: Option[];
  tags?: string[];
  npcs?: Option[];
  objectives?: Option[];
  emptyHint?: string;
}) {
  // Which group the inline picker is open for (value.length === new OR group).
  const [picker, setPicker] = useState<number | null>(null);
  const [kind, setKind] = useState<CondKind>(kinds[0]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");

  function openPicker(group: number) {
    setKind(kinds[0]);
    setA("");
    setB("");
    setPicker(group);
  }

  function removeTerm(gi: number, ti: number) {
    const next = value
      .map((g, j) => (j === gi ? g.filter((_, k) => k !== ti) : g))
      .filter((g) => g.length > 0);
    onChange(next);
  }

  function commit() {
    if (picker === null || !a.trim()) return;
    const term = buildTerm(kind, a.trim(), b.trim());
    const next = value.map((g) => [...g]);
    if (picker >= next.length) next.push([term]);
    else next[picker].push(term);
    onChange(next);
    setPicker(null);
    setA("");
    setB("");
  }

  const pickerBox = (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-2 space-y-2 mt-1">
      <div className="flex gap-1.5 items-center">
        <select
          className={`${baseCls} shrink-0`}
          value={kind}
          onChange={(e) => { setKind(e.target.value as CondKind); setA(""); setB(""); }}
        >
          {kinds.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
        </select>
        <div className="flex-1 min-w-0">
          <ValueInput
            kind={kind} a={a} b={b} setA={setA} setB={setB}
            nodes={nodes} items={items} tags={tags} npcs={npcs} objectives={objectives}
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => setPicker(null)} className="text-slate-400 hover:text-white text-[11px]">取消</button>
        <button
          type="button"
          onClick={commit}
          disabled={!a.trim()}
          className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white text-[11px] px-2.5 py-1 rounded-md"
        >
          加入
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-1.5">
      {value.length === 0 && picker === null && (
        <p className="text-[11px] text-slate-600 italic">{emptyHint}</p>
      )}

      {value.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && (
            <div className="flex items-center gap-2 my-1">
              <div className="h-px bg-slate-700 flex-1" />
              <span className="text-[10px] font-medium text-amber-400/80">或 OR</span>
              <div className="h-px bg-slate-700 flex-1" />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-900/40 border border-slate-700/60 rounded-lg p-2">
            {group.map((term, ti) => (
              <span key={ti} className="inline-flex items-center gap-1">
                {ti > 0 && <span className="text-[10px] text-emerald-400/70 font-medium px-0.5">且 AND</span>}
                <span className="inline-flex items-center gap-1 bg-slate-700/70 border border-slate-600 rounded-md pl-2 pr-1 py-0.5 text-[11px] text-slate-100">
                  {(() => { const h = humanize(term, nodes, items, objectives, npcs); return <span className="inline-flex items-center gap-1">{h.icon} {h.text}</span>; })()}
                  <button type="button" onClick={() => removeTerm(gi, ti)} className="text-slate-400 hover:text-red-400 leading-none inline-flex items-center"><X size={12} strokeWidth={2} /></button>
                </span>
              </span>
            ))}
            {picker === gi ? null : (
              <button
                type="button"
                onClick={() => openPicker(gi)}
                className="text-[11px] text-emerald-400/80 hover:text-emerald-300 border border-dashed border-slate-600 hover:border-emerald-700 rounded-md px-1.5 py-0.5"
              >
                ＋ 且
              </button>
            )}
          </div>
          {picker === gi && pickerBox}
        </div>
      ))}

      {/* New OR group */}
      {picker === value.length ? (
        <div>
          {value.length > 0 && (
            <div className="flex items-center gap-2 my-1">
              <div className="h-px bg-slate-700 flex-1" />
              <span className="text-[10px] font-medium text-amber-400/80">或 OR</span>
              <div className="h-px bg-slate-700 flex-1" />
            </div>
          )}
          {pickerBox}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => openPicker(value.length)}
          className="w-full border border-dashed border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white rounded-lg py-1.5 text-[11px] transition-colors"
        >
          {value.length === 0 ? "＋ 新增條件" : "＋ 新增「或」條件群組"}
        </button>
      )}
    </div>
  );
}
