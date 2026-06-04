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
    if (u.length < 2) { setError("Username must be at least 2 characters."); return; }
    if (u.length > 30) { setError("Username must be 30 characters or less."); return; }
    if (!/^[a-zA-Z0-9_\- ]+$/.test(u)) {
      setError("Username can only contain letters, numbers, spaces, hyphens, and underscores.");
      return;
    }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }

    setLoading(true);
    const supabase = createClient();

    // Pre-check username availability (best-effort before signUp)
    const { count } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("username", u);

    if ((count ?? 0) > 0) {
      setError("That username is already taken. Please choose a different one.");
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
      setError("Signup failed. Please try again.");
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
          <h1 className="text-2xl font-bold text-white mb-3">Check your email</h1>
          <p className="text-slate-400 mb-2">
            We sent a confirmation link to <span className="text-white">{email}</span>.
          </p>
          <p className="text-slate-500 text-sm mb-8">
            Click the link in the email to activate your account, then log in here.
          </p>
          <Link
            href="/login"
            className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-2.5 rounded-lg font-medium"
          >
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center min-h-[70vh]">
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-white mb-1 text-center">Create Account</h1>
        <p className="text-slate-400 text-sm text-center mb-6">Join the adventure</p>

        {error && (
          <div className="mb-4 bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="YourAdventurerName"
              required
              maxLength={30}
              autoFocus
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              This is the name other players will see in the game.
            </p>
          </div>
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
            <p className="text-xs text-slate-500 mt-1">Minimum 6 characters.</p>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg font-medium mt-1"
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="text-slate-400 text-sm text-center mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-purple-400 hover:text-purple-300 font-medium">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
