import Link from "next/link";

const MOCK_SCENARIOS = [
  { id: "1", title: "The Lost Temple", genre: "Fantasy", description: "A ancient temple hides deadly secrets and forgotten treasures.", playerCount: "2-4" },
  { id: "2", title: "Neon Shadows", genre: "Cyberpunk", description: "Navigate a corrupt megacity where corporations rule everything.", playerCount: "2-6" },
  { id: "3", title: "The Haunting", genre: "Horror", description: "Investigate strange occurrences in an abandoned mansion.", playerCount: "2-4" },
];

export default function ScenariosPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Scenario Library</h1>
          <p className="text-slate-400 mt-1">Choose your adventure</p>
        </div>
        <div className="flex gap-2">
          {["All", "Fantasy", "Cyberpunk", "Horror", "Sci-Fi"].map((g) => (
            <button key={g} className="px-3 py-1.5 text-sm rounded-md border border-slate-600 text-slate-300 hover:border-purple-500 hover:text-white">
              {g}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {MOCK_SCENARIOS.map((s) => (
          <Link key={s.id} href={`/scenarios/${s.id}`}>
            <div className="bg-slate-800/50 border border-slate-700 hover:border-purple-500 rounded-xl p-6 transition-colors cursor-pointer h-full">
              <div className="flex items-start justify-between mb-3">
                <span className="text-xs bg-purple-900/50 text-purple-300 border border-purple-800 px-2 py-0.5 rounded">
                  {s.genre}
                </span>
                <span className="text-xs text-slate-500">{s.playerCount} players</span>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{s.title}</h3>
              <p className="text-slate-400 text-sm">{s.description}</p>
              <div className="mt-4 text-purple-400 text-sm font-medium">View Details →</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
