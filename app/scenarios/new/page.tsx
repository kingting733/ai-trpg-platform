"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const GENRES = ["Fantasy", "Cyberpunk", "Horror", "Sci-Fi", "Mystery", "Historical", "Other"];

type Tab = "basic" | "world" | "rules";
type Status = "draft" | "published";

export default function NewScenarioPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("basic");
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [description, setDescription] = useState("");
  const [objective, setObjective] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [background, setBackground] = useState("");
  const [rules, setRules] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSave(status: Status) {
    if (!title.trim() || !genre || !description.trim()) {
      setActiveTab("basic");
      setError("Title, genre, and description are required.");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/auth"); return; }

    const { data, error: insertError } = await supabase
      .from("scenarios")
      .insert({
        creator_id: user.id,
        title: title.trim(),
        genre,
        description: description.trim(),
        objective: objective.trim() || null,
        background: background.trim() || null,
        rules: rules.trim() || null,
        max_players: maxPlayers,
        status,
      })
      .select("id")
      .single();

    if (insertError || !data) {
      setError(insertError?.message ?? "Failed to save");
      setSaving(false);
      return;
    }

    setSuccess(status === "published" ? "Scenario published!" : "Saved as draft.");
    setSaving(false);
    setTimeout(() => router.push("/dashboard"), 1000);
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-2">Create Scenario</h1>
      <p className="text-slate-400 mb-8">Build a new TRPG adventure for players to explore.</p>

      <div className="flex gap-1 mb-6 bg-slate-900 rounded-lg p-1">
        {(["basic", "world", "rules"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 rounded-md text-sm font-medium capitalize transition-colors ${
              activeTab === tab ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {tab === "basic" ? "Basic Info" : tab === "world" ? "World" : "Rules & GM Notes"}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3">{error}</div>}
      {success && <div className="mb-4 bg-green-900/30 border border-green-700 text-green-300 text-sm rounded-lg px-4 py-3">{success}</div>}

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        {activeTab === "basic" && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Title *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Lost Temple" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500" />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Genre *</label>
              <select value={genre} onChange={(e) => setGenre(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500">
                <option value="">Select genre...</option>
                {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Description *</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="A short summary shown to players browsing scenarios..." className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none" />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Objective</label>
              <textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} placeholder="What must players accomplish?" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none" />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Max Players</label>
              <input type="number" value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} min={2} max={8} className="w-32 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500" />
            </div>
          </div>
        )}
        {activeTab === "world" && (
          <div>
            <label className="block text-sm text-slate-400 mb-1">Background Story</label>
            <textarea value={background} onChange={(e) => setBackground(e.target.value)} rows={10} placeholder="Describe the world, history, and context of your scenario. This is given to the AI GM as context..." className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none" />
          </div>
        )}
        {activeTab === "rules" && (
          <div>
            <label className="block text-sm text-slate-400 mb-1">Custom Rules / Notes for AI GM</label>
            <p className="text-xs text-slate-500 mb-3">These instructions are passed directly to the AI Game Master. Use this to set tone, difficulty, special mechanics, etc.</p>
            <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={10} placeholder="e.g. This is a horror scenario — build tension slowly. Players can find items. If a player rolls low (luck check), describe a bad outcome..." className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none" />
          </div>
        )}
      </div>

      <div className="flex gap-3 mt-6">
        <button onClick={() => handleSave("draft")} disabled={saving} className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium">
          {saving ? "Saving..." : "Save as Draft"}
        </button>
        <button onClick={() => handleSave("published")} disabled={saving} className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium">
          {saving ? "Publishing..." : "Publish"}
        </button>
      </div>
    </div>
  );
}
