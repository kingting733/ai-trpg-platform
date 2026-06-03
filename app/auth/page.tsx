"use client";
import { useState } from "react";

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");

  return (
    <div className="flex justify-center items-center min-h-[70vh]">
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-white mb-6 text-center">
          {mode === "login" ? "Welcome Back" : "Create Account"}
        </h1>

        <div className="flex mb-6 bg-slate-900 rounded-lg p-1">
          <button
            onClick={() => setMode("login")}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === "login" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Login
          </button>
          <button
            onClick={() => setMode("signup")}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === "signup" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Sign Up
          </button>
        </div>

        <form className="flex flex-col gap-4">
          {mode === "signup" && (
            <div>
              <label className="block text-sm text-slate-400 mb-1">Username</label>
              <input
                type="text"
                placeholder="Your username"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>
          )}
          <div>
            <label className="block text-sm text-slate-400 mb-1">Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Password</label>
            <input
              type="password"
              placeholder="••••••••"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-purple-600 hover:bg-purple-500 text-white py-2.5 rounded-lg font-medium mt-2"
          >
            {mode === "login" ? "Login" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
