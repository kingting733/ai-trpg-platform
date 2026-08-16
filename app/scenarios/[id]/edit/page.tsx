"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Lock, ArrowLeft, Map, Theater, Sparkles } from "lucide-react";
import type { NpcEntry } from "@/lib/ai/gm";
import { CoverImageUpload } from "@/components/CoverImageUpload";
import { LocationGraphEditor } from "@/components/LocationGraphEditor";
import { coerceLocationGraph, nodesFromLegacyLocations, type LocationNode, type NpcPlacement, type NpcEncounter, type ContainerDef, type EdgeDef, type TravelMode } from "@/lib/game/locations";
import { EndingsEditor } from "@/components/EndingsEditor";
import { coerceEndings, type ScenarioEnding } from "@/lib/game/endings";
import { newNpcId, ensureNpcIds, migrateNpcRefList, migrateNpcRefsInConditions } from "@/lib/game/npc";
import { NpcRosterEditor } from "@/components/NpcRosterEditor";
import { ScenarioFormGuide } from "@/components/ScenarioFormGuide";
import type { QualityFailure } from "@/lib/game/scenario-quality";
import { ScenarioObjectivesEditor } from "@/components/ScenarioObjectivesEditor";
import {
  type ScenarioObjective,
  coerceScenarioObjectives,
  objectivesFromLegacyText,
  objectiveOptions,
} from "@/lib/game/objectives-def";

const GENRES = ["Fantasy", "Cyberpunk", "Horror", "Sci-Fi", "Mystery", "Historical", "Other"];
const DIFFICULTIES = ["Story", "Normal", "Hard", "Nightmare"] as const;
type Difficulty = typeof DIFFICULTIES[number];
type Tab = "player" | "world" | "gm";
type Status = "draft" | "pending" | "published";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-slate-400 mb-1">{label}</label>
      {hint && <p className="text-xs text-slate-500 mb-2">{hint}</p>}
      {children}
    </div>
  );
}

const inputCls = "w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500";
const taCls = `${inputCls} resize-none`;

function emptyNpc(): NpcEntry {
  return { id: newNpcId(), name: "", hp: 10, mp: 5, str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50, personality: "", goal: "" };
}

