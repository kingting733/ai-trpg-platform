import Link from "next/link";

export default function ScenarioDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/scenarios" className="text-slate-400 hover:text-white text-sm">← Back to Library</Link>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs bg-purple-900/50 text-purple-300 border border-purple-800 px-2 py-0.5 rounded">Fantasy</span>
          <span className="text-xs text-slate-500">2-4 players</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-3">The Lost Temple</h1>
        <p className="text-slate-400 leading-relaxed">
          A ancient temple hides deadly secrets and forgotten treasures. Your party must navigate
          traps, solve puzzles, and face the guardian within.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Objective</h3>
          <p className="text-slate-300 text-sm">Reach the inner sanctum and retrieve the ancient artifact before the temple collapses.</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Key Locations</h3>
          <ul className="text-slate-300 text-sm space-y-1">
            <li>• The Entrance Hall</li>
            <li>• The Trap Corridor</li>
            <li>• The Inner Sanctum</li>
          </ul>
        </div>
      </div>

      <div className="flex gap-4">
        <Link
          href={`/rooms/new?scenario=${params.id}`}
          className="flex-1 bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-lg font-medium text-center"
        >
          Create Room
        </Link>
        <button className="flex-1 border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white py-3 rounded-lg font-medium">
          Join Existing Room
        </button>
      </div>
    </div>
  );
}
