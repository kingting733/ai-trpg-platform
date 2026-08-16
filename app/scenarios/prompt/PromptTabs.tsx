"use client";

import { useState } from "react";
import { CopyPromptButton } from "./CopyPromptButton";

// Two prompts, two starting points. Kept as a tabbed pair rather than two pages
// because most creators do not know which one they need until they see the
// difference stated side by side: "I have a story" vs "I have an idea".

export interface PromptTab {
  key: string;
  label: string;
  blurb: string;
  steps: string[];
  prompt: string;
}

export function PromptTabs({ tabs }: { tabs: PromptTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  const tab = tabs.find((t) => t.key === active) ?? tabs[0];
  if (!tab) return null;

  return (
    <>
      {/* A single-path page needs no picker — the strip only earns its place
          when there is a real choice to make. */}
      <div className={`flex gap-2 mb-4 flex-wrap ${tabs.length < 2 ? "hidden" : ""}`}>
        {tabs.map((t) => {
          const on = t.key === tab.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className="px-4 py-2.5 rounded-lg text-sm transition-all text-left"
              style={{
                background: on ? "rgba(201,169,110,0.14)" : "rgba(22,19,16,0.7)",
                border: `1px solid ${on ? "rgba(201,169,110,0.5)" : "#2a2418"}`,
                color: on ? "#e4d8be" : "#8a8070",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* With one path the page header already carries the explanation; showing
          the tab blurb too just says the same thing twice. */}
      {tabs.length > 1 && <p className="text-zinc-500 text-sm leading-relaxed mb-5">{tab.blurb}</p>}

      <ol className="rounded-xl p-5 mb-6 space-y-2" style={{ background: "rgba(22,19,16,0.8)", border: "1px solid #2a2418" }}>
        {tab.steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-sm text-zinc-400">
            <span
              className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold"
              style={{ background: "rgba(201,169,110,0.14)", color: "#c9a96e", border: "1px solid rgba(201,169,110,0.35)" }}
            >
              {i + 1}
            </span>
            <span className="leading-relaxed">{s}</span>
          </li>
        ))}
      </ol>

      <div className="rounded-xl overflow-hidden mb-6" style={{ background: "rgba(16,13,9,0.9)", border: "1px solid #2a2418" }}>
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b" style={{ borderColor: "#2a2418" }}>
          <span className="text-xs text-zinc-500">
            Prompt（{tab.prompt.length.toLocaleString()} 字元）— 這段內容會隨平台格式自動更新
          </span>
          <CopyPromptButton text={tab.prompt} />
        </div>
        <pre
          className="p-4 text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-[60vh] overflow-y-auto"
          style={{ color: "#bdb29a" }}
        >
          {tab.prompt}
        </pre>
      </div>
    </>
  );
}
