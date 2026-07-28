import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { buildScenarioJsonPrompt, PROMPT_STEPS, PROMPT_VERSION } from "@/lib/ai/scenario-json-prompt";
import { CopyPromptButton } from "./CopyPromptButton";

// PUBLIC (no login) on purpose: a prompt that turns any story into a playable
// scenario is inherently shareable, so the page is linkable to anyone.
// The prompt itself is GENERATED FROM CODE at request time, so it can never
// drift from the live schema.
export const dynamic = "force-dynamic";

export default function ScenarioPromptPage() {
  const prompt = buildScenarioJsonPrompt("full");

  return (
    <div className="max-w-4xl mx-auto pb-16">
      <Link href="/scenarios/new" className="text-zinc-400 hover:text-gold text-sm inline-flex items-center gap-1 mb-6">
        <ArrowLeft size={14} strokeWidth={2} />回到建立劇本
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-px w-6" style={{ background: "rgba(201,169,110,0.3)" }} />
          <span className="text-[10px] tracking-[0.25em] uppercase" style={{ color: "rgba(201,169,110,0.45)" }}>
            Story → Scenario · v{PROMPT_VERSION}
          </span>
        </div>
        <h1 className="font-serif text-3xl mb-2" style={{ color: "#e4d8be", letterSpacing: "0.04em" }}>
          用你自己的 AI 把故事變成劇本
        </h1>
        <p className="text-zinc-500 text-sm leading-relaxed">
          你有完整的故事，但不想一格一格填表？把下面這段 Prompt 貼給任何 AI，加上你的故事，
          它會輸出一段可以直接匯入本平台的 JSON。你用的是自己的 AI 額度，所以想改幾次都可以。
        </p>
      </div>

      {/* Steps */}
      <ol className="rounded-xl p-5 mb-6 space-y-2" style={{ background: "rgba(22,19,16,0.8)", border: "1px solid #2a2418" }}>
        {PROMPT_STEPS.map((s, i) => (
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

      {/* The prompt itself */}
      <div className="rounded-xl overflow-hidden mb-6" style={{ background: "rgba(16,13,9,0.9)", border: "1px solid #2a2418" }}>
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b" style={{ borderColor: "#2a2418" }}>
          <span className="text-xs text-zinc-500">
            Prompt（{prompt.length.toLocaleString()} 字元）— 這段內容會隨平台格式自動更新
          </span>
          <CopyPromptButton text={prompt} />
        </div>
        <pre
          className="p-4 text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-[60vh] overflow-y-auto"
          style={{ color: "#bdb29a" }}
        >
          {prompt}
        </pre>
      </div>

      <div className="rounded-xl p-4 text-xs text-zinc-500 leading-relaxed mb-6"
        style={{ background: "rgba(22,19,16,0.6)", border: "1px solid #2a2418" }}>
        <p className="text-zinc-400 mb-1.5">小提醒</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>AI 有時會自己發明平台不支援的條件寫法 —— 匯入後的「匯入報告」會把這些列出來，照著修就好。</li>
          <li>務必讓 JSON 內含 <span className="text-gold">full_story</span>（故事原文）；AI 主持人靠它理解全貌。</li>
          <li>如果 AI 把 JSON 包在 ``` 裡也沒關係，貼進來時可以一起貼，系統會自動取出。</li>
        </ul>
      </div>

      <Link
        href="/scenarios/new"
        className="inline-flex items-center gap-1.5 px-6 py-3 rounded-lg font-serif text-sm transition-all hover:brightness-110"
        style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07" }}
      >
        拿到 JSON 了，去匯入 <ArrowRight size={14} strokeWidth={2} />
      </Link>
    </div>
  );
}
