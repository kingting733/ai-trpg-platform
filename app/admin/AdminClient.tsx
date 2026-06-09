"use client";
import { useState } from "react";
import Link from "next/link";
import type { DailySeedConfig } from "@/lib/ai/daily-scenario";

export interface AdminScenario {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  genre: string;
  created_at: string;
  creatorName: string;
  roomCount: number;
}

export interface DailyDraft {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  genre: string;
  difficulty: string;
  dailyDate: string | null;
  created_at: string;
}

export interface AdminRoom {
  id: string;
  name: string;
  roomCode: string;
  status: "waiting" | "in_progress" | "completed";
  round: number;
  created_at: string;
  updated_at: string;
  scenarioTitle: string;
  hostName: string;
  playerCount: number;
}

const statusLabel: Record<string, string> = {
  draft: "草稿",
  published: "已發佈",
  archived: "已封存",
  waiting: "等待中",
  in_progress: "進行中",
  completed: "已結束",
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return iso;
  }
}

export function AdminClient({
  scenarios: initialScenarios,
  rooms: initialRooms,
  dailyDrafts: initialDaily,
  seedConfig: initialSeed,
}: {
  scenarios: AdminScenario[];
  rooms: AdminRoom[];
  dailyDrafts: DailyDraft[];
  seedConfig: DailySeedConfig;
}) {
  const [tab, setTab] = useState<"scenarios" | "rooms" | "daily">("scenarios");
  const [scenarios, setScenarios] = useState(initialScenarios);
  const [rooms, setRooms] = useState(initialRooms);
  const [daily, setDaily] = useState(initialDaily);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function deleteScenario(s: AdminScenario) {
    const warn =
      s.roomCount > 0
        ? `確定要刪除劇本「${s.title}」嗎？\n\n這也會一併刪除使用此劇本的 ${s.roomCount} 個房間及其所有遊戲紀錄。此操作無法復原。`
        : `確定要刪除劇本「${s.title}」嗎？此操作無法復原。`;
    if (!confirm(warn)) return;

    setBusy(s.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/scenarios/${s.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? `刪除失敗（HTTP ${res.status}）`);
        return;
      }
      setScenarios((prev) => prev.filter((x) => x.id !== s.id));
      setRooms((prev) => prev.filter((r) => r.scenarioTitle !== s.title)); // best-effort UI sync
      setNotice(
        `已刪除劇本「${s.title}」` + (json?.roomsRemoved ? `，並移除 ${json.roomsRemoved} 個相關房間。` : "。")
      );
    } catch (e: any) {
      setError(e?.message ?? "刪除失敗");
    } finally {
      setBusy(null);
    }
  }

  const isIdle = (r: AdminRoom) => Date.now() - new Date(r.updated_at).getTime() > 60 * 60 * 1000;
  const idleCount = rooms.filter(isIdle).length;

  async function deleteInactiveRooms() {
    if (idleCount === 0) {
      setNotice("沒有閒置超過 1 小時的房間。");
      setError(null);
      return;
    }
    if (!confirm(`確定要刪除 ${idleCount} 個閒置超過 1 小時的房間嗎？\n\n這會刪除這些房間的所有角色與遊戲紀錄。此操作無法復原。`)) return;

    setBusy("__inactive__");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/rooms/inactive`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? `刪除失敗（HTTP ${res.status}）`);
        return;
      }
      const removed: string[] = json?.ids ?? [];
      setRooms((prev) => prev.filter((x) => !removed.includes(x.id)));
      setNotice(`已刪除 ${json?.deleted ?? removed.length} 個閒置房間。`);
    } catch (e: any) {
      setError(e?.message ?? "刪除失敗");
    } finally {
      setBusy(null);
    }
  }

  async function deleteRoom(r: AdminRoom) {
    if (!confirm(`確定要刪除房間「${r.name}」(${r.roomCode}) 嗎？\n\n這會刪除該房間的所有角色與遊戲紀錄。此操作無法復原。`)) return;

    setBusy(r.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/rooms/${r.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? `刪除失敗（HTTP ${res.status}）`);
        return;
      }
      setRooms((prev) => prev.filter((x) => x.id !== r.id));
      setNotice(`已刪除房間「${r.name}」。`);
    } catch (e: any) {
      setError(e?.message ?? "刪除失敗");
    } finally {
      setBusy(null);
    }
  }

  // ── Daily scenario state ────────────────────────────────────────────────
  const linesToArr = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const [seed, setSeed] = useState({
    genre_rotation: initialSeed.genre_rotation.join("\n"),
    tone_pool: initialSeed.tone_pool.join("\n"),
    setting_pool: initialSeed.setting_pool.join("\n"),
    hook_pool: initialSeed.hook_pool.join("\n"),
    min_players: initialSeed.min_players,
    max_players: initialSeed.max_players,
    play_time_min: initialSeed.play_time_min,
    play_time_max: initialSeed.play_time_max,
    today_idea: initialSeed.today_idea,
  });
  const [seedSaving, setSeedSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const pendingDaily = daily.filter((d) => d.status === "draft");

  async function saveSeed() {
    setSeedSaving(true); setError(null); setNotice(null);
    try {
      const config: DailySeedConfig = {
        genre_rotation: linesToArr(seed.genre_rotation),
        tone_pool: linesToArr(seed.tone_pool),
        setting_pool: linesToArr(seed.setting_pool),
        hook_pool: linesToArr(seed.hook_pool),
        min_players: Number(seed.min_players),
        max_players: Number(seed.max_players),
        play_time_min: Number(seed.play_time_min),
        play_time_max: Number(seed.play_time_max),
        today_idea: seed.today_idea,
      };
      const res = await fetch("/api/admin/daily/seed", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(json?.error ?? "儲存失敗"); return; }
      setNotice("已儲存每日種子設定。");
    } catch (e: any) {
      setError(e?.message ?? "儲存失敗");
    } finally {
      setSeedSaving(false);
    }
  }

  async function generateNow(force: boolean) {
    if (force && !confirm("確定要重新生成今天的劇本嗎？這會取代目前尚未核准的今日草稿。")) return;
    setGenerating(true); setError(null); setNotice(null);
    try {
      // Persist any seed edits first so generation uses them.
      await saveSeed();
      const res = await fetch("/api/admin/daily/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(json?.message ?? json?.error ?? "生成失敗"); return; }
      if (json.status === "exists") {
        setNotice("今天已經有一份每日草稿了（可用「重新生成」覆蓋）。");
      } else if (json.status === "created") {
        setNotice(`已生成今日草稿：「${json.title}」${json.usedCustomIdea ? "（使用自訂靈感）" : ""}。請重新整理頁面以檢視。`);
        if (json.usedCustomIdea) setSeed((s) => ({ ...s, today_idea: "" }));
      } else {
        setError(json?.message ?? "生成失敗");
      }
    } catch (e: any) {
      setError(e?.message ?? "生成失敗");
    } finally {
      setGenerating(false);
    }
  }

  async function approveDaily(d: DailyDraft) {
    setBusy(d.id); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/admin/daily/${d.id}/approve`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(json?.error ?? "核准失敗"); return; }
      setDaily((prev) => prev.map((x) => (x.id === d.id ? { ...x, status: "published" } : x)));
      setNotice(`已核准並發佈「${d.title}」。`);
    } catch (e: any) {
      setError(e?.message ?? "核准失敗");
    } finally {
      setBusy(null);
    }
  }

  async function rejectDaily(d: DailyDraft) {
    if (!confirm(`確定要退回並刪除每日草稿「${d.title}」嗎？此操作無法復原。`)) return;
    setBusy(d.id); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/admin/scenarios/${d.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(json?.error ?? "刪除失敗"); return; }
      setDaily((prev) => prev.filter((x) => x.id !== d.id));
      setNotice(`已刪除草稿「${d.title}」。`);
    } catch (e: any) {
      setError(e?.message ?? "刪除失敗");
    } finally {
      setBusy(null);
    }
  }

  const q = query.trim().toLowerCase();
  const filteredScenarios = q
    ? scenarios.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.creatorName.toLowerCase().includes(q) ||
          s.genre.toLowerCase().includes(q)
      )
    : scenarios;
  const filteredRooms = q
    ? rooms.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.roomCode.toLowerCase().includes(q) ||
          r.scenarioTitle.toLowerCase().includes(q) ||
          r.hostName.toLowerCase().includes(q)
      )
    : rooms;

  const delBtn = "text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 bg-slate-700 hover:bg-red-900/50 text-slate-300 hover:text-red-300";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white">管理員後台</h1>
        <p className="text-slate-400 mt-1">管理平台上所有劇本與房間</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: "劇本總數", value: scenarios.length },
          { label: "已發佈劇本", value: scenarios.filter((s) => s.status === "published").length },
          { label: "房間總數", value: rooms.length },
          { label: "進行中房間", value: rooms.filter((r) => r.status === "in_progress").length },
        ].map((s) => (
          <div key={s.label} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <div className="text-2xl font-bold text-white">{s.value}</div>
            <div className="text-slate-400 text-xs mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-2">
          {(["scenarios", "rooms", "daily"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t ? "bg-zinc-800 text-white" : "bg-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              {t === "scenarios"
                ? `劇本 (${scenarios.length})`
                : t === "rooms"
                ? `房間 (${rooms.length})`
                : `每日劇本${pendingDaily.length > 0 ? ` · ${pendingDaily.length} 待審` : ""}`}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋標題 / 建立者 / 代碼…"
          className="flex-1 min-w-[200px] bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500"
        />
        {tab === "rooms" && (
          <button
            onClick={deleteInactiveRooms}
            disabled={busy === "__inactive__" || idleCount === 0}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 bg-red-900/50 hover:bg-red-800/60 text-red-200 border border-red-900/60"
          >
            {busy === "__inactive__" ? "刪除中…" : `刪除閒置 1 小時的房間（${idleCount}）`}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-red-950/40 border border-red-900/50 rounded-lg px-4 py-2.5 text-sm text-red-300">{error}</div>
      )}
      {notice && (
        <div className="mb-4 bg-green-950/40 border border-green-900/50 rounded-lg px-4 py-2.5 text-sm text-green-300">{notice}</div>
      )}

      {tab === "daily" ? (
        <DailyPanel
          pending={pendingDaily}
          published={daily.filter((d) => d.status === "published")}
          seed={seed}
          setSeed={setSeed}
          seedSaving={seedSaving}
          generating={generating}
          busy={busy}
          onSaveSeed={saveSeed}
          onGenerate={generateNow}
          onApprove={approveDaily}
          onReject={rejectDaily}
        />
      ) : (
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl">
        {tab === "scenarios" ? (
          filteredScenarios.length === 0 ? (
            <div className="p-12 text-center text-slate-500">沒有符合的劇本。</div>
          ) : (
            <div className="divide-y divide-slate-700">
              {filteredScenarios.map((s) => (
                <div key={s.id} className="p-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-medium text-white truncate">{s.title}</span>
                      <span className="text-xs px-2 py-0.5 rounded border border-slate-600 bg-slate-700 text-slate-300 shrink-0">
                        {statusLabel[s.status] ?? s.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                      <span>建立者：{s.creatorName}</span>
                      <span>{s.genre}</span>
                      <span>{s.roomCount} 個房間</span>
                      <span>{fmtDate(s.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link href={`/scenarios/${s.id}`} className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg">
                      查看
                    </Link>
                    <button onClick={() => deleteScenario(s)} disabled={busy === s.id} className={delBtn}>
                      {busy === s.id ? "刪除中…" : "刪除"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : filteredRooms.length === 0 ? (
          <div className="p-12 text-center text-slate-500">沒有符合的房間。</div>
        ) : (
          <div className="divide-y divide-slate-700">
            {filteredRooms.map((r) => (
              <div key={r.id} className="p-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-medium text-white truncate">{r.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded border border-slate-600 bg-slate-700 text-slate-300 shrink-0">
                      {statusLabel[r.status] ?? r.status}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">{r.roomCode}</span>
                    {isIdle(r) && (
                      <span className="text-xs px-2 py-0.5 rounded border border-amber-900/60 bg-amber-950/40 text-amber-300 shrink-0">
                        閒置 &gt; 1 小時
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>劇本：{r.scenarioTitle}</span>
                    <span>房主：{r.hostName}</span>
                    <span>{r.playerCount} 名玩家</span>
                    <span>第 {r.round} 回合</span>
                    <span>{fmtDate(r.created_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => deleteRoom(r)} disabled={busy === r.id} className={delBtn}>
                    {busy === r.id ? "刪除中…" : "刪除"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ── Daily scenario panel ──────────────────────────────────────────────────────

type SeedForm = {
  genre_rotation: string; tone_pool: string; setting_pool: string; hook_pool: string;
  min_players: number; max_players: number; play_time_min: number; play_time_max: number;
  today_idea: string;
};

function DailyPanel({
  pending, published, seed, setSeed, seedSaving, generating, busy,
  onSaveSeed, onGenerate, onApprove, onReject,
}: {
  pending: DailyDraft[];
  published: DailyDraft[];
  seed: SeedForm;
  setSeed: React.Dispatch<React.SetStateAction<SeedForm>>;
  seedSaving: boolean;
  generating: boolean;
  busy: string | null;
  onSaveSeed: () => void;
  onGenerate: (force: boolean) => void;
  onApprove: (d: DailyDraft) => void;
  onReject: (d: DailyDraft) => void;
}) {
  const hasToday = pending.length > 0;
  const poolField = (label: string, key: keyof SeedForm, hint: string) => (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}<span className="text-slate-600 ml-1">{hint}</span></label>
      <textarea
        value={seed[key] as string}
        onChange={(e) => setSeed((s) => ({ ...s, [key]: e.target.value }))}
        rows={4}
        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500"
      />
    </div>
  );
  const numField = (label: string, key: keyof SeedForm) => (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input type="number" min={1} value={seed[key] as number}
        onChange={(e) => setSeed((s) => ({ ...s, [key]: Number(e.target.value) }))}
        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Pending review */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
        <h2 className="text-white font-semibold mb-1">待審核 / 已生成</h2>
        <p className="text-slate-400 text-xs mb-4">每日劇本生成後為「草稿」，需你核准才會發佈上線。</p>
        {pending.length === 0 && published.length === 0 ? (
          <div className="text-slate-500 text-sm py-6 text-center">尚無每日劇本。用下方「立即生成」建立第一份。</div>
        ) : (
          <div className="space-y-2">
            {[...pending, ...published].map((d) => (
              <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-900/60 border border-slate-700">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-medium truncate">{d.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${
                      d.status === "draft"
                        ? "border-amber-900/60 bg-amber-950/40 text-amber-300"
                        : "border-green-900/60 bg-green-950/40 text-green-300"}`}>
                      {d.status === "draft" ? "待審核" : "已發佈"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-slate-500 mt-0.5">
                    <span>{d.dailyDate ?? "—"}</span>
                    <span>{d.genre}</span>
                    <span>{d.difficulty}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link href={`/scenarios/${d.id}/edit`}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg">
                    檢視 / 編輯
                  </Link>
                  {d.status === "draft" && (
                    <>
                      <button onClick={() => onApprove(d)} disabled={busy === d.id}
                        className="text-xs px-3 py-1.5 rounded-lg bg-green-800/60 hover:bg-green-700/70 text-green-100 disabled:opacity-50">
                        {busy === d.id ? "…" : "✓ 核准發佈"}
                      </button>
                      <button onClick={() => onReject(d)} disabled={busy === d.id}
                        className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-red-900/50 text-slate-300 hover:text-red-300 disabled:opacity-50">
                        ✗ 退回
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={() => onGenerate(false)} disabled={generating}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-700 hover:bg-zinc-600 text-white disabled:opacity-50">
            {generating ? "生成中…" : "立即生成今日劇本"}
          </button>
          {hasToday && (
            <button onClick={() => onGenerate(true)} disabled={generating}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 disabled:opacity-50">
              重新生成（覆蓋今日草稿）
            </button>
          )}
        </div>
      </div>

      {/* Custom idea */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
        <h2 className="text-white font-semibold mb-1">今日靈感（選填）</h2>
        <p className="text-slate-400 text-xs mb-3">
          有了好題材（例如今天的新聞）就填在這。填入後，下一次生成會以此為主題並忽略下方輪替種子；生成後自動清空。
        </p>
        <textarea
          value={seed.today_idea}
          onChange={(e) => setSeed((s) => ({ ...s, today_idea: e.target.value }))}
          rows={3}
          placeholder="例：一座香港舊唐樓的住客在一夜間全部失蹤，警方封鎖現場，但鄰居說仍看見窗內燈光閃爍…"
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500"
        />
      </div>

      {/* Seed pools */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
        <h2 className="text-white font-semibold mb-1">輪替種子設定</h2>
        <p className="text-slate-400 text-xs mb-4">每行一個項目。類型依日期輪替；基調 / 場景 / 鉤子每天隨機抽取。</p>
        <div className="grid sm:grid-cols-2 gap-4">
          {poolField("類型輪替 genre", "genre_rotation", "（須為系統列舉值）")}
          {poolField("基調 tone", "tone_pool", "")}
          {poolField("場景 setting", "setting_pool", "")}
          {poolField("鉤子 hook", "hook_pool", "")}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {numField("最少玩家", "min_players")}
          {numField("最多玩家", "max_players")}
          {numField("時長下限（分）", "play_time_min")}
          {numField("時長上限（分）", "play_time_max")}
        </div>
        <button onClick={onSaveSeed} disabled={seedSaving}
          className="mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-700 hover:bg-zinc-600 text-white disabled:opacity-50">
          {seedSaving ? "儲存中…" : "儲存種子設定"}
        </button>
      </div>
    </div>
  );
}
