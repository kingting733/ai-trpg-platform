"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function PlayPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEnter(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInAnonymously();
    if (authError || !data.user) {
      const msg = authError?.message ?? "Failed to sign in";
      setError(
        msg.toLowerCase().includes("anonymous")
          ? "Anonymous sign-in is disabled. Go to Supabase → Authentication → Providers → Anonymous → enable it."
          : msg
      );
      setLoading(false);
      return;
    }
    const { error: upsertError } = await supabase.from("users").upsert({
      id: data.user.id,
      email: data.user.id + "@guest.local",
      username: username.trim(),
    }, { onConflict: "id" });
    if (upsertError) {
      setError(upsertError.message);
      setLoading(false);
      return;
    }
    localStorage.setItem("trpg_username", username.trim());
    router.push("/play/hub");
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-2">Enter the Adventure</h1>
        <p className="text-slate-400">No account needed — just pick a name and play</p>
      </div>
      <form onSubmit={handleEnter} className="flex flex-col gap-4 w-full max-w-sm">
        {error && (
          <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3">{error}</div>
        )}
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Your adventurer name..."
          maxLength={30}
          required
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 text-lg text-center"
        />
        <button
          type="submit"
          disabled={loading || !username.trim()}
          className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium text-lg"
        >
          {loading ? "Entering..." : "Enter"}
        </button>
      </form>
    </div>
  );
}
