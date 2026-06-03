"use client";
import { useState } from "react";

const GENRES = ["Fantasy", "Cyberpunk", "Horror", "Sci-Fi", "Mystery", "Historical", "Other"];

export default function NewScenarioPage() {
  const [activeTab, setActiveTab] = useState<"basic" | "world" | "npcs" | "rules">("basic");

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-2">Create Scenario</h1>
      <p className="text-slate-400 mb-8">Build a new TRPG adventure for players to explore.</p>

      <div className="flex gap-1 mb-6 bg-slate-900 rounded-lg p-1">
        {(["basic", "world", "npcs", "rules"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 rounded-md text-sm font-medium capitalize transition-colors ${
              activeTab === tab ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {tab === "basic" ? "Basic Info" : tab === "world" ? "World" : tab === "npcs" ? "NPCs" : "Rules"}
          </button>
        ))}
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        {activeTab === "basic" && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Title *</label>
              <input type="text" placeholder="e.g. The Lost Temple" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500" />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Genre *</label>
              <select className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500">
                <option value="">Select genre...</option>
                {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Description *</label>
              <textarea rows={3} placeholder="A short summary shown to players browsing scenarios..." className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none" />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Objective</label>
              <textarea rows={2} placeholder="What must players accomplish to complete this scenario?" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none" />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Max Players</label>
              <input type="number" min={2} max={8} defaultValue={4} className="w-32 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500" />
            </div>
          </div>
        )}

        {activeTab === "world" && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Background Story</label>
              <textarea rows={6} placeholder="Describe the world, history, and context of your scenario..." className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none" />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-2">Locations</label>
              <div className="border border-dashed border-slate-600 rounded-lg p-4 text-center text-slate-500 text-sm">
                Location editor coming soon
              </div>
            </div>
          </div>
        )}

        {activeTab === "npcs" && (
          <div>
            <div className="border border-dashed border-slate-600 rounded-lg p-8 text-center text-slate-500 text-sm">
              <div className="text-3xl mb-2">🧙</div>
              NPC editor coming soon
            </div>
          </div>
        )}

        {activeTab === "rules" && (
          <div>
            <label className="block text-sm text-slate-400 mb-1">Custom Rules / Notes for AI GM</label>
            <textarea rows={8} placeholder="Any special rules or instructions for this scenario..." className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none" />
          </div>
        )}
      </div>

      <div className="flex gap-3 mt-6">
        <button className="flex-1 bg-purple-600 hover:bg-purple-500 text-white py-2.5 rounded-lg font-medium">
          Save as Draft
        </button>
        <button className="flex-1 border border-slate-600 hover:border-slate-400 text-slate-300 py-2.5 rounded-lg font-medium">
          Publish
        </button>
      </div>
    </div>
  );
}
