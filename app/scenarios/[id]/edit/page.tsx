"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const GENRES = ["Fantasy", "Cyberpunk", "Horror", "Sci-Fi", "Mystery", "Historical", "Other"];
const DIFFICULTIES = ["Story", "Normal", "Hard", "Nightmare"] as const;
type Difficulty = typeof DIFFICULTIES[number];
type Tab = "player" | "world" | "gm";
type Status = "draft" | "published";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-slate-400 mb-1">{label}</label>
      {hint && <p className="text-xs text-slate-500 mb-2">{hint}</p>}
      {children}
    </div>
  );
}

const inputCls = "w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500";
const taCls = `${inputCls} resize-none`;

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
  const [background, setBackground] = useState("");
  const [sceneFlow, setSceneFlow] = useState("");
  const [locations, setLocations] = useState("");
  const [npcs, setNpcs] = useState("");
  const [keyItems, setKeyItems] = useState("");
  const [winningTargets, setWinningTargets] = useState("");
  const [secretRules, setSecretRules] = useState("");
  const [clues, setClues] = useState("");
  const [threats, setThreats] = useState("");
  const [traps, setTraps] = useState("");
  const [eachPlayerTargets, setEachPlayerTargets] = useState("");
  const [failureConditions, setFailureConditions] = useState("");
  const [endingConditions, setEndingConditions] = useState("");
  const [gmNotes, setGmNotes] = useState("");
  const [sourceDocument, setSourceDocument] = useState("");
  const [currentStatus, setCurrentStatus] = useState<Status>("draft");
  const [language, setLanguage] = useState("zh-TW");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setBackground(data.background ?? "");
      setSceneFlow(data.scene_flow ?? "");
      setLocations(Array.isArray(data.locations) ? data.locations.join("\n") : "");
      setNpcs(Array.isArray(data.npcs) ? data.npcs.join("\n") : "");
      setKeyItems(Array.isArray(data.key_items) ? data.key_items.join("\n") : "");
      setSecretRules(data.secret_rules ?? "");
      setClues(Array.isArray(data.clues) ? data.clues.join("\n") : "");
      setThreats(Array.isArray(data.threats) ? data.threats.join("\n") : "");
      setTraps(Array.isArray(data.traps) ? data.traps.join("\n") : "");
      setWinningTargets(data.winning_targets ?? "");
      setEachPlayerTargets(data.each_player_targets ?? "");
      setFailureConditions(data.failure_conditions ?? "");
      setEndingConditions(data.ending_conditions ?? "");
      setGmNotes(data.gm_notes ?? "");
      setSourceDocument(data.source_document ?? "");
      setCurrentStatus(data.status ?? "draft");
      setLanguage(data.language ?? "zh-TW");
      setLoading(false);
    }
    load();
  }, [params.id, router]);

  function parseLines(text: string): string[] {
    return text.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  async function handleSave(status: Status) {
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
        background: background.trim() || null,
        scene_flow: sceneFlow.trim() || null,
        locations: parseLines(locations),
        npcs: parseLines(npcs),
        key_items: parseLines(keyItems),
        secret_rules: secretRules.trim() || null,
        clues: parseLines(clues),
        threats: parseLines(threats),
        traps: parseLines(traps),
        winning_targets: winningTargets.trim() || null,
        each_player_targets: eachPlayerTargets.trim() || null,
        failure_conditions: failureConditions.trim() || null,
        ending_conditions: endingConditions.trim() || null,
        gm_notes: gmNotes.trim() || null,
        source_document: sourceDocument.trim() || null,
        language,
        status,
      })
      .eq("id", params.id)
      .eq("creator_id", user.id);

    setSaving(false);
    if (updateError) { setError(updateError.message); return; }
    setSuccess(status === "published" ? "劇本已發佈！" : "已儲存為草稿。");
    setCurrentStatus(status);
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
        <button onClick={() => router.push("/dashboard")} className="text-purple-400 hover:text-purple-300 text-sm">
          ← 返回後台
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
            狀態：<span className={currentStatus === "published" ? "text-green-400" : "text-slate-400"}>{currentStatus === "published" ? "已發佈" : "草稿"}</span>
          </p>
        </div>
        <button onClick={() => router.push("/dashboard")} className="text-slate-400 hover:text-white text-sm">
          ← 返回後台
        </button>
      </div>

      <div className="flex gap-1 mb-6 bg-slate-900 rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {tab.id !== "player" && <span className="mr-1 opacity-60">🔒</span>}
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3">{error}</div>}
      {success && <div className="mb-4 bg-green-900/30 border border-green-700 text-green-300 text-sm rounded-lg px-4 py-3">{success}</div>}

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
            <Field label="世界背景" hint="AI 主持人需要了解的歷史、背景知識與情境。">
              <textarea value={background} onChange={(e) => setBackground(e.target.value)} rows={5} className={taCls} />
            </Field>
            <Field label="場景流程 / 劇情推進" hint="冒險的場景順序與推進邏輯 — 每一幕玩家會遇到什麼、需要做什麼、以及觸發下一幕的條件。這是 AI 主持人依循的主線。">
              <textarea value={sceneFlow} onChange={(e) => setSceneFlow(e.target.value)} rows={6} className={taCls} />
            </Field>
            <Field label="重要地點（每行一個）">
              <textarea value={locations} onChange={(e) => setLocations(e.target.value)} rows={4} className={taCls} />
            </Field>
            <Field label="NPC（每行一個）">
              <textarea value={npcs} onChange={(e) => setNpcs(e.target.value)} rows={4} className={taCls} />
            </Field>
            <Field label="重要道具（每行一個）">
              <textarea value={keyItems} onChange={(e) => setKeyItems(e.target.value)} rows={3} className={taCls} />
            </Field>
          </div>
        )}

        {activeTab === "gm" && (
          <div className="flex flex-col gap-4">
            {gmBanner}
            <Field label="隱藏規則" hint="給 AI 主持人的節奏、語氣與機制指示。">
              <textarea value={secretRules} onChange={(e) => setSecretRules(e.target.value)} rows={4} className={taCls} />
            </Field>
            <Field label="線索（每行一個）" hint="可被玩家調查發現的資訊 — 內容、在何處／如何取得、以及揭示或解鎖什麼。">
              <textarea value={clues} onChange={(e) => setClues(e.target.value)} rows={4} className={taCls} />
            </Field>
            <Field label="威脅與敵人（每行一個）">
              <textarea value={threats} onChange={(e) => setThreats(e.target.value)} rows={3} className={taCls} />
            </Field>
            <Field label="陷阱與危機（每行一個）">
              <textarea value={traps} onChange={(e) => setTraps(e.target.value)} rows={3} className={taCls} />
            </Field>
            <Field label="通關條件（任一名玩家完成即可）" hint="達成遊戲勝利的目標——每行一項。只要隊伍中任何一人完成即算達成。這是系統判定獲勝的主要依據。">
              <textarea value={winningTargets} onChange={(e) => setWinningTargets(e.target.value)} rows={4}
                placeholder={"取回聖石並帶出神廟\n消滅守門者"}
                className={taCls} />
            </Field>
            <Field label="每名存活玩家必須完成" hint="每一位存活玩家都必須各自完成的目標——每行一項。需要所有人個別達成，一人完成不算其他人完成。">
              <textarea value={eachPlayerTargets} onChange={(e) => setEachPlayerTargets(e.target.value)} rows={3}
                placeholder={"懺悔自己的罪行\n找到屬於自己的逃生符咒"}
                className={taCls} />
            </Field>
            <Field label="失敗條件" hint="一旦發生即判定遊戲失敗的事件——每行一項。系統每回合檢查，若觸發則以失敗結局結束遊戲。">
              <textarea value={failureConditions} onChange={(e) => setFailureConditions(e.target.value)} rows={3}
                placeholder={"聖石被敵人奪走\n神廟在隊伍逃出前坍塌"}
                className={taCls} />
            </Field>
            <Field label="補充主持人備注">
              <textarea value={gmNotes} onChange={(e) => setGmNotes(e.target.value)} rows={4} className={taCls} />
            </Field>
            <Field label="完整故事原文 / Full Story" hint="AI 主持人遊玩時可參考的完整故事原文。保留它能讓主持人掌握全貌，而非僅看摘要。可手動編輯或貼上。">
              <textarea value={sourceDocument} onChange={(e) => setSourceDocument(e.target.value)} rows={6} className={taCls} />
              {sourceDocument && (
                <p className="text-xs text-slate-500 mt-1">目前長度：{sourceDocument.length.toLocaleString()} 字元</p>
              )}
            </Field>
          </div>
        )}
      </div>

      <div className="flex gap-3 mt-6">
        <button onClick={() => handleSave("draft")} disabled={saving}
          className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium">
          {saving ? "儲存中..." : "儲存為草稿"}
        </button>
        <button onClick={() => handleSave("published")} disabled={saving}
          className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium">
          {saving ? "更新中..." : currentStatus === "published" ? "更新並保持發佈" : "發佈"}
        </button>
      </div>
    </div>
  );
}
