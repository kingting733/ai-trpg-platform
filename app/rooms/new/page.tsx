"use client";

export default function NewRoomPage() {
  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-3xl font-bold text-white mb-2">Create Room</h1>
      <p className="text-slate-400 mb-8">Set up a new game room for your adventure.</p>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 flex flex-col gap-5">
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
          <div className="text-xs text-slate-500 mb-1">Scenario</div>
          <div className="text-white font-medium">The Lost Temple</div>
          <div className="text-xs text-slate-400 mt-0.5">Fantasy</div>
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1">Room Name</label>
          <input
            type="text"
            placeholder="e.g. Friday Night Dungeon Run"
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1">Max Players</label>
          <input
            type="number"
            min={2}
            max={8}
            defaultValue={4}
            className="w-32 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
          />
        </div>

        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
          <div className="text-xs text-slate-500 mb-1">Room Code (auto-generated)</div>
          <div className="text-2xl font-mono font-bold text-purple-400 tracking-widest">XXXXX</div>
          <div className="text-xs text-slate-500 mt-1">Share this code with your friends</div>
        </div>

        <button className="w-full bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-lg font-medium">
          Create Room
        </button>
      </div>
    </div>
  );
}