export default function EditScenarioPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("player");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("Normal");
  const [description, setDescription] = useState("");
  const [objective, setObjective] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [estimatedPlayTime, setEstimatedPlayTime] = useState("");
  const [tags, setTags] = useState("");
  const [openingScene, setOpeningScene] = useState("");
  const [sourceDocument, setSourceDocument] = useState("");
  const [objectives, setObjectives] = useState<ScenarioObjective[]>([]);
  const [failureConditions, setFailureConditions] = useState("");
  const [failureTurnLimit, setFailureTurnLimit] = useState("");
  const [endingConditions, setEndingConditions] = useState("");
  const [gmNotes, setGmNotes] = useState("");
  const [mythosKnowledgeReward, setMythosKnowledgeReward] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [npcs, setNpcs] = useState<NpcEntry[]>([]);
  const [locNodes, setLocNodes] = useState<LocationNode[]>([]);
  const [locContainers, setLocContainers] = useState<ContainerDef[]>([]);
  const [locEdges, setLocEdges] = useState<EdgeDef[]>([]);
  const [locTravelMode, setLocTravelMode] = useState<TravelMode>("free");
  const [locNpcPlacements, setLocNpcPlacements] = useState<NpcPlacement[]>([]);
  const [locNpcEncounters, setLocNpcEncounters] = useState<NpcEncounter[]>([]);
  const [endings, setEndings] = useState<ScenarioEnding[]>([]);
  const [currentStatus, setCurrentStatus] = useState<Status>("draft");
  const [language, setLanguage] = useState("zh-TW");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qualityFailures, setQualityFailures] = useState<QualityFailure[]>([]);
  const [reviewNote, setReviewNote] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data } = await supabase
        .from("scenarios")
        .select("*")
        .eq("id", params.id)
        .eq("creator_id", user.id)
        .single();

      if (!data) { setNotFound(true); setLoading(false); return; }

      setTitle(data.title ?? "");
      setGenre(data.genre ?? "");
      setDifficulty((data.difficulty as Difficulty) ?? "Normal");
      setDescription(data.description ?? "");
      setObjective(data.objective ?? "");
      setMaxPlayers(data.max_players ?? 4);
      setEstimatedPlayTime(data.estimated_play_time ? String(data.estimated_play_time) : "");
      setTags(Array.isArray(data.tags) ? data.tags.join(", ") : "");
      setOpeningScene(data.opening_scene ?? "");
      setSourceDocument(data.source_document ?? "");
      // Backfill stable ids for legacy rosters, then migrate every name-based
      // reference (placements, encounters, ending conditions) to those ids so
      // renaming an NPC can no longer break them. A subsequent save persists it.
      const loadedNpcs = ensureNpcIds(
        Array.isArray(data.npcs)
          ? (data.npcs as any[]).filter((n) => n && typeof n === "object" && typeof n.name === "string" && typeof n.hp === "number") as NpcEntry[]
          : []
      );
      setNpcs(loadedNpcs);
      // Prefer structured objectives; migrate legacy free-text boxes (preserving
      // obj_N positional ids) so existing objective:<id> references stay valid.
      const loadedObjectives = coerceScenarioObjectives(data.objectives);
      setObjectives(loadedObjectives.length ? loadedObjectives : objectivesFromLegacyText(data.winning_targets, data.each_player_targets));
      setFailureConditions(data.failure_conditions ?? "");
      setFailureTurnLimit(data.failure_turn_limit != null ? String(data.failure_turn_limit) : "");
      setEndingConditions(data.ending_conditions ?? "");
      setGmNotes(data.gm_notes ?? "");
      setMythosKnowledgeReward(
        (data.mythos_reward as any)?.knowledge ? String((data.mythos_reward as any).knowledge) : ""
      );
      const loadedGraph = coerceLocationGraph(data.location_graph);
      // Retire the legacy free-text `locations`: when this scenario has none of
      // the new graph nodes but does have legacy locations, fold them into
      // always-unlocked nodes (clues/items → desc; reveal media → searchable
      // evidence) so nothing is lost. A subsequent save persists the graph.
      const loadedNodes = (loadedGraph?.nodes as LocationNode[]) ?? [];
      const legacyLocs = Array.isArray(data.locations)
        ? (data.locations as any[]).filter((l) => l && typeof l === "object" && typeof l.name === "string")
        : [];
      setLocNodes(loadedNodes.length ? loadedNodes : nodesFromLegacyLocations(legacyLocs));
      setLocContainers(loadedGraph?.containers ?? []);
      setLocEdges(loadedGraph?.edges ?? []);
      setLocTravelMode(loadedGraph?.travel_mode ?? "free");
      setLocNpcPlacements(migrateNpcRefList((loadedGraph?.npc_placements as NpcPlacement[]) ?? [], loadedNpcs));
      setLocNpcEncounters(migrateNpcRefList((loadedGraph?.npc_encounters as NpcEncounter[]) ?? [], loadedNpcs));
      setEndings(
        coerceEndings(data.endings ?? []).map((e) => ({
          ...e,
          condition: migrateNpcRefsInConditions(e.condition, loadedNpcs),
        }))
      );
      setCoverImageUrl(data.cover_image_url ?? "");
      setCurrentStatus(data.status ?? "draft");
      setReviewNote(typeof data.review_note === "string" ? data.review_note : null);
      setLanguage(data.language ?? "zh-TW");
      setLoading(false);
    }
    load();
  }, [params.id, router]);

  // See app/scenarios/new: publishing is a REVIEW submission now, never a
  // direct status write. Saving always writes 'draft' unless the scenario is
  // already published (an approved scenario stays published when edited).
  async function handleSave(status: Status, thenSubmit = false) {
    if (!title.trim()) { setActiveTab("player"); setError("標題為必填欄位。"); return; }
    if (!genre) { setActiveTab("player"); setError("類型為必填欄位。"); return; }
    if (!description.trim()) { setActiveTab("player"); setError("描述為必填欄位。"); return; }
    if (!objective.trim()) { setActiveTab("player"); setError("目標為必填欄位。"); return; }
    const mp = Number(maxPlayers);
    if (mp < 1 || mp > 6) { setActiveTab("player"); setError("玩家人數必須介於 1 至 6 之間。"); return; }

    setSaving(true);
    setError(null);
    setSuccess(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    const ept = estimatedPlayTime ? parseInt(estimatedPlayTime) : null;

    const cleanObjectives = objectives.filter((o) => o.text.trim());
    const partyText = cleanObjectives.filter((o) => o.scope === "party").map((o) => o.text.trim()).join("\n") || null;
    const eachText = cleanObjectives.filter((o) => o.scope === "each_player").map((o) => o.text.trim()).join("\n") || null;

    const { error: updateError } = await supabase
      .from("scenarios")
      .update({
        title: title.trim(),
        genre,
        difficulty,
        description: description.trim(),
        objective: objective.trim(),
        max_players: mp,
        estimated_play_time: ept || null,
        tags: tagList,
        opening_scene: openingScene.trim() || null,
        locations: [],
        npcs,
        objectives: cleanObjectives,
        winning_targets: partyText,
        each_player_targets: eachText,
        failure_conditions: failureConditions.trim() || null,
        failure_turn_limit: failureTurnLimit ? parseInt(failureTurnLimit) : null,
        ending_conditions: endingConditions.trim() || null,
        gm_notes: gmNotes.trim() || null,
        // 克蘇魯知識 ending reward — official-story only; granted server-side on
        // first clear (docs/design/mythos-skills-v1.md).
        mythos_reward: Number(mythosKnowledgeReward) > 0
          ? { knowledge: Math.min(40, Math.floor(Number(mythosKnowledgeReward))) }
          : null,
        source_document: sourceDocument.trim() || null,
        cover_image_url: coverImageUrl.trim() || null,
        location_graph: locNodes.length
          ? coerceLocationGraph({
              nodes: locNodes,
              containers: locContainers,
              edges: locEdges,
              travel_mode: locTravelMode,
              npc_placements: locNpcPlacements,
              npc_encounters: locNpcEncounters,
            })
          : null,
        endings: endings.length ? endings : [],
        language,
        status: currentStatus === "published" ? "published" : "draft",
      })
      .eq("id", params.id)
      .eq("creator_id", user.id);

    if (updateError) { setSaving(false); setError(updateError.message); return; }

    if (thenSubmit) {
      const res = await fetch(`/api/scenarios/${params.id}/submit`, { method: "POST" });
      const json = await res.json().catch(() => null);
      setSaving(false);
      if (!res.ok) {
        setQualityFailures(Array.isArray(json?.failures) ? json.failures : []);
        setError(json?.error ?? "送審失敗。");
        setSuccess("變更已儲存（尚未送審）。");
        return;
      }
      setQualityFailures([]);
      setCurrentStatus("pending");
      setSuccess("已送出審核！通過後就會出現在劇本列表。");
      setTimeout(() => router.push("/dashboard"), 1200);
      return;
    }

    setSaving(false);
    setSuccess(currentStatus === "published" ? "已更新（維持發佈中）。" : "已儲存為草稿。");
    setTimeout(() => router.push("/dashboard"), 900);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-slate-500">載入劇本中...</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-400">找不到劇本或你沒有編輯權限。</p>
        <button onClick={() => router.push("/dashboard")} className="inline-flex items-center gap-1 text-zinc-100 hover:text-white text-sm">
          <ArrowLeft size={14} strokeWidth={2} /> 返回後台
        </button>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "player", label: "玩家資訊" },
    { id: "world", label: "世界與故事" },
    { id: "gm", label: "主持人工具" },
  ];

  const gmBanner = (
    <div className="bg-amber-950/40 border border-amber-900/50 rounded-lg px-4 py-2.5 text-xs text-amber-300/90">
      僅供主持人 — 玩家在劇本瀏覽或詳情頁面將看不到此內容。
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">編輯劇本</h1>
          <p className="text-slate-400 mt-1">
            狀態：<span className={currentStatus === "published" ? "text-green-400" : currentStatus === "pending" ? "text-amber-400" : "text-slate-400"}>
              {currentStatus === "published" ? "已發佈" : currentStatus === "pending" ? "審核中" : "草稿"}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => router.push(`/scenarios/${params.id}/export`)}
            className="inline-flex items-center gap-1.5 text-sm rounded-lg px-3 py-1.5 transition-colors text-gold hover:text-gold-light border border-gold-dim hover:border-gold-muted"
          >
            <Sparkles size={14} strokeWidth={2} /> 用 AI 改進
          </button>
          <button onClick={() => router.push("/dashboard")} className="inline-flex items-center gap-1 text-slate-400 hover:text-white text-sm">
            <ArrowLeft size={14} strokeWidth={2} /> 返回後台
          </button>
        </div>
      </div>

      <ScenarioFormGuide />

      <div className="flex gap-1 mb-6 bg-slate-900 rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id ? "bg-zinc-800 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {tab.id !== "player" && <Lock size={12} strokeWidth={2} className="inline-block mr-1 opacity-60" />}
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3">{error}</div>}
      {success && <div className="mb-4 bg-green-900/30 border border-green-700 text-green-300 text-sm rounded-lg px-4 py-3">{success}</div>}
      {/* A rejection with no reason is indistinguishable from the scenario
          vanishing, so the reviewer's note is shown until the next submit. */}
      {reviewNote && currentStatus === "draft" && (
        <div className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{ background: "rgba(120,53,15,0.25)", border: "1px solid rgba(180,83,9,0.5)", color: "#fcd34d" }}>
          <p className="font-medium mb-1">審核未通過</p>
          <p className="text-[13px]" style={{ color: "#fde68a" }}>{reviewNote}</p>
        </div>
      )}
      {qualityFailures.length > 0 && (
        <div className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{ background: "rgba(120,53,15,0.25)", border: "1px solid rgba(180,83,9,0.5)", color: "#fcd34d" }}>
          <p className="mb-2 font-medium">送審前還差這些（都補齊後再按一次「送出審核」）：</p>
          <ul className="space-y-1 list-disc list-inside text-[13px]" style={{ color: "#fde68a" }}>
            {qualityFailures.map((f) => <li key={f.key}>{f.message}</li>)}
          </ul>
        </div>
      )}

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        {activeTab === "player" && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="標題 *">
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
              </Field>
              <Field label="類型 *">
                <select value={genre} onChange={(e) => setGenre(e.target.value)} className={inputCls}>
                  <option value="">選擇類型...</option>
                  {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="難度 *">
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)} className={inputCls}>
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{({ Story: "故事", Normal: "普通", Hard: "困難", Nightmare: "噩夢" } as Record<string, string>)[d] ?? d}</option>)}
                </select>
              </Field>
              <Field label="最多玩家（1–6）">
                <input type="number" value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} min={1} max={6} className={inputCls} />
              </Field>
              <Field label="預計時長（分鐘）">
                <input type="number" value={estimatedPlayTime} onChange={(e) => setEstimatedPlayTime(e.target.value)} placeholder="例：60" className={inputCls} />
              </Field>
            </div>
            <Field label="描述 *">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={taCls} />
            </Field>
            <Field label="目標 *">
              <textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} className={taCls} />
            </Field>
            <Field label="標籤（逗號分隔）">
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="地城, 單人友好, 黑暗" className={inputCls} />
            </Field>
            <Field label="封面圖片" hint="上傳一張圖片作為劇本封面，顯示在劇本庫中。建議比例 16:9，暗色系氛圍圖效果最佳。">
              <CoverImageUpload value={coverImageUrl} onChange={setCoverImageUrl} />
            </Field>
            <Field label="劇本語言" hint="AI 主持人將以此語言進行遊戲敘述。">
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className={inputCls}>
                <option value="zh-TW">繁體中文</option>
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
              </select>
            </Field>
          </div>
        )}

        {activeTab === "world" && (
          <div className="flex flex-col gap-4">
            {gmBanner}
            <Field label="開場場景" hint="AI 主持人將以此作為遊戲的第一個場景進行敘述。">
              <textarea value={openingScene} onChange={(e) => setOpeningScene(e.target.value)} rows={5} className={taCls} />
            </Field>
            <Field label="完整故事原文 / Full Story" hint="AI 主持人遊玩時可參考的完整故事原文。建議 8,000–15,000 字元以內。保留它能讓主持人掌握全貌，而非僅看摘要。可手動編輯或貼上。">
              <textarea value={sourceDocument} onChange={(e) => setSourceDocument(e.target.value)} rows={6} className={taCls} />
              {sourceDocument && (
                <p className="text-xs text-slate-500 mt-1">目前長度：{sourceDocument.length.toLocaleString()} 字元</p>
              )}
            </Field>
            <Field label="目標（Objective Tracker）" hint="劇情中可判定「完成 / 未完成」的具體目標。系統會逐一追蹤完成狀態，並供「多重結局」與「地點解鎖」以此作為條件。故事的結束由結局系統決定——若未自訂任何結局，系統會在所有必要目標達成時自動以勝利結束。">
              <ScenarioObjectivesEditor objectives={objectives} onChange={setObjectives} />
            </Field>
            <div className="flex flex-col gap-3">
              <Field label="失敗提示（敘事用）" hint="提醒 AI 主持人哪些發展屬於不利／失敗走向——每行一項。僅作為敘事引導，不會自動結束遊戲；若要在特定情況自動以失敗結束，請改用下方「多重結局」設定失敗結局。">
                <textarea value={failureConditions} onChange={(e) => setFailureConditions(e.target.value)} rows={3}
                  placeholder={"聖石被敵人奪走\n神廟在隊伍逃出前坍塌"}
                  className={taCls} />
              </Field>
              <Field label="回合上限" hint="達到此回合數時自動以失敗結束遊戲（確定性判定，無需 AI）。留空表示無上限。">
                <input type="number" value={failureTurnLimit} onChange={(e) => setFailureTurnLimit(e.target.value)}
                  placeholder="例：20" min={1} className={inputCls} />
              </Field>
            </div>
          </div>
        )}

        {activeTab === "gm" && (
          <div className="flex flex-col gap-4">
            {gmBanner}
            <Field label="補充主持人備注">
              <textarea value={gmNotes} onChange={(e) => setGmNotes(e.target.value)} rows={4} className={taCls} />
            </Field>

            <Field label="克蘇魯知識獎勵（官方劇本用；勝利結局首次通關時發給該調查員卡，上限 40；留空 = 不發）">
              <input
                type="number" min={0} max={40}
                value={mythosKnowledgeReward}
                onChange={(e) => setMythosKnowledgeReward(e.target.value)}
                placeholder="例：10"
                className={taCls}
              />
            </Field>

            {/* NPCs */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">NPC</label>
              <NpcRosterEditor
                npcs={npcs}
                onChange={setNpcs}
                makeEmpty={emptyNpc}
                itemOptions={locNodes.flatMap((n) => n.evidence ?? []).filter((e) => e.id).map((e) => ({ id: e.id, name: e.name }))}
                objectiveOptions={objectiveOptions(objectives)}
                nodeOptions={locNodes.filter((n) => n.id).map((n) => ({ id: n.id, name: n.name }))}
                tagOptions={Array.from(new Set(locNodes.flatMap((n) => n.evidence ?? []).flatMap((e) => e.tags ?? []))).filter(Boolean)}
              />
            </div>

            {/* Location unlock graph */}
            <div>
              <label className="flex items-center gap-1.5 text-sm text-slate-400 mb-1"><Map size={14} strokeWidth={2} /> 地點系統（選填）</label>
              <p className="text-xs text-slate-500 mb-2">設定遊戲中的地點、線索證物、解鎖條件與 NPC 出沒。搜索成功時可向玩家揭示圖片／文字。留空則由 AI 主持人依故事自由處理場景。</p>
              <LocationGraphEditor
                nodes={locNodes}
                onChange={setLocNodes}
                containers={locContainers}
                onContainersChange={setLocContainers}
                edges={locEdges}
                onEdgesChange={setLocEdges}
                travelMode={locTravelMode}
                onTravelModeChange={setLocTravelMode}
                npcPlacements={locNpcPlacements}
                onNpcPlacementsChange={setLocNpcPlacements}
                npcEncounters={locNpcEncounters}
                onNpcEncountersChange={setLocNpcEncounters}
                npcOptions={npcs.filter((n) => n.name).map((n) => ({ id: n.id, name: n.name }))}
                objectiveOptions={objectiveOptions(objectives)}
              />
            </div>

            {/* Multi-endings */}
            <div>
              <label className="flex items-center gap-1.5 text-sm text-slate-400 mb-2"><Theater size={14} strokeWidth={2} /> 多重結局（選填）</label>
              <EndingsEditor
                endings={endings}
                onChange={setEndings}
                npcOptions={npcs.filter((n) => n.name).map((n) => ({ id: n.id, name: n.name }))}
                nodeOptions={locNodes.filter((n) => n.id).map((n) => ({ id: n.id, name: n.name }))}
                itemOptions={locNodes.flatMap((n) => n.evidence ?? []).filter((e) => e.id).map((e) => ({ id: e.id, name: e.name }))}
                tagOptions={Array.from(new Set(locNodes.flatMap((n) => n.evidence ?? []).flatMap((e) => e.tags ?? []))).filter(Boolean)}
                objectiveOptions={objectiveOptions(objectives)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-3 mt-6">
        <button onClick={() => handleSave("draft")} disabled={saving}
          className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium">
          {saving ? "儲存中..." : "儲存為草稿"}
        </button>
        <button onClick={() => handleSave("draft", true)} disabled={saving || currentStatus === "pending"}
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium">
          {saving ? "處理中..." : currentStatus === "published" ? "更新並保持發佈" : currentStatus === "pending" ? "審核中…" : "送出審核"}
        </button>
      </div>
    </div>
  );
}
