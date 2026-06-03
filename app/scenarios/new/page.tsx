"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ImportedScenario } from "@/lib/ai/import-scenario";

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

export default function NewScenarioPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("player");

  // Player-facing
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("Normal");
  const [description, setDescription] = useState("");
  const [objective, setObjective] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [estimatedPlayTime, setEstimatedPlayTime] = useState("");
  const [tags, setTags] = useState("");

  // GM-only: World & Story
  const [openingScene, setOpeningScene] = useState("");
  const [background, setBackground] = useState("");
  const [locations, setLocations] = useState("");
  const [npcs, setNpcs] = useState("");
  const [keyItems, setKeyItems] = useState("");

  // GM-only: GM Toolkit
  const [secretRules, setSecretRules] = useState("");
  const [threats, setThreats] = useState("");
  const [traps, setTraps] = useState("");
  const [endingConditions, setEndingConditions] = useState("");
  const [gmNotes, setGmNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // AI Import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);

  function parseLines(text: string): string[] {
    return text.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  function applyImport(d: ImportedScenario) {
    setTitle(d.title ?? "");
    setGenre(d.genre ?? "");
    setDifficulty((d.difficulty as Difficulty) ?? "Normal");
    setDescription(d.description ?? "");
    setObjective(d.objective ?? "");
    setMaxPlayers(d.max_players ?? 4);
    setEstimatedPlayTime(d.estimated_play_time ? String(d.estimated_play_time) : "");
    setTags((d.tags ?? []).join(", "));
    setOpeningScene(d.opening_scene ?? "");
    setBackground(d.background ?? "");
    setLocations((d.locations ?? []).join("\n"));
    setNpcs((d.npcs ?? []).join("\n"));
    setKeyItems((d.key_items ?? []).join("\n"));
    setSecretRules(d.secret_rules ?? "");
    setThreats((d.threats ?? []).join("\n"));
    setTraps((d.traps ?? []).join("\n"));
    setEndingConditions(d.ending_conditions ?? "");
    setGmNotes(d.gm_notes ?? "");
    setActiveTab("player");
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Allow re-selecting the same file later
    e.target.value = "";
    if (!file) return;

    setImportError(null);
    setImportNote(null);
    setSuccess(null);
    setError(null);

    if (file.size > 2 * 1024 * 1024) {
      setImportError("File too large. Maximum size is 2MB.");
      return;
    }

    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/scenarios/import", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) {
        setImportError(json?.error ?? "Import failed.");
        return;
      }
      applyImport(json.scenario as ImportedScenario);
      setImportNote(
        `Imported from "${file.name}". The AI filled the fields below — review and edit everything, then Save as Draft or Publish.` +
          (json.truncated ? " (The document was long, so only the beginning was analyzed.)" : "")
      );
    } catch {
      setImportError("Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  async function handleSave(status: Status) {
    if (!title.trim()) { setActiveTab("player"); setError("Title is required."); return; }
    if (!genre) { setActiveTab("player"); setError("Genre is required."); return; }
    if (!difficulty) { setActiveTab("player"); setError("Difficulty is required."); return; }
    if (!description.trim()) { setActiveTab("player"); setError("Description is required."); return; }
    if (!objective.trim()) { setActiveTab("player"); setError("Objective is required."); return; }
    const mp = Number(maxPlayers);
    if (mp < 1 || mp > 6) { setActiveTab("player"); setError("Max players must be between 1 and 6."); return; }

    setSaving(true);
    setError(null);
    setSuccess(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/auth"); return; }

    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    const ept = estimatedPlayTime ? parseInt(estimatedPlayTime) : null;

    const { data, error: insertError } = await supabase
      .from("scenarios")
      .insert({
        creator_id: user.id,
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
      .select("id")
      .single();

    setSaving(false);
    if (insertError || !data) { setError(insertError?.message ?? "Failed to save"); return; }
    setSuccess(status === "published" ? "Scenario published!" : "Saved as draft.");
    setTimeout(() => router.push("/dashboard"), 900);
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
      <h1 className="text-3xl font-bold text-white mb-2">Create Scenario</h1>
      <p className="text-slate-400 mb-6">Build a new TRPG adventure — fill the form manually, or import a story document to get a head start.</p>

      {/* AI Import */}
      <div className="bg-gradient-to-r from-purple-900/30 to-slate-800/30 border border-purple-800/50 rounded-xl p-5 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <span>✨</span> Import from Story Document
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Upload a <span className="text-slate-300">.txt</span>, <span className="text-slate-300">.md</span>, or{" "}
              <span className="text-slate-300">.docx</span> (max 2MB). The AI reads it and pre-fills the form below.
              Nothing is saved or published automatically — you review everything first.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-medium whitespace-nowrap"
          >
            {importing ? "Analyzing..." : "Upload Document"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.markdown,.docx"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
        {importing && (
          <p className="text-purple-300 text-xs mt-3">Reading the document and asking the AI — this can take a few seconds.</p>
        )}
        {importError && (
          <div className="mt-3 bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-3 py-2">{importError}</div>
        )}
        {importNote && (
          <div className="mt-3 bg-green-900/30 border border-green-700 text-green-300 text-sm rounded-lg px-3 py-2">{importNote}</div>
        )}
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
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Lost Temple" className={inputCls} />
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
            <Field label="Description *" hint="A short summary shown to players browsing scenarios.">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What kind of adventure is this?" className={taCls} />
            </Field>
            <Field label="Objective *" hint="What must players accomplish to win?">
              <textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} placeholder="Reach the inner sanctum and retrieve the Shard before dawn." className={taCls} />
            </Field>
            <Field label="Tags (comma-separated)" hint="Help players find your scenario. e.g. dungeon, solo-friendly, dark">
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="dungeon, solo-friendly, dark, investigation" className={inputCls} />
            </Field>
          </div>
        )}

        {activeTab === "world" && (
          <div className="flex flex-col gap-4">
            {gmBanner}
            <Field label="Opening Scene" hint="The AI GM will narrate this as the very first scene. Set the atmosphere vividly.">
              <textarea value={openingScene} onChange={(e) => setOpeningScene(e.target.value)} rows={5}
                placeholder="The party arrives at the base of an ancient moss-covered temple as dusk falls. Torchlight flickers against carved stone faces..."
                className={taCls} />
            </Field>
            <Field label="World Background" hint="History, lore, and world context the AI GM should always know.">
              <textarea value={background} onChange={(e) => setBackground(e.target.value)} rows={5}
                placeholder="Deep in the jungle, a long-forgotten temple has been rediscovered. Legends say it holds the Shard of Eternity..."
                className={taCls} />
            </Field>
            <Field label="Key Locations (one per line)" hint="Locations the AI GM can describe and reference throughout the adventure.">
              <textarea value={locations} onChange={(e) => setLocations(e.target.value)} rows={4}
                placeholder={"The Entrance Hall — first room, fire pits and statues\nThe Throne Room — final confrontation\nThe Library — ancient tomes and clues"}
                className={taCls} />
            </Field>
            <Field label="NPCs (one per line)" hint="Non-player characters with brief personality/role notes.">
              <textarea value={npcs} onChange={(e) => setNpcs(e.target.value)} rows={4}
                placeholder={"Elder Moros — cryptic guide, knows the temple's secret\nCaptain Draven — hostile guard captain, STR 16\nThia — imprisoned informant, will trade info for freedom"}
                className={taCls} />
            </Field>
            <Field label="Key Items (one per line)" hint="Items the AI GM can introduce as players explore.">
              <textarea value={keyItems} onChange={(e) => setKeyItems(e.target.value)} rows={3}
                placeholder={"The Shard of Eternity — the main objective\nThe Iron Key — opens the vault door\nThe Ancient Map — reveals a hidden passage"}
                className={taCls} />
            </Field>
          </div>
        )}

        {activeTab === "gm" && (
          <div className="flex flex-col gap-4">
            {gmBanner}
            <Field label="Secret Rules" hint="Pacing guidelines, tone instructions, and mechanical rules for the AI GM.">
              <textarea value={secretRules} onChange={(e) => setSecretRules(e.target.value)} rows={4}
                placeholder={"This is a horror scenario — build tension slowly, never show the monster directly at first.\nSAN checks trigger if players witness supernatural events.\nLuck checks determine random encounter timing."}
                className={taCls} />
            </Field>
            <Field label="Threats & Enemies (one per line)" hint="Enemies and dangers the AI GM can deploy.">
              <textarea value={threats} onChange={(e) => setThreats(e.target.value)} rows={3}
                placeholder={"The Shadow Wraith — invulnerable to physical attack, flees light\nCorrupt Temple Guards — STR 14, AGI 10, patrol in pairs\nThe Stone Golem — wakes if players make loud noises"}
                className={taCls} />
            </Field>
            <Field label="Traps & Hazards (one per line)" hint="Traps the AI GM can describe as players explore.">
              <textarea value={traps} onChange={(e) => setTraps(e.target.value)} rows={3}
                placeholder={"Pressure plate — dart volley, AGI DC 14 to dodge\nFalling stone slab — blocks passage, STR DC 16 to hold\nPoison mist — 1 SAN loss per round until exit"}
                className={taCls} />
            </Field>
            <Field label="Ending Conditions" hint="Define win and loss conditions the AI GM should work toward.">
              <textarea value={endingConditions} onChange={(e) => setEndingConditions(e.target.value)} rows={3}
                placeholder={"Victory: retrieve the Shard and escape before dawn.\nFailure: all characters die, or the temple collapses with the party inside."}
                className={taCls} />
            </Field>
            <Field label="Additional GM Notes" hint="Any other context, mood notes, or special instructions for the AI GM.">
              <textarea value={gmNotes} onChange={(e) => setGmNotes(e.target.value)} rows={4}
                placeholder="Reward creative problem-solving. If players find the hidden passage early, fast-track to the final confrontation. Reference character backgrounds when possible..."
                className={taCls} />
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
          {saving ? "Publishing..." : "Publish"}
        </button>
      </div>
    </div>
  );
}
