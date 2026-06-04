"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const GENRES = ["Fantasy", "Cyberpunk", "Horror", "Sci-Fi", "Mystery", "Historical", "Other"];
const DIFFICULTIES = ["Story", "Normal", "Hard", "Nightmare"] as const;
type Difficulty = typeof DIFFICULTIES[number];
type Tab = "player" | "world" | "gm";
type Status = "draft" | "published";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-slate-400 mb-1">{label}</label>
      {hint && <p className="text-xs text-slate-500 mb-2">{hint}</p>}
      {children}
    </div>
  );
}

const inputCls = "w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500";
const taCls = `${inputCls} resize-none`;

export default function EditScenarioPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("player");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("Normal");
  const [description, setDescription] = useState("");
  const [objective, setObjective] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [estimatedPlayTime, setEstimatedPlayTime] = useState("");
  const [tags, setTags] = useState("");
  const [openingScene, setOpeningScene] = useState("");
  const [background, setBackground] = useState("");
  const [locations, setLocations] = useState("");
  const [npcs, setNpcs] = useState("");
  const [keyItems, setKeyItems] = useState("");
  const [secretRules, setSecretRules] = useState("");
  const [threats, setThreats] = useState("");
  const [traps, setTraps] = useState("");
  const [endingConditions, setEndingConditions] = useState("");
  const [gmNotes, setGmNotes] = useState("");
  const [currentStatus, setCurrentStatus] = useState<Status>("draft");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data } = await supabase
        .from("scenarios")
        .select("*")
        .eq("id", params.id)
        .eq("creator_id", user.id)
        .single();

      if (!data) { setNotFound(true); setLoading(false); return; }

      setTitle(data.title ?? "");
      setGenre(data.genre ?? "");
      setDifficulty((data.difficulty as Difficulty) ?? "Normal");
      setDescription(data.description ?? "");
      setObjective(data.objective ?? "");
      setMaxPlayers(data.max_players ?? 4);
      setEstimatedPlayTime(data.estimated_play_time ? String(data.estimated_play_time) : "");
      setTags(Array.isArray(data.tags) ? data.tags.join(", ") : "");
      setOpeningScene(data.opening_scene ?? "");
      setBackground(data.background ?? "");
      setLocations(Array.isArray(data.locations) ? data.locations.join("\n") : "");
      setNpcs(Array.isArray(data.npcs) ? data.npcs.join("\n") : "");
      setKeyItems(Array.isArray(data.key_items) ? data.key_items.join("\n") : "");
      setSecretRules(data.secret_rules ?? "");
      setThreats(Array.isArray(data.threats) ? data.threats.join("\n") : "");
      setTraps(Array.isArray(data.traps) ? data.traps.join("\n") : "");
      setEndingConditions(data.ending_conditions ?? "");
      setGmNotes(data.gm_notes ?? "");
      setCurrentStatus(data.status ?? "draft");
      setLoading(false);
    }
    load();
  }, [params.id, router]);

  function parseLines(text: string): string[] {
    return text.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  async function handleSave(status: Status) {
    if (!title.trim()) { setActiveTab("player"); setError("Title is required."); return; }
    if (!genre) { setActiveTab("player"); setError("Genre is required."); return; }
    if (!description.trim()) { setActiveTab("player"); setError("Description is required."); return; }
    if (!objective.trim()) { setActiveTab("player"); setError("Objective is required."); return; }
    const mp = Number(maxPlayers);
    if (mp < 1 || mp > 6) { setActiveTab("player"); setError("Max players must be between 1 and 6."); return; }

    setSaving(true);
    setError(null);
    setSuccess(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    const ept = estimatedPlayTime ? parseInt(estimatedPlayTime) : null;

    const { error: updateError } = await supabase
      .from("scenarios")
      .update({
        title: title.trim(),
        genre,
        difficulty,
        description: description.trim(),
        objective: objective.trim(),
        max_players: mp,
        estimated_play_time: ept || null,
        tags: tagList,
        opening_scene: openingScene.trim() || null,
        background: background.trim() || null,
        locations: parseLines(locations),
        npcs: parseLines(npcs),
        key_items: parseLines(keyItems),
        secret_rules: secretRules.trim() || null,
        threats: parseLines(threats),
        traps: parseLines(traps),
        ending_conditions: endingConditions.trim() || null,
        gm_notes: gmNotes.trim() || null,
        status,
      })
      .eq("id", params.id)
      .eq("creator_id", user.id);

    setSaving(false);
    if (updateError) { setError(updateError.message); return; }
    setSuccess(status === "published" ? "Scenario published!" : "Saved as draft.");
    setCurrentStatus(status);
    setTimeout(() => router.push("/dashboard"), 900);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-slate-500">Loading scenario...</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-400">Scenario not found or you don't have permission to edit it.</p>
        <button onClick={() => router.push("/dashboard")} className="text-purple-400 hover:text-purple-300 text-sm">
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "player", label: "Player Info" },
    { id: "world", label: "World & Story" },
    { id: "gm", label: "GM Toolkit" },
  ];

  const gmBanner = (
    <div className="bg-amber-950/40 border border-amber-900/50 rounded-lg px-4 py-2.5 text-xs text-amber-300/90">
      GM-only — players will NOT see this content on the scenario browse or detail pages.
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Edit Scenario</h1>
          <p className="text-slate-400 mt-1">
            Status: <span className={currentStatus === "published" ? "text-green-400" : "text-slate-400"}>{currentStatus}</span>
          </p>
        </div>
        <button onClick={() => router.push("/dashboard")} className="text-slate-400 hover:text-white text-sm">
          ← Dashboard
        </button>
      </div>

      <div className="flex gap-1 mb-6 bg-slate-900 rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {tab.id !== "player" && <span className="mr-1 opacity-60">🔒</span>}
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3">{error}</div>}
      {success && <div className="mb-4 bg-green-900/30 border border-green-700 text-green-300 text-sm rounded-lg px-4 py-3">{success}</div>}

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        {activeTab === "player" && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Title *">
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Genre *">
                <select value={genre} onChange={(e) => setGenre(e.target.value)} className={inputCls}>
                  <option value="">Select genre...</option>
                  {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Difficulty *">
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)} className={inputCls}>
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Max Players (1–6)">
                <input type="number" value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} min={1} max={6} className={inputCls} />
              </Field>
              <Field label="Est. Play Time (min)">
                <input type="number" value={estimatedPlayTime} onChange={(e) => setEstimatedPlayTime(e.target.value)} placeholder="e.g. 60" className={inputCls} />
              </Field>
            </div>
            <Field label="Description *">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={taCls} />
            </Field>
            <Field label="Objective *">
              <textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} className={taCls} />
            </Field>
            <Field label="Tags (comma-separated)">
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="dungeon, solo-friendly, dark" className={inputCls} />
            </Field>
          </div>
        )}

        {activeTab === "world" && (
          <div className="flex flex-col gap-4">
            {gmBanner}
            <Field label="Opening Scene" hint="The AI GM narrates this as the very first scene.">
              <textarea value={openingScene} onChange={(e) => setOpeningScene(e.target.value)} rows={5} className={taCls} />
            </Field>
            <Field label="World Background" hint="History, lore, and context the AI GM should know.">
              <textarea value={background} onChange={(e) => setBackground(e.target.value)} rows={5} className={taCls} />
            </Field>
            <Field label="Key Locations (one per line)">
              <textarea value={locations} onChange={(e) => setLocations(e.target.value)} rows={4} className={taCls} />
            </Field>
            <Field label="NPCs (one per line)">
              <textarea value={npcs} onChange={(e) => setNpcs(e.target.value)} rows={4} className={taCls} />
            </Field>
            <Field label="Key Items (one per line)">
              <textarea value={keyItems} onChange={(e) => setKeyItems(e.target.value)} rows={3} className={taCls} />
            </Field>
          </div>
        )}

        {activeTab === "gm" && (
          <div className="flex flex-col gap-4">
            {gmBanner}
            <Field label="Secret Rules" hint="Pacing, tone, and mechanical instructions for the AI GM.">
              <textarea value={secretRules} onChange={(e) => setSecretRules(e.target.value)} rows={4} className={taCls} />
            </Field>
            <Field label="Threats & Enemies (one per line)">
              <textarea value={threats} onChange={(e) => setThreats(e.target.value)} rows={3} className={taCls} />
            </Field>
            <Field label="Traps & Hazards (one per line)">
              <textarea value={traps} onChange={(e) => setTraps(e.target.value)} rows={3} className={taCls} />
            </Field>
            <Field label="Ending Conditions">
              <textarea value={endingConditions} onChange={(e) => setEndingConditions(e.target.value)} rows={3} className={taCls} />
            </Field>
            <Field label="Additional GM Notes">
              <textarea value={gmNotes} onChange={(e) => setGmNotes(e.target.value)} rows={4} className={taCls} />
            </Field>
          </div>
        )}
      </div>

      <div className="flex gap-3 mt-6">
        <button onClick={() => handleSave("draft")} disabled={saving}
          className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium">
          {saving ? "Saving..." : "Save as Draft"}
        </button>
        <button onClick={() => handleSave("published")} disabled={saving}
          className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium">
          {saving ? "Updating..." : currentStatus === "published" ? "Update & Keep Published" : "Publish"}
        </button>
      </div>
    </div>
  );
}
