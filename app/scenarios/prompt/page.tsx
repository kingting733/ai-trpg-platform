import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { buildScenarioJsonPrompt, buildStoryBriefPrompt, PROMPT_STEPS, BRIEF_STEPS, PROMPT_VERSION } from "@/lib/ai/scenario-json-prompt";
import { PromptTabs } from "./PromptTabs";

// PUBLIC (no login) on purpose: a prompt that turns any story into a playable
// scenario is inherently shareable, so the page is linkable to anyone.
// The prompt itself is GENERATED FROM CODE at request time, so it can never
// drift from the live schema.
export const dynamic = "force-dynamic";

export default function ScenarioPromptPage() {
  const tabs = [
    {
      key: "brief",
      label: "① 我只有一個點子",
      blurb:
        "還沒有完整故事？這段 Prompt 會用訪談的方式一組一組問你（真相 → 地點 → 線索 → NPC → 結局 → 開場），" +
        "問完後輸出一篇完整故事加一份結構附錄。它問的每一個問題，都是為了讓故事在這個平台真的跑得動 —— " +
        "例如每條線索都得有地點、有實體、有拿得到它的動作。",
      steps: BRIEF_STEPS,
      prompt: buildStoryBriefPrompt(),
    },
    {
      key: "json",
      label: "② 我已經有完整故事",
      blurb:
        "故事已經寫好（或剛用上一步生出來）？這段 Prompt 會把它轉成可以直接匯入本平台的 JSON。" +
        "用的是你自己的 AI 額度，想改幾次都可以。",
      steps: PROMPT_STEPS,
      prompt: buildScenarioJsonPrompt("full"),
    },
  ];

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
          用你自己的 AI 寫劇本
        </h1>
        <p className="text-zinc-500 text-sm leading-relaxed">
          兩段 Prompt，看你從哪裡開始。全程用你自己的 AI 額度，平台不收費、想改幾次都可以。
        </p>
      </div>

      <PromptTabs tabs={tabs} />

      <div className="rounded-xl p-4 text-xs text-zinc-500 leading-relaxed mb-6"
        style={{ background: "rgba(22,19,16,0.6)", border: "1px solid #2a2418" }}>
        <p className="text-zinc-400 mb-1.5">小提醒</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>線索沒有「地點 + 實體 + 拿得到它的動作」，在這個平台上等於不存在 —— 第一段 Prompt 就是為了逼出這三樣。</li>
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
