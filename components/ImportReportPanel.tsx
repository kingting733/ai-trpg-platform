"use client";

import { CircleCheck, AlertTriangle, Trash2, Info } from "lucide-react";
import type { ImportReport } from "@/lib/ai/import-report";

const COUNT_LABELS: Array<[keyof ImportReport["counts"], string]> = [
  ["nodes", "地點"],
  ["containers", "區域"],
  ["edges", "路徑"],
  ["evidence", "證物"],
  ["npcs", "NPC"],
  ["npcPlacements", "NPC 位置"],
  ["npcEncounters", "NPC 事件"],
  ["objectives", "任務目標"],
  ["endings", "結局"],
];

/**
 * Shows exactly what an import kept, dropped, and complained about.
 * This is the piece that makes AI-generated scenario JSON trustworthy: without
 * it, coercion silently discards over-cap or dangling content and the creator
 * only finds out mid-playtest.
 */
export function ImportReportPanel({ report }: { report: ImportReport }) {
  const kept = COUNT_LABELS.filter(([k]) => report.counts[k] > 0);

  return (
    <div className="rounded-xl p-4 mb-4 space-y-3" style={{ background: "rgba(22,19,16,0.8)", border: "1px solid #2a2418" }}>
      <div className="flex items-center gap-2">
        {report.ok ? (
          <CircleCheck size={15} strokeWidth={2} className="text-emerald-400 shrink-0" />
        ) : (
          <AlertTriangle size={15} strokeWidth={2} className="text-amber-400 shrink-0" />
        )}
        <p className="text-sm" style={{ color: report.ok ? "#6ee7b7" : "#fdba74" }}>
          {report.ok ? "匯入完成，沒有發現問題" : "匯入完成，但有幾點需要確認"}
        </p>
      </div>

      {/* What actually survived */}
      {kept.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {kept.map(([k, label]) => (
            <span
              key={k}
              className="text-[11px] px-2 py-0.5 rounded"
              style={{ background: "rgba(14,12,8,0.8)", border: "1px solid #2e2416", color: "#cbb890" }}
            >
              {label} <span className="tabular-nums text-gold font-semibold">{report.counts[k]}</span>
            </span>
          ))}
        </div>
      )}

      {/* Authored content that coercion discarded */}
      {report.dropped.length > 0 && (
        <div className="rounded-lg p-2.5 space-y-1" style={{ background: "rgba(127,29,29,0.15)", border: "1px solid rgba(153,27,27,0.45)" }}>
          <p className="text-[11px] inline-flex items-center gap-1" style={{ color: "#fca5a5" }}>
            <Trash2 size={11} strokeWidth={2} />以下內容沒有被保留
          </p>
          <ul className="text-[11px] text-zinc-400 space-y-0.5 list-disc list-inside">
            {report.dropped.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}

      {/* Validator + our own findings */}
      {report.warnings.length > 0 && (
        <div className="rounded-lg p-2.5 space-y-1" style={{ background: "rgba(69,26,3,0.25)", border: "1px solid rgba(146,64,14,0.5)" }}>
          <p className="text-[11px] inline-flex items-center gap-1" style={{ color: "#fdba74" }}>
            <Info size={11} strokeWidth={2} />建議修正（可在下方各分頁直接編輯）
          </p>
          <ul className="text-[11px] text-zinc-400 space-y-0.5 list-disc list-inside">
            {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
