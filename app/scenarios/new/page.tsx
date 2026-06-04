"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ImportedScenario } from "@/lib/ai/import-scenario";

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
  const [background, setBackground] = useState("");
  const [sceneFlow, setSceneFlow] = useState("");
  const [locations, setLocations] = useState("");
  const [npcs, setNpcs] = useState("");
  const [keyItems, setKeyItems] = useState("");

  // GM-only: GM Toolkit
  const [secretRules, setSecretRules] = useState("");
  const [clues, setClues] = useState("");
  const [threats, setThreats] = useState("");
  const [traps, setTraps] = useState("");
  const [endingConditions, setEndingConditions] = useState("");
  const [gmNotes, setGmNotes] = useState("");

  const [language, setLanguage] = useState("zh-TW");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // AI Import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);

  function parseLines(text: string): string[] {
    return text.split("\n").map((l) => l.trim()).filter(Boolean);
  }

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
    setBackground(d.background ?? "");
    setSceneFlow(d.scene_flow ?? "");
    setLocations((d.locations ?? []).join("\n"));
    setNpcs((d.npcs ?? []).join("\n"));
    setKeyItems((d.key_items ?? []).join("\n"));
    setSecretRules(d.secret_rules ?? "");
    setClues((d.clues ?? []).join("\n"));
    setThreats((d.threats ?? []).join("\n"));
    setTraps((d.traps ?? []).join("\n"));
    setEndingConditions(d.ending_conditions ?? "");
    setGmNotes(d.gm_notes ?? "");
    if (d.language) setLanguage(d.language);
    setActiveTab("player");
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Allow re-selecting the same file later
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

      // The server may return a non-JSON error page (e.g. a serverless
      // function timeout / 5xx from the platform). Read the body as text first
      // and only parse JSON when it actually is JSON — otherwise res.json()
      // throws "Unexpected token ... is not valid JSON" and hides the cause.
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
        background: background.trim() || null,
        scene_flow: sceneFlow.trim() || null,
        locations: parseLines(locations),
        npcs: parseLines(npcs),
        key_items: parseLines(keyItems),
        secret_rules: secretRules.trim() || null,
        clues: parseLines(clues),
        threats: parseLines(threats),
        traps: parseLines(traps),
        ending_conditions: endingConditions.trim() || null,
        gm_notes: gmNotes.trim() || null,
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
      <div className="bg-gradient-to-r from-purple-900/30 to-slate-800/30 border border-purple-800/50 rounded-xl p-5 mb-6">
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
            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-medium whitespace-nowrap"
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
          <p className="text-purple-300 text-xs mt-3">正在讀取文件並詢問 AI，這可能需要幾秒鐘。</p>
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
            <Field label="世界背景" hint="AI 主持人需要了解的歷史、傳說與世界背景。">
              <textarea value={background} onChange={(e) => setBackground(e.target.value)} rows={5}
                placeholder="在叢林深處，一座被遺忘已久的神廟重見天日。傳說那裡珍藏著永恆碎片..."
                className={taCls} />
            </Field>
            <Field label="場景流程 / 劇情推進" hint="冒險的場景順序與推進邏輯 — 每一幕玩家會遇到什麼、需要做什麼、以及觸發下一幕的條件。這是 AI 主持人依循的主線。">
              <textarea value={sceneFlow} onChange={(e) => setSceneFlow(e.target.value)} rows={6}
                placeholder={"第一幕：抵達神廟入口。隊伍需找到開啟石門的方法（解開雕像謎題）。解開後 → 進入大廳。\n第二幕：大廳。守衛巡邏，玩家可潛行或戰鬥。找到地圖後 → 前往圖書館。\n第三幕：圖書館。蒐集三條線索揭示碎片位置。集齊後 → 最終對決。\n最終幕：王座室。擊敗守護者並在神廟崩塌前取回碎片。"}
                className={taCls} />
            </Field>
            <Field label="關鍵地點（每行一個）" hint="AI 主持人可在冒險中描述和引用的地點。">
              <textarea value={locations} onChange={(e) => setLocations(e.target.value)} rows={4}
                placeholder={"入口大廳 — 第一個房間，有火坑和雕像\n王座室 — 最終對決\n圖書館 — 古老書卷和線索"}
                className={taCls} />
            </Field>
            <Field label="NPC（每行一個）" hint="非玩家角色及其性格/角色簡述。">
              <textarea value={npcs} onChange={(e) => setNpcs(e.target.value)} rows={4}
                placeholder={"莫羅斯長老 — 神秘嚮導，知曉神廟的秘密\n德拉文上尉 — 敵對警衛隊長，STR 16\n西雅 — 被囚告密者，願以情報換取自由"}
                className={taCls} />
            </Field>
            <Field label="關鍵物品（每行一個）" hint="AI 主持人可在玩家探索時引入的物品。">
              <textarea value={keyItems} onChange={(e) => setKeyItems(e.target.value)} rows={3}
                placeholder={"永恆碎片 — 主要目標\n鐵鑰匙 — 開啟金庫門\n古代地圖 — 揭示隱藏通道"}
                className={taCls} />
            </Field>
          </div>
        )}

        {activeTab === "gm" && (
          <div className="flex flex-col gap-4">
            {gmBanner}
            <Field label="秘密規則" hint="AI 主持人的節奏、基調和機制指導。">
              <textarea value={secretRules} onChange={(e) => setSecretRules(e.target.value)} rows={4}
                placeholder={"這是恐怖劇本 — 緩慢建立緊張感，起初不要直接展示怪物。\n玩家目睹超自然事件時觸發 SAN 檢定。\n幸運檢定決定隨機遭遇的時機。"}
                className={taCls} />
            </Field>
            <Field label="線索（每行一個）" hint="可被玩家調查發現的資訊 — 內容、在何處／如何取得、以及揭示或解鎖什麼。調查類劇本特別依賴線索。">
              <textarea value={clues} onChange={(e) => setClues(e.target.value)} rows={4}
                placeholder={"血跡 — 在大廳地板，往北延伸 → 指向圖書館密門\n撕碎的日記 — 圖書館書架，搜查 INT DC 12 → 揭示碎片藏在王座後\n生鏽鑰匙 — 衛兵屍體上 → 開啟金庫"}
                className={taCls} />
            </Field>
            <Field label="威脅與敵人（每行一個）" hint="AI 主持人可部署的敵人和危險。">
              <textarea value={threats} onChange={(e) => setThreats(e.target.value)} rows={3}
                placeholder={"暗影幽靈 — 對物理攻擊免疫，遇光逃跑\n腐化神廟衛兵 — STR 14，AGI 10，成對巡邏\n石製魔像 — 玩家發出噪音時甦醒"}
                className={taCls} />
            </Field>
            <Field label="陷阱與危機（每行一個）" hint="AI 主持人可在玩家探索時描述的陷阱。">
              <textarea value={traps} onChange={(e) => setTraps(e.target.value)} rows={3}
                placeholder={"壓力板 — 飛鏢射出，AGI DC 14 躲避\n落石板 — 堵塞通道，STR DC 16 支撐\n毒霧 — 每回合損失 1 SAN 直到離開"}
                className={taCls} />
            </Field>
            <Field label="結局條件" hint="定義 AI 主持人應推進的勝敗條件。">
              <textarea value={endingConditions} onChange={(e) => setEndingConditions(e.target.value)} rows={3}
                placeholder={"勝利：在黎明前取回碎片並逃脫。\n失敗：所有角色死亡，或神廟坍塌時隊伍仍在內部。"}
                className={taCls} />
            </Field>
            <Field label="主持人補充備注" hint="其他背景資訊、氛圍說明或 AI 主持人的特殊指示。">
              <textarea value={gmNotes} onChange={(e) => setGmNotes(e.target.value)} rows={4}
                placeholder="獎勵有創意的解決方案。若玩家提早找到隱藏通道，可直接推進至最終對決。盡可能引用角色背景..."
                className={taCls} />
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
          {saving ? "發佈中..." : "發佈"}
        </button>
      </div>
    </div>
  );
}
