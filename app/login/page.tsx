"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/play/hub";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { data, error: loginError } = await supabase.auth.signInWithPassword({ email, password });

    if (loginError) {
      setError(
        loginError.message === "Invalid login credentials"
          ? "電子郵件或密碼錯誤，請再試一次。"
          : loginError.message
      );
      setLoading(false);
      return;
    }

    // Ensure public.users profile row exists (covers edge cases like
    // accounts created before the DB trigger was added).
    if (data.user) {
      const { data: profile } = await supabase
        .from("users")
        .select("id")
        .eq("id", data.user.id)
        .maybeSingle();

      if (!profile) {
        const fallbackUsername =
          (data.user.email?.split("@")[0] ?? "adventurer").slice(0, 28) +
          "_" + data.user.id.slice(0, 4);
        await supabase.from("users").insert({
          id: data.user.id,
          email: data.user.email ?? "",
          username: fallbackUsername,
        });
      }
    }

    router.push(next);
    router.refresh();
  }

  return (
    <div className="flex justify-center items-center min-h-[70vh]">
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-white mb-1 text-center">歡迎回來</h1>
        <p className="text-slate-400 text-sm text-center mb-6">登入帳號以繼續</p>

        {error && (
          <div className="mb-4 bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">電子郵件</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">密碼</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg font-medium mt-1"
          >
            {loading ? "登入中..." : "登入"}
          </button>
        </form>

        <p className="text-slate-400 text-sm text-center mt-6">
          還沒有帳號？{" "}
          <Link href="/signup" className="text-zinc-100 hover:text-white font-medium">
            立即註冊
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
