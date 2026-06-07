"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { LocationEntry, NpcEntry } from "@/lib/ai/gm";

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
const numCls = "w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-center text-sm focus:outline-none focus:border-purple-500";

function emptyLocation(): LocationEntry { return { name: "", clues: "", items: "" }; }
function emptyNpc(): NpcEntry {
  return { name: "", hp: 10, mp: 5, str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50, personality: "", goal: "" };
}
function isLocationEntry(x: unknown): x is LocationEntry {
  return typeof x === "object" && x !== null && typeof (x as any).name === "string";
}
function isNpcEntry(x: unknown): x is NpcEntry {
  return typeof x === "object" && x !== null && typeof (x as any).name === "string" && typeof (x as any).hp === "number";
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
  const [language, setLanguage] = useState("zh-TW");
  const [currentStatus, setCurrentStatus] = useState<Status>("draft");

  // Tab 2
  const [openingScene, setOpeningScene] = useState("");
  const [sourceDocument, setSourceDocument] = useState("");
  const [winningTargets, setWinningTargets] = useState("");
  const [eachPlayerTargets, setEachPlayerTargets] = useState("");
  const [failureConditions, setFailureConditions] = useState("");
  const [failureTurnLimit, setFailureTurnLimit] = useState("");

  // Tab 3
  const [locations, setLocations] = useState<LocationEntry[]>([]);
  const [npcs, setNpcs] = useState<NpcEntry[]>([]);
  const [gmNotes, setGmNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data } = await supabase.from("scenarios").select("*").eq("id", params.id).eq("creator_id", user.id).single();
      if (!data) { setNotFound(true); setLoading(false); return; }

      setTitle(data.title ?? "");
      setGenre(data.genre ?? "");
      setDifficulty((data.difficulty as Difficulty) ?? "Normal");
      setDescription(data.description ?? "");
      setObjective(data.objective ?? "");
      setMaxPlayers(data.max_players ?? 4);
      setEstimatedPlayTime(data.estimated_play_time ? String(data.estimated_play_time) : "");
      setTags(Array.isArray(data.tags) ? data.tags.join(", ") : "");
      setLanguage(data.language ?? "zh-TW");
      setCurrentStatus(data.status ?? "draft");
      setOpeningScene(data.opening_scene ?? "");
      setSourceDocument(data.source_document ?? "");
      setWinningTargets(data.winning_targets ?? "");
      setEachPlayerTargets(data.each_player_targets ?? "");
      setFailureConditions(data.failure_conditions ?? "");
      setFailureTurnLimit(data.failure_turn_limit != null ? String(data.failure_turn_limit) : "");
      setGmNotes(data.gm_notes ?? "");
      // Load structured data — fall back to empty if old string-array shape
      setLocations(Array.isArray(data.locations) ? data.locations.filter(isLocationEntry) : []);
      setNpcs(Array.isArray(data.npcs) ? data.npcs.filter(isNpcEntry) : []);
      setLoading(false);
    }
    load();
  }, [params.id, router]);

  async function handleSave(status: Status) {
    if (!title.trim()) { setActiveTab("player"); setError("標題為必填欄位。"); return; }
    if (!genre) { setActiveTab("player"); setError("類型為必填欄位。"); return; }
    if (!description.trim()) { setActiveTab("player"); setError("描述為必填欄位。"); return; }
    if (!objective.trim()) { setActiveTab("player"); setError("目標為必填欄位。"); return; }
    const mp = Number(maxPlayers);
    if (mp < 1 || mp > 6) { setActiveTab("player"); setError("玩家人數必須介於 1 至 6 之間。"); return; }
    setSaving(true); setError(null); setSuccess(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    const { error: updateError } = await supabase
      .from("scenarios")
      .update({
        title: title.trim(), genre, difficulty,
        description: description.trim(),
        objective: objective.trim(),
        max_players: mp,
        estimated_play_time: estimatedPlayTime ? parseInt(estimatedPlayTime) : null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        opening_scene: openingScene.trim() || null,
        source_document: sourceDocument.trim() || null,
        locations,
        npcs,
        winning_targets: winningTargets.trim() || null,
        each_player_targets: eachPlayerTargets.trim() || null,
        failure_conditions: failureConditions.trim() || null,
        failure_turn_limit: failureTurnLimit ? parseInt(failureTurnLimit) : null,
        gm_notes: gmNotes.trim() || null,
        language, status,
      })
      .eq("id", params.id)
      .eq("creator_id", user.id);
    setSaving(false);
    if (updateError) { setError(updateError.message); return; }
    setSuccess(status === "published" ? "劇本已發佈！" : "已儲存為草稿。");
    setCurrentStatus(status);
    setTimeout(() => router.push("/dashboard"), 900);
  }

  function updateLocation(i: number, patch: Partial<LocationEntry>) {
    setLocations((prev) => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }
  function removeLocation(i: number) { setLocations((prev) => prev.filter((_, idx) => idx !== i)); }
  function updateNpc(i: number, patch: Partial<NpcEntry>) {
    setNpcs((prev) => prev.map((n, idx) => idx === i ? { ...n, ...patch } : n));
  }
  function removeNpc(i: number) { setNpcs((prev) => prev.filter((_, idx) => idx !== i)); }

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><p className="text-slate-500">載入劇本中...</p></div>;
  if (notFound) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <p className="text-slate-400">找不到劇本或你沒有編輯權限。</p>
      <button onClick={() => router.push("/dashboard")} className="text-purple-400 hover:text-purple-300 text-sm">← 返回後台</button>
    </div>
  );

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

  const statKeys: (keyof NpcEntry)[] = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"];
  const statZh: Record<string, string> = { str:"力量", con:"體質", siz:"體型", dex:"敏捷", app:"外貌", int:"智力", pow:"意志", edu:"教育", luck:"幸運" };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">編輯劇本</h1>
          <p className="text-slate-400 mt-1">狀態：<span className={currentStatus === "published" ? "text-green-400" : "text-slate-400"}>{currentStatus === "published" ? "已發佈" : "草稿"}</span></p>
        </div>
        <button onClick={() => router.push("/dashboard")} className="text-slate-400 hover:text-white text-sm">← 返回後台</button>
      </div>

      <div className="flex gap-1 mb-6 bg-slate-900 rounded-lg p-1">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === tab.id ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"}`}>
            {tab.id !== "player" && <span className="mr-1 opacity-60">🔒</span>}
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3">{error}</div>}
      {success && <div className="mb-4 bg-green-900/30 border border-green-700 text-green-300 text-sm rounded-lg px-4 py-3">{success}</div>}

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">

        {/* ── Tab 1 ── */}
        {activeTab === "player" && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="標題 *"><input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} /></Field>
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
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{({ Story:"故事", Normal:"普通", Hard:"困難", Nightmare:"噩夢" } as Record<string,string>)[d] ?? d}</option>)}
                </select>
              </Field>
              <Field label="最多玩家（1–6）"><input type="number" value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} min={1} max={6} className={inputCls} /></Field>
              <Field label="預計時長（分鐘）"><input type="number" value={estimatedPlayTime} onChange={(e) => setEstimatedPlayTime(e.target.value)} placeholder="例：60" className={inputCls} /></Field>
            </div>
            <Field label="描述 *"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={taCls} /></Field>
            <Field label="目標 *"><textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} className={taCls} /></Field>
            <Field label="標籤（逗號分隔）"><input value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls} /></Field>
            <Field label="劇本語言">
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

        {/* ── Tab 2 ── */}
        {activeTab === "world" && (
          <div className="flex flex-col gap-4">
            {gmBanner}
            <Field label="開場場景"><textarea value={openingScene} onChange={(e) => setOpeningScene(e.target.value)} rows={5} className={taCls} /></Field>
            <Field label="完整故事原文" hint="建議 8,000–15,000 字元以內。">
              <textarea value={sourceDocument} onChange={(e) => setSourceDocument(e.target.value)} rows={8} className={taCls} />
              {sourceDocument && <p className="text-xs text-slate-500 mt-1">目前長度：{sourceDocument.length.toLocaleString()} 字元{sourceDocument.length > 15000 ? "（較長，首次遊玩的 token 成本會偏高）" : ""}</p>}
            </Field>
            <Field label="通關條件（任一名玩家完成即可）" hint="每行一項。任何一人完成即算達成。">
              <textarea value={winningTargets} onChange={(e) => setWinningTargets(e.target.value)} rows={4} className={taCls} />
            </Field>
            <Field label="每名存活玩家必須完成" hint="每行一項。所有人個別達成。">
              <textarea value={eachPlayerTargets} onChange={(e) => setEachPlayerTargets(e.target.value)} rows={3} className={taCls} />
            </Field>
            <div className="space-y-3">
              <Field label="失敗條件" hint="兩者同時生效。"><textarea value={failureConditions} onChange={(e) => setFailureConditions(e.target.value)} rows={3} className={taCls} /></Field>
              <Field label="回合上限" hint="達到此回合數時自動判定失敗。留空則不限制。">
                <input type="number" value={failureTurnLimit} onChange={(e) => setFailureTurnLimit(e.target.value)} placeholder="例：20" min={1} className={`${inputCls} max-w-[160px]`} />
              </Field>
            </div>
          </div>
        )}

        {/* ── Tab 3 ── */}
        {activeTab === "gm" && (
          <div className="flex flex-col gap-6">
            {gmBanner}

            {/* Locations */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm text-slate-400 font-medium">關鍵地點</p>
                  <p className="text-xs text-slate-500">每個地點包含其線索與物品。</p>
                </div>
                <button onClick={() => setLocations((p) => [...p, emptyLocation()])} className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg">+ 新增地點</button>
              </div>
              {locations.length === 0 && <p className="text-slate-600 text-xs text-center py-4 border border-dashed border-slate-700 rounded-lg">尚未新增地點</p>}
              <div className="space-y-3">
                {locations.map((loc, i) => (
                  <div key={i} className="bg-slate-900/60 border border-slate-700 rounded-xl p-4 relative">
                    <button onClick={() => removeLocation(i)} className="absolute top-3 right-3 text-slate-600 hover:text-red-400 text-lg leading-none">×</button>
                    <p className="text-xs text-slate-500 mb-3">地點 {i + 1}</p>
                    <div className="flex flex-col gap-3">
                      <Field label="地點名稱"><input value={loc.name} onChange={(e) => updateLocation(i, { name: e.target.value })} placeholder="例：入口大廳" className={inputCls} /></Field>
                      <Field label="線索" hint="此地點可被調查發現的線索或資訊"><textarea value={loc.clues} onChange={(e) => updateLocation(i, { clues: e.target.value })} rows={2} placeholder="血跡指向北方密門；牆上有奇怪抓痕" className={taCls} /></Field>
                      <Field label="物品" hint="此地點可找到的物品"><textarea value={loc.items} onChange={(e) => updateLocation(i, { items: e.target.value })} rows={2} placeholder="生鏽鑰匙、半張地圖" className={taCls} /></Field>
                    </div>
                  </div>
                ))}
              </div>
              {locations.length > 0 && <button onClick={() => setLocations((p) => [...p, emptyLocation()])} className="mt-2 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg">+ 新增地點</button>}
            </div>

            {/* NPCs */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm text-slate-400 font-medium">NPC</p>
                  <p className="text-xs text-slate-500">填入數值後，系統會直接用於傷害計算，不再由 AI 估算。</p>
                </div>
                <button onClick={() => setNpcs((p) => [...p, emptyNpc()])} className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg">+ 新增 NPC</button>
              </div>
              {npcs.length === 0 && <p className="text-slate-600 text-xs text-center py-4 border border-dashed border-slate-700 rounded-lg">尚未新增 NPC</p>}
              <div className="space-y-3">
                {npcs.map((npc, i) => (
                  <div key={i} className="bg-slate-900/60 border border-slate-700 rounded-xl p-4 relative">
                    <button onClick={() => removeNpc(i)} className="absolute top-3 right-3 text-slate-600 hover:text-red-400 text-lg leading-none">×</button>
                    <p className="text-xs text-slate-500 mb-3">NPC {i + 1}</p>
                    <div className="flex flex-col gap-3">
                      <Field label="姓名"><input value={npc.name} onChange={(e) => updateNpc(i, { name: e.target.value })} placeholder="例：守衛隊長" className={inputCls} /></Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="生命 HP *"><input type="number" value={npc.hp} min={1} max={999} onChange={(e) => updateNpc(i, { hp: Math.max(1, parseInt(e.target.value) || 1) })} className={numCls} /></Field>
                        <Field label="魔力 MP"><input type="number" value={npc.mp} min={0} max={99} onChange={(e) => updateNpc(i, { mp: Math.max(0, parseInt(e.target.value) || 0) })} className={numCls} /></Field>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 mb-1.5">基礎數值（CoC ×5 體系）</p>
                        <div className="grid grid-cols-3 gap-2">
                          {statKeys.map((k) => (
                            <div key={k}>
                              <label className="block text-xs text-slate-500 mb-0.5 text-center">{statZh[k]}</label>
                              <input type="number" value={npc[k] as number} min={1} max={99} onChange={(e) => updateNpc(i, { [k]: Math.max(1, Math.min(99, parseInt(e.target.value) || 1)) } as Partial<NpcEntry>)} className={numCls} />
                            </div>
                          ))}
                        </div>
                      </div>
                      <Field label="性格" hint="個性、說話方式、行為習慣"><textarea value={npc.personality} onChange={(e) => updateNpc(i, { personality: e.target.value })} rows={2} placeholder="冷酷、話不多，對外人充滿戒心" className={taCls} /></Field>
                      <Field label="目標 / 動機" hint="他們想要什麼？在意什麼？隱藏著什麼秘密？"><textarea value={npc.goal} onChange={(e) => updateNpc(i, { goal: e.target.value })} rows={2} placeholder="保護神廟不受外人入侵" className={taCls} /></Field>
                    </div>
                  </div>
                ))}
              </div>
              {npcs.length > 0 && <button onClick={() => setNpcs((p) => [...p, emptyNpc()])} className="mt-2 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg">+ 新增 NPC</button>}
            </div>

            <Field label="主持人補充備注"><textarea value={gmNotes} onChange={(e) => setGmNotes(e.target.value)} rows={4} className={taCls} /></Field>
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
