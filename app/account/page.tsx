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
    if (u.length < 2) { setError("Username must be at least 2 characters."); return; }
    if (u.length > 30) { setError("Username must be 30 characters or less."); return; }
    if (!/^[a-zA-Z0-9_\- ]+$/.test(u)) {
      setError("Username can only contain letters, numbers, spaces, hyphens, and underscores.");
      return;
    }
    if (u === username) { setSuccess("No changes made."); return; }

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
          ? "That username is already taken."
          : updateError.message
      );
      return;
    }

    setUsername(u);
    setSuccess("Username updated!");
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
        <p className="text-slate-500">Loading account...</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-4">
      <h1 className="text-3xl font-bold text-white mb-1">Account</h1>
      <p className="text-slate-400 mb-8">Manage your profile and session.</p>

      {/* Email (read-only) */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-4">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Email</h2>
        <p className="text-white">{email}</p>
        <p className="text-xs text-slate-500 mt-1">Email cannot be changed here.</p>
      </div>

      {/* Username edit */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-4">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Display Name / Username
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
            className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />
          <button
            type="submit"
            disabled={saving || newUsername.trim() === username}
            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg font-medium"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </form>
        <p className="text-xs text-slate-500 mt-2">
          This name appears to other players in game rooms.
        </p>
      </div>

      {/* Logout */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Session</h2>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="border border-red-800 hover:border-red-600 text-red-400 hover:text-red-300 px-4 py-2 rounded-lg text-sm disabled:opacity-50 transition-colors"
        >
          {loggingOut ? "Signing out..." : "Sign Out"}
        </button>
      </div>
    </div>
  );
}
