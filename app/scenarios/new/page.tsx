"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ImportedScenario } from "@/lib/ai/import-scenario";
import type { LocationEntry, NpcEntry } from "@/lib/ai/gm";
import { CoverImageUpload } from "@/components/CoverImageUpload";

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

const inputCls = "w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500";
const taCls = `${inputCls} resize-none`;

function emptyLocation(): LocationEntry { return { name: "", clues: "", items: "" }; }
function emptyNpc(): NpcEntry {
  return { name: "", hp: 10, mp: 5, str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50, personality: "", goal: "" };
}

export default function NewScenarioPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("player");

  // Player-facing
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("Normal");
  const [description, setDescription] = useState("");
  const [objective, setObjective] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [estimatedPlayTime, setEstimatedPlayTime] = useState("");
  const [tags, setTags] = useState("");

  // GM-only: World & Story
  const [openingScene, setOpeningScene] = useState("");
  const [sourceDocument, setSourceDocument] = useState("");
  const [winningTargets, setWinningTargets] = useState("");
  const [eachPlayerTargets, setEachPlayerTargets] = useState("");
  const [failureConditions, setFailureConditions] = useState("");
  const [failureTurnLimit, setFailureTurnLimit] = useState("");

  const [coverImageUrl, setCoverImageUrl] = useState("");

  // GM-only: GM Toolkit
  const [endingConditions, setEndingConditions] = useState("");
  const [gmNotes, setGmNotes] = useState("");
  const [locations, setLocations] = useState<LocationEntry[]>([]);
  const [npcs, setNpcs] = useState<NpcEntry[]>([]);

  const [language, setLanguage] = useState("zh-TW");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // AI Import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);

  function applyImport(d: ImportedScenario) {
    setTitle(d.title ?? "");
    setGenre(d.genre ?? "");
    setDifficulty((d.difficulty as Difficulty) ?? "Normal");
    setDescription(d.description ?? "");
    setObjective(d.objective ?? "");
    setMaxPlayers(d.max_players ?? 4);
    setEstimatedPlayTime(d.estimated_play_time ? String(d.estimated_play_time) : "");
    setTags((d.tags ?? []).join(", "));
    setOpeningScene(d.opening_scene ?? "");
    setLocations(d.locations ?? []);
    setNpcs(d.npcs ?? []);
    setWinningTargets(d.winning_targets ?? "");
    setEachPlayerTargets(d.each_player_targets ?? "");
    setFailureConditions(d.failure_conditions ?? "");
    setFailureTurnLimit(d.failure_turn_limit != null ? String(d.failure_turn_limit) : "");
    setEndingConditions(d.ending_conditions ?? "");
    setGmNotes(d.gm_notes ?? "");
    if (d.language) setLanguage(d.language);
    setActiveTab("player");
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImportError(null);
    setImportNote(null);
    setSuccess(null);
    setError(null);

    if (file.size > 2 * 1024 * 1024) {
      setImportError("File too large. Maximum size is 2MB.");
      return;
    }

    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/scenarios/import", { method: "POST", body: fd });

      const ct = res.headers.get("content-type") ?? "";
      const isJson = ct.includes("application/json");
      const json = isJson ? await res.json().catch(() => null) : null;

      if (!res.ok || !json) {
        if (res.status === 504 || res.status === 408 || (!json && res.status >= 500)) {
          setImportError("匯入逾時：文件太長，AI 分析超過伺服器時間上限。請縮短文件、分段匯入，或稍後再試。");
        } else {
          setImportError(json?.error ?? `匯入失敗（HTTP ${res.status}）。請稍後再試或改用手動填寫。`);
        }
        return;
      }

      applyImport(json.scenario as ImportedScenario);
      if (typeof json.sourceDocument === "string") setSourceDocument(json.sourceDocument);
      setImportNote(
        `已從「${file.name}」匯入。AI 已預填以下欄位 — 請逐一檢閱並編輯，然後選擇儲存為草稿或發佈。` +
          (json.truncated ? "（文件過長，僅分析了前段內容。）" : "")
      );
    } catch (e: any) {
      const msg = e?.message ?? "";
      setImportError(
        msg.includes("fetch") || msg === "" || msg.includes("Failed to fetch") || msg.includes("network")
          ? "匯入逾時或網路錯誤。文件過長時分析需較多時間，請再試一次或縮短文件。"
          : `匯入失敗：${msg}`
      );
    } finally {
      setImporting(false);
    }
  }

  async function handleSave(status: Status) {
    if (!title.trim()) { setActiveTab("player"); setError("標題為必填項目。"); return; }
    if (!genre) { setActiveTab("player"); setError("類型為必填項目。"); return; }
    if (!difficulty) { setActiveTab("player"); setError("難度為必填項目。"); return; }
    if (!description.trim()) { setActiveTab("player"); setError("描述為必填項目。"); return; }
    if (!objective.trim()) { setActiveTab("player"); setError("目標為必填項目。"); return; }
    const mp = Number(maxPlayers);
    if (mp < 1 || mp > 6) { setActiveTab("player"); setError("玩家人數必須在 1 至 6 之間。"); return; }

    setSaving(true);
    setError(null);
    setSuccess(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    const ept = estimatedPlayTime ? parseInt(estimatedPlayTime) : null;

    const { data, error: insertError } = await supabase
      .from("scenarios")
      .insert({
        creator_id: user.id,
        title: title.trim(),
        genre,
        difficulty,
        description: description.trim(),
        objective: objective.trim(),
        max_players: mp,
        estimated_play_time: ept || null,
        tags: tagList,
        opening_scene: openingScene.trim() || null,
        locations,
        npcs,
        winning_targets: winningTargets.trim() || null,
        each_player_targets: eachPlayerTargets.trim() || null,
        failure_conditions: failureConditions.trim() || null,
        failure_turn_limit: failureTurnLimit ? parseInt(failureTurnLimit) : null,
        ending_conditions: endingConditions.trim() || null,
        gm_notes: gmNotes.trim() || null,
        source_document: sourceDocument.trim() || null,
        cover_image_url: coverImageUrl.trim() || null,
        language,
        status,
      })
      .select("id")
      .single();

    setSaving(false);
    if (insertError || !data) { setError(insertError?.message ?? "Failed to save"); return; }
    setSuccess(status === "published" ? "劇本已發佈！" : "已儲存為草稿。");
    setTimeout(() => router.push("/dashboard"), 900);
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
      <h1 className="text-3xl font-bold text-white mb-2">建立劇本</h1>
      <p className="text-slate-400 mb-6">建立新的 TRPG 冒險 — 手動填寫表格，或匯入故事文件快速預填。</p>

      {/* AI Import */}
      <div className="bg-gradient-to-r from-zinc-800/40 to-slate-800/30 border border-zinc-700/50 rounded-xl p-5 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <span>✨</span> 從故事文件匯入
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              上傳 <span className="text-slate-300">.txt</span>、<span className="text-slate-300">.md</span> 或{" "}
              <span className="text-slate-300">.docx</span>（最大 2MB）。AI 讀取後自動預填表格。
              不會自動儲存或發佈 — 你需逐一確認所有內容。
            </p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-medium whitespace-nowrap"
          >
            {importing ? "分析中..." : "上傳文件"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.markdown,.docx"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
        {importing && (
          <p className="text-white text-xs mt-3">正在讀取文件並詢問 AI，這可能需要幾秒鐘。</p>
        )}
        {importError && (
          <div className="mt-3 bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-3 py-2">{importError}</div>
        )}
        {importNote && (
          <div className="mt-3 bg-green-900/30 border border-green-700 text-green-300 text-sm rounded-lg px-3 py-2">{importNote}</div>
        )}
      </div>

      <div className="flex gap-1 mb-6 bg-slate-900 rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id ? "bg-zinc-800 text-white" : "text-slate-400 hover:text-white"
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
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：失落的神廟" className={inputCls} />
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
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{{ Story: "故事", Normal: "普通", Hard: "困難", Nightmare: "噩夢" }[d] ?? d}</option>)}
                </select>
              </Field>
              <Field label="最多玩家（1–6）">
                <input type="number" value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} min={1} max={6} className={inputCls} />
              </Field>
              <Field label="預計遊玩時間（分鐘）">
                <input type="number" value={estimatedPlayTime} onChange={(e) => setEstimatedPlayTime(e.target.value)} placeholder="例：60" className={inputCls} />
              </Field>
            </div>
            <Field label="描述 *" hint="顯示給玩家的簡短說明。">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="這是什麼樣的冒險？" className={taCls} />
            </Field>
            <Field label="目標 *" hint="玩家需完成什麼才能獲勝？">
              <textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} placeholder="在黎明前抵達內室並取回碎片。" className={taCls} />
            </Field>
            <Field label="標籤（逗號分隔）" hint="幫助玩家找到你的劇本。例：地下城、可單人、黑暗">
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="地下城, 可單人, 黑暗, 調查" className={inputCls} />
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
            <Field label="開場場景" hint="AI 主持人將以此作為第一幕的敘述基礎，請生動地設定氛圍。">
              <textarea value={openingScene} onChange={(e) => setOpeningScene(e.target.value)} rows={5}
                placeholder="夜幕低垂，一行人來到了佈滿苔蘚的古老神廟腳下。火把的光芒在雕刻的石臉上搖曳..."
                className={taCls} />
            </Field>
            <Field label="完整故事原文 / Full Story" hint="AI 主持人遊玩時可參考的完整故事原文（匯入時自動填入）。建議 8,000–15,000 字元以內。保留它能讓主持人掌握全貌，而非僅看摘要。可手動編輯或貼上。">
              <textarea value={sourceDocument} onChange={(e) => setSourceDocument(e.target.value)} rows={6}
                placeholder="匯入故事文件後，完整原文會顯示於此。也可直接貼上整篇故事。"
                className={taCls} />
              {sourceDocument && (
                <p className="text-xs text-slate-500 mt-1">目前長度：{sourceDocument.length.toLocaleString()} 字元</p>
              )}
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
            <div className="flex flex-col gap-3">
              <Field label="失敗條件（文字）" hint="一旦發生即判定遊戲失敗的事件——每行一項。系統每回合檢查，若觸發則以失敗結局結束遊戲。">
                <textarea value={failureConditions} onChange={(e) => setFailureConditions(e.target.value)} rows={3}
                  placeholder={"聖石被敵人奪走\n神廟在隊伍逃出前坍塌"}
                  className={taCls} />
              </Field>
              <Field label="回合上限" hint="達到此回合數時自動判定失敗。與文字條件同時生效。">
                <input type="number" value={failureTurnLimit} onChange={(e) => setFailureTurnLimit(e.target.value)}
                  placeholder="例：20" min={1} className={inputCls} />
              </Field>
            </div>
          </div>
        )}

        {activeTab === "gm" && (
          <div className="flex flex-col gap-4">
            {gmBanner}
            <Field label="主持人補充備注" hint="其他背景資訊、氛圍說明或 AI 主持人的特殊指示。">
              <textarea value={gmNotes} onChange={(e) => setGmNotes(e.target.value)} rows={4}
                placeholder="獎勵有創意的解決方案。若玩家提早找到隱藏通道，可直接推進至最終對決。盡可能引用角色背景..."
                className={taCls} />
            </Field>

            {/* Locations */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">關鍵地點</label>
              <div className="flex flex-col gap-3">
                {locations.map((loc, i) => (
                  <div key={i} className="relative border border-slate-600 rounded-lg p-4 bg-slate-900/50">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-slate-400 font-medium">地點 {i + 1}</span>
                      <button type="button" onClick={() => setLocations(locations.filter((_, j) => j !== i))}
                        className="text-slate-500 hover:text-red-400 text-sm">×</button>
                    </div>
                    <div className="flex flex-col gap-2">
                      <input value={loc.name} onChange={(e) => {
                        const next = [...locations]; next[i] = { ...next[i], name: e.target.value }; setLocations(next);
                      }} placeholder="地點名稱" className={inputCls} />
                      <textarea value={loc.clues} onChange={(e) => {
                        const next = [...locations]; next[i] = { ...next[i], clues: e.target.value }; setLocations(next);
                      }} rows={2} placeholder="此地點可被發現的線索或資訊" className={taCls} />
                      <textarea value={loc.items} onChange={(e) => {
                        const next = [...locations]; next[i] = { ...next[i], items: e.target.value }; setLocations(next);
                      }} rows={2} placeholder="此地點可找到的物品" className={taCls} />
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setLocations([...locations, emptyLocation()])}
                  className="text-sm text-zinc-100 hover:text-white border border-dashed border-slate-600 hover:border-zinc-400 rounded-lg py-2 transition-colors">
                  + 新增地點
                </button>
              </div>
            </div>

            {/* NPCs */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">NPC</label>
              <div className="flex flex-col gap-3">
                {npcs.map((npc, i) => (
                  <div key={i} className="relative border border-slate-600 rounded-lg p-4 bg-slate-900/50">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-slate-400 font-medium">NPC {i + 1}</span>
                      <button type="button" onClick={() => setNpcs(npcs.filter((_, j) => j !== i))}
                        className="text-slate-500 hover:text-red-400 text-sm">×</button>
                    </div>
                    <div className="flex flex-col gap-2">
                      <input value={npc.name} onChange={(e) => {
                        const next = [...npcs]; next[i] = { ...next[i], name: e.target.value }; setNpcs(next);
                      }} placeholder="姓名" className={inputCls} />
                      <div className="grid grid-cols-3 gap-2">
                        {(["hp","mp","str","con","siz","dex","app","int","pow","edu","luck"] as (keyof NpcEntry)[]).map((stat) => (
                          <div key={stat} className="flex flex-col gap-1">
                            <label className="text-xs text-slate-500 uppercase">{stat}</label>
                            <input type="number" value={npc[stat] as number}
                              onChange={(e) => {
                                const next = [...npcs]; next[i] = { ...next[i], [stat]: Number(e.target.value) }; setNpcs(next);
                              }}
                              min={stat === "mp" ? 0 : 1} max={99}
                              className={inputCls} />
                          </div>
                        ))}
                      </div>
                      <textarea value={npc.personality} onChange={(e) => {
                        const next = [...npcs]; next[i] = { ...next[i], personality: e.target.value }; setNpcs(next);
                      }} rows={2} placeholder="個性、說話方式、行為習慣" className={taCls} />
                      <textarea value={npc.goal} onChange={(e) => {
                        const next = [...npcs]; next[i] = { ...next[i], goal: e.target.value }; setNpcs(next);
                      }} rows={2} placeholder="他們想要什麼？在意什麼？隱藏著什麼秘密？" className={taCls} />
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setNpcs([...npcs, emptyNpc()])}
                  className="text-sm text-zinc-100 hover:text-white border border-dashed border-slate-600 hover:border-zinc-400 rounded-lg py-2 transition-colors">
                  + 新增 NPC
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-3 mt-6">
        <button onClick={() => handleSave("draft")} disabled={saving}
          className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium">
          {saving ? "儲存中..." : "儲存為草稿"}
        </button>
        <button onClick={() => handleSave("published")} disabled={saving}
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium">
          {saving ? "發佈中..." : "發佈"}
        </button>
      </div>
    </div>
  );
}
