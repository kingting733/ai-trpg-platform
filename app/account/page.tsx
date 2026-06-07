"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AccountPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      setEmail(user.email ?? "");

      const { data: profile } = await supabase
        .from("users")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();

      const current = profile?.username ?? user.email?.split("@")[0] ?? "";
      setUsername(current);
      setNewUsername(current);
      setLoading(false);
    }
    load();
  }, [router]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const u = newUsername.trim();
    if (u.length < 2) { setError("使用者名稱至少需要 2 個字元。"); return; }
    if (u.length > 30) { setError("使用者名稱不可超過 30 個字元。"); return; }
    if (!/^[a-zA-Z0-9_\- ]+$/.test(u)) {
      setError("使用者名稱只能包含字母、數字、空格、連字號和底線。");
      return;
    }
    if (u === username) { setSuccess("未做任何變更。"); return; }

    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const { error: updateError } = await supabase
      .from("users")
      .update({ username: u })
      .eq("id", user.id);

    setSaving(false);
    if (updateError) {
      setError(
        updateError.message.toLowerCase().includes("unique") ||
        updateError.message.toLowerCase().includes("duplicate")
          ? "該使用者名稱已被使用。"
          : updateError.message
      );
      return;
    }

    setUsername(u);
    setSuccess("使用者名稱已更新！");
    router.refresh();
  }

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-slate-500">載入帳號資料中...</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-4">
      <h1 className="text-3xl font-bold text-white mb-1">帳號設定</h1>
      <p className="text-slate-400 mb-8">管理你的個人資料與登入狀態。</p>

      {/* Email (read-only) */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-4">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">電子郵件</h2>
        <p className="text-white">{email}</p>
        <p className="text-xs text-slate-500 mt-1">電子郵件無法在此變更。</p>
      </div>

      {/* Username edit */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-4">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          顯示名稱 / 使用者名稱
        </h2>
        {error && (
          <div className="mb-3 bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-3 bg-green-900/30 border border-green-700 text-green-300 text-sm rounded-lg px-3 py-2">
            {success}
          </div>
        )}
        <form onSubmit={handleSave} className="flex gap-3">
          <input
            type="text"
            value={newUsername}
            onChange={(e) => { setNewUsername(e.target.value); setError(null); setSuccess(null); }}
            maxLength={30}
            className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={saving || newUsername.trim() === username}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg font-medium"
          >
            {saving ? "儲存中..." : "儲存"}
          </button>
        </form>
        <p className="text-xs text-slate-500 mt-2">
          此名稱將顯示給遊戲房間內的其他玩家。
        </p>
      </div>

      {/* Logout */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">登入狀態</h2>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="border border-red-800 hover:border-red-600 text-red-400 hover:text-red-300 px-4 py-2 rounded-lg text-sm disabled:opacity-50 transition-colors"
        >
          {loggingOut ? "登出中..." : "登出"}
        </button>
      </div>
    </div>
  );
}
