"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    const supabase = createClient();

    if (mode === "signup") {
      if (!username.trim()) {
        setError("Username is required.");
        setLoading(false);
        return;
      }
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } },
      });
      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }
      if (data.user) {
        // Insert into public.users table
        const { error: insertError } = await supabase.from("users").insert({
          id: data.user.id,
          email,
          username,
        });
        if (insertError && !insertError.message.includes("duplicate")) {
          setError(insertError.message);
          setLoading(false);
          return;
        }
      }
      setSuccessMsg("Account created! Check your email to confirm, then log in.");
      setLoading(false);
      return;
    }

    // Login
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) {
      setError(loginError.message);
      setLoading(false);
      return;
    }
    router.push("/scenarios");
    router.refresh();
  }

  return (
    <div className="flex justify-center items-center min-h-[70vh]">
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-white mb-6 text-center">
          {mode === "login" ? "Welcome Back" : "Create Account"}
        </h1>

        <div className="flex mb-6 bg-slate-900 rounded-lg p-1">
          <button
            onClick={() => { setMode("login"); setError(null); setSuccessMsg(null); }}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === "login" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Login
          </button>
          <button
            onClick={() => { setMode("signup"); setError(null); setSuccessMsg(null); }}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === "signup" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Sign Up
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-4 bg-green-900/30 border border-green-700 text-green-300 text-sm rounded-lg px-4 py-3">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === "signup" && (
            <div>
              <label className="block text-sm text-slate-400 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Your username"
                required
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>
          )}
          <div>
            <label className="block text-sm text-slate-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg font-medium mt-2"
          >
            {loading ? "Please wait..." : mode === "login" ? "Login" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
