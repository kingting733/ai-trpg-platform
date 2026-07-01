"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

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
      <div
        className="w-full max-w-md rounded-xl p-8"
        style={{
          background: "linear-gradient(180deg,#1a1612,#141110)",
          border: "1px solid #2a2418",
          boxShadow: "0 0 40px rgba(201,169,110,0.06)",
        }}
      >
        {/* Decorative crest + line, matching the site header */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-9 h-9 rounded border border-gold/40 flex items-center justify-center text-gold mb-3">
            ✦
          </div>
          <h1 className="font-serif text-2xl text-gold tracking-wide">歡迎回來</h1>
          <div className="flex items-center gap-3 mt-3 mb-1 w-full">
            <div className="h-px flex-1 bg-gold/20" />
            <span className="text-[11px] text-zinc-500 tracking-widest uppercase">登入帳號以繼續</span>
            <div className="h-px flex-1 bg-gold/20" />
          </div>
        </div>

        {error && (
          <div className="mb-4 text-sm rounded-lg px-4 py-3"
            style={{ background: "rgba(120,30,30,0.25)", border: "1px solid rgba(180,70,70,0.4)", color: "#fca5a5" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5 tracking-wide">電子郵件</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
              className="w-full rounded-lg px-3 py-2.5 text-zinc-100 placeholder-zinc-600 focus:outline-none transition-colors"
              style={{ background: "#0c0a07", border: "1px solid #2a2418" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,169,110,0.5)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2418")}
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5 tracking-wide">密碼</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full rounded-lg px-3 py-2.5 text-zinc-100 placeholder-zinc-600 focus:outline-none transition-colors"
              style={{ background: "#0c0a07", border: "1px solid #2a2418" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,169,110,0.5)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2418")}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg font-serif tracking-wide mt-1 transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 18px rgba(201,169,110,0.18)" }}
          >
            {loading ? "登入中..." : "登入"}
          </button>
        </form>

        <p className="text-zinc-500 text-sm text-center mt-6">
          還沒有帳號？{" "}
          <Link href="/signup" className="text-gold hover:text-gold-light font-medium transition-colors">
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
