import Link from "next/link";

export default function DashboardPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Creator Dashboard</h1>
          <p className="text-slate-400 mt-1">Manage your scenarios</p>
        </div>
        <Link
          href="/scenarios/new"
          className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg font-medium"
        >
          + New Scenario
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total Scenarios", value: "0" },
          { label: "Published", value: "0" },
          { label: "Total Plays", value: "0" },
        ].map((s) => (
          <div key={s.label} className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
            <div className="text-2xl font-bold text-white">{s.value}</div>
            <div className="text-slate-400 text-sm mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl">
        <div className="p-5 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Your Scenarios</h2>
        </div>
        <div className="p-12 text-center text-slate-500">
          <div className="text-4xl mb-3">📖</div>
          <p>No scenarios yet. Create your first one!</p>
          <Link href="/scenarios/new" className="text-purple-400 hover:text-purple-300 text-sm mt-2 inline-block">
            Create Scenario →
          </Link>
        </div>
      </div>
    </div>
  );
}
