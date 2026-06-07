"use client";
import { useState } from "react";
import Link from "next/link";

export interface AdminScenario {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  genre: string;
  created_at: string;
  creatorName: string;
  roomCount: number;
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
}: {
  scenarios: AdminScenario[];
  rooms: AdminRoom[];
}) {
  const [tab, setTab] = useState<"scenarios" | "rooms">("scenarios");
  const [scenarios, setScenarios] = useState(initialScenarios);
  const [rooms, setRooms] = useState(initialRooms);
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
          {(["scenarios", "rooms"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t ? "bg-zinc-800 text-white" : "bg-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              {t === "scenarios" ? `劇本 (${scenarios.length})` : `房間 (${rooms.length})`}
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
    </div>
  );
}
