"use client";

const STATS = [
  { key: "hp", label: "HP", desc: "Hit Points — how much damage you can take", default: 10 },
  { key: "san", label: "SAN", desc: "Sanity — mental resilience", default: 10 },
  { key: "str", label: "STR", desc: "Strength — physical power", default: 5 },
  { key: "agi", label: "AGI", desc: "Agility — dodging and reflexes", default: 5 },
  { key: "int", label: "INT", desc: "Intelligence — knowledge and magic", default: 5 },
  { key: "cha", label: "CHA", desc: "Charisma — persuasion and leadership", default: 5 },
  { key: "luck", label: "LUCK", desc: "Luck — chance and fortune", default: 5 },
  { key: "speed", label: "SPEED", desc: "Speed — determines turn order (higher = acts first)", default: 5 },
];

export default function CharacterCreationPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-2">Create Your Character</h1>
      <p className="text-slate-400 mb-8">Define your character before entering the adventure.</p>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-6">
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Character Name *</label>
            <input type="text" placeholder="e.g. Kira Ashwood" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500" />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Background (optional)</label>
            <textarea rows={2} placeholder="A short description of your character's past..." className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none" />
          </div>
        </div>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-1">Stats</h2>
        <p className="text-slate-400 text-sm mb-5">
          Points remaining: <span className="text-purple-400 font-bold">30</span>
        </p>
        <div className="grid grid-cols-2 gap-4">
          {STATS.map((stat) => (
            <div key={stat.key}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-slate-300">{stat.label}</label>
              </div>
              <div className="flex items-center gap-2">
                <button className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 text-white text-lg font-bold flex items-center justify-center">−</button>
                <span className="w-10 text-center text-white font-bold text-lg">{stat.default}</span>
                <button className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 text-white text-lg font-bold flex items-center justify-center">+</button>
              </div>
              <p className="text-xs text-slate-500 mt-1">{stat.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <button className="w-full bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-lg font-medium">
        Confirm Character & Enter Room
      </button>
    </div>
  );
}
