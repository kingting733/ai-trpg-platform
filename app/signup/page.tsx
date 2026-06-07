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
      router.push("/play/hub");
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
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-10 w-full max-w-md text-center">
          <div className="text-5xl mb-4">📧</div>
          <h1 className="text-2xl font-bold text-white mb-3">請查看你的電子郵件</h1>
          <p className="text-slate-400 mb-2">
            我們已將確認連結寄送至 <span className="text-white">{email}</span>。
          </p>
          <p className="text-slate-500 text-sm mb-8">
            點擊郵件中的連結以啟用帳號，然後在此登入。
          </p>
          <Link
            href="/login"
            className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2.5 rounded-lg font-medium"
          >
            前往登入
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center min-h-[70vh]">
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-white mb-1 text-center">建立帳號</h1>
        <p className="text-slate-400 text-sm text-center mb-6">加入冒險</p>

        {error && (
          <div className="mb-4 bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">使用者名稱</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="你的冒險者名稱"
              required
              maxLength={30}
              autoFocus
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              其他玩家在遊戲中將看到此名稱。
            </p>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">電子郵件</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
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
              minLength={6}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500"
            />
            <p className="text-xs text-slate-500 mt-1">至少 6 個字元。</p>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">確認密碼</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
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
            {loading ? "建立帳號中..." : "建立帳號"}
          </button>
        </form>

        <p className="text-slate-400 text-sm text-center mt-6">
          已有帳號？{" "}
          <Link href="/login" className="text-zinc-100 hover:text-white font-medium">
            登入
          </Link>
        </p>
      </div>
    </div>
  );
}
