import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buildScenarioExport, EXPORT_VERSION } from "@/lib/ai/scenario-export";
import { CopyPromptButton } from "../../prompt/CopyPromptButton";

// CREATOR ONLY — unlike /scenarios/prompt (which is deliberately public), this
// page emits gm_notes, endings, evidence and the full story: the entire answer
// key. It must never be reachable for a scenario you did not write.
export const dynamic = "force-dynamic";

export default async function ScenarioExportPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: scenario } = user
    ? await supabase.from("scenarios").select("*").eq("id", params.id).maybeSingle()
    : { data: null };

  // Same message for "not yours" and "does not exist" — a distinct error would
  // let anyone probe which scenario ids are real.
  if (!scenario || !user || scenario.creator_id !== user.id) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <p className="text-zinc-400 mb-4">找不到這個劇本，或它不是你建立的。</p>
        <Link href="/scenarios" className="text-gold hover:brightness-110 text-sm inline-flex items-center gap-1">
          <ArrowLeft size={14} strokeWidth={2} /> 回到劇本列表
        </Link>
      </div>
    );
  }

  const exportText = buildScenarioExport(scenario);

  return (
    <div className="max-w-4xl mx-auto pb-16">
      <Link
        href={`/scenarios/${params.id}/edit`}
        className="text-zinc-400 hover:text-gold text-sm inline-flex items-center gap-1 mb-6"
      >
        <ArrowLeft size={14} strokeWidth={2} />回到編輯劇本
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-px w-6" style={{ background: "rgba(201,169,110,0.3)" }} />
          <span className="text-[10px] tracking-[0.25em] uppercase" style={{ color: "rgba(201,169,110,0.45)" }}>
            Scenario → AI · v{EXPORT_VERSION}
          </span>
        </div>
        <h1 className="font-serif text-3xl mb-2" style={{ color: "#e4d8be", letterSpacing: "0.04em" }}>
          用你自己的 AI 改進這個劇本
        </h1>
        <p className="text-zinc-500 text-sm leading-relaxed">
          複製下面整段，貼給任何 AI（ChatGPT／Claude／Gemini 都可以），跟它討論這個劇本哪裡可以更好。
          討論完叫它輸出完整 JSON，再貼回<span className="text-gold">匯入</span>就會變成改進後的劇本。
          用的是你自己的 AI 額度，想改幾次都可以。
        </p>
      </div>

      <ol className="rounded-xl p-5 mb-6 space-y-2" style={{ background: "rgba(22,19,16,0.8)", border: "1px solid #2a2418" }}>
        {[
          "複製下面整段（已經包含指示 + 你的劇本資料）。",
          "貼給任何 AI，並在「我最想要的改進」那段寫下你的要求。",
          "跟它來回討論，滿意了才叫它輸出完整 JSON。",
          "把 JSON 貼回「建立劇本 → 匯入」，系統會直接讀取，不需要再花平台的 AI 額度。",
        ].map((s, i) => (
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
            {scenario.title}（{exportText.length.toLocaleString()} 字元）
          </span>
          <CopyPromptButton text={exportText} />
        </div>
        <pre
          className="p-4 text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-[60vh] overflow-y-auto"
          style={{ color: "#bdb29a" }}
        >
          {exportText}
        </pre>
      </div>

      <div className="rounded-xl p-4 text-xs text-zinc-500 leading-relaxed mb-6"
        style={{ background: "rgba(22,19,16,0.6)", border: "1px solid #2a2418" }}>
        <p className="text-zinc-400 mb-1.5">小提醒</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>這段內容包含<span className="text-gold">結局、證物、GM 筆記</span>——不要貼給還沒玩過的玩家。</li>
          <li>要 AI 輸出<span className="text-gold">完整</span>的 JSON，不要只給改動的部分，否則貼回來會缺欄位。</li>
          <li>AI 有時會自己發明平台不支援的條件寫法；匯入後的「匯入報告」會列出來，照著修就好。</li>
          <li>匯入會建立一個<span className="text-gold">新劇本</span>，原本這個不會被覆蓋。</li>
        </ul>
      </div>

      <Link
        href="/scenarios/new"
        className="inline-flex items-center gap-1.5 px-6 py-3 rounded-lg font-serif text-sm transition-all hover:brightness-110"
        style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07" }}
      >
        改好了，去匯入 <ArrowRight size={14} strokeWidth={2} />
      </Link>
    </div>
  );
}
