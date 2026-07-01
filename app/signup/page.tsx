"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const u = username.trim();
    if (u.length < 2) { setError("使用者名稱至少需要 2 個字元。"); return; }
    if (u.length > 30) { setError("使用者名稱不可超過 30 個字元。"); return; }
    if (!/^[a-zA-Z0-9_\- ]+$/.test(u)) {
      setError("使用者名稱只能包含字母、數字、空格、連字號和底線。");
      return;
    }
    if (password.length < 6) { setError("密碼至少需要 6 個字元。"); return; }
    if (password !== confirm) { setError("兩次輸入的密碼不一致。"); return; }

    setLoading(true);
    const supabase = createClient();

    // Pre-check username availability (best-effort before signUp)
    const { count } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("username", u);

    if ((count ?? 0) > 0) {
      setError("該使用者名稱已被使用，請選擇其他名稱。");
      setLoading(false);
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username: u } },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    if (!data.user) {
      setError("註冊失敗，請再試一次。");
      setLoading(false);
      return;
    }

    if (data.session) {
      // No email confirmation required — profile created by DB trigger, go straight in
      router.push("/");
      router.refresh();
      return;
    }

    // Email confirmation required
    setEmailSent(true);
    setLoading(false);
  }

  if (emailSent) {
    return (
      <div className="flex justify-center items-center min-h-[70vh]">
        <div
          className="w-full max-w-md rounded-xl p-10 text-center"
          style={{
            background: "linear-gradient(180deg,#1a1612,#141110)",
            border: "1px solid #2a2418",
            boxShadow: "0 0 40px rgba(201,169,110,0.06)",
          }}
        >
          <div className="text-5xl mb-4">📧</div>
          <h1 className="font-serif text-2xl text-gold mb-3 tracking-wide">請查看你的電子郵件</h1>
          <p className="text-zinc-400 mb-2">
            我們已將確認連結寄送至 <span className="text-zinc-100">{email}</span>。
          </p>
          <p className="text-zinc-500 text-sm mb-8">
            點擊郵件中的連結以啟用帳號，然後在此登入。
          </p>
          <Link
            href="/login"
            className="inline-block px-6 py-2.5 rounded-lg font-serif tracking-wide transition-all hover:brightness-110"
            style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 18px rgba(201,169,110,0.18)" }}
          >
            前往登入
          </Link>
        </div>
      </div>
    );
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
        <div className="flex flex-col items-center mb-6">
          <div className="w-9 h-9 rounded border border-gold/40 flex items-center justify-center text-gold mb-3">
            ✦
          </div>
          <h1 className="font-serif text-2xl text-gold tracking-wide">建立帳號</h1>
          <div className="flex items-center gap-3 mt-3 mb-1 w-full">
            <div className="h-px flex-1 bg-gold/20" />
            <span className="text-[11px] text-zinc-500 tracking-widest uppercase">加入冒險</span>
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
            <label className="block text-xs text-zinc-400 mb-1.5 tracking-wide">使用者名稱</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="你的冒險者名稱"
              required
              maxLength={30}
              autoFocus
              className="w-full rounded-lg px-3 py-2.5 text-zinc-100 placeholder-zinc-600 focus:outline-none transition-colors"
              style={{ background: "#0c0a07", border: "1px solid #2a2418" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,169,110,0.5)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2418")}
            />
            <p className="text-xs text-zinc-500 mt-1">
              其他玩家在遊戲中將看到此名稱。
            </p>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5 tracking-wide">電子郵件</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
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
              minLength={6}
              className="w-full rounded-lg px-3 py-2.5 text-zinc-100 placeholder-zinc-600 focus:outline-none transition-colors"
              style={{ background: "#0c0a07", border: "1px solid #2a2418" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,169,110,0.5)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2418")}
            />
            <p className="text-xs text-zinc-500 mt-1">至少 6 個字元。</p>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5 tracking-wide">確認密碼</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
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
            {loading ? "建立帳號中..." : "建立帳號"}
          </button>
        </form>

        <p className="text-zinc-500 text-sm text-center mt-6">
          已有帳號？{" "}
          <Link href="/login" className="text-gold hover:text-gold-light font-medium transition-colors">
            登入
          </Link>
        </p>
      </div>
    </div>
  );
}
