"use client";

import { Lock, ArrowRight } from "lucide-react";

// Short orientation shown at the top of the create / edit scenario form, so a
// first-time creator immediately understands: what's mandatory, that the GM
// tabs are optional, and a sensible order to fill things in.
export function ScenarioFormGuide() {
  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-5 mb-6 text-sm">
      <p className="text-slate-200 font-medium mb-2">怎麼填？</p>
      <ul className="text-slate-400 space-y-1.5 leading-relaxed">
        <li>
          <span className="text-slate-200">① 玩家資訊</span> 是<span className="text-amber-300">唯一必填</span>的分頁
          （標有 <span className="text-amber-300">*</span> 的欄位）——填好它就能先存成草稿。
        </li>
        <li>
          <span className="text-slate-200">② 世界與故事</span>、
          <span className="text-slate-200">③ 主持人工具</span>（標有 <span className="opacity-70 inline-flex items-center"><Lock size={12} strokeWidth={2} /></span>）
          皆為<span className="text-slate-300">選填</span>，內容只有 AI 主持人看得到，玩家不會看到。
        </li>
        <li>
          建議順序：先把 <span className="text-slate-300">① 必填</span> 填好
          <ArrowRight size={12} strokeWidth={2} className="inline mx-1 align-[-1px]" />補
          <span className="text-slate-300"> ② 開場與故事原文</span>
          <ArrowRight size={12} strokeWidth={2} className="inline mx-1 align-[-1px]" />
          再到 <span className="text-slate-300">③ 設定 NPC、地點與結局</span>。完成度越高，AI 主持得越好。
        </li>
      </ul>
    </div>
  );
}
