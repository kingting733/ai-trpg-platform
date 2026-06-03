"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Scenario {
  id: string;
  title: string;
  genre: string;
  description: string;
  status: "draft" | "published" | "archived";
  max_players: number;
  created_at: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/auth"); return; }
      const { data } = await supabase
        .from("scenarios")
        .select("*")
        .eq("creator_id", user.id)
        .order("created_at", { ascending: false });
      setScenarios(data ?? []);
      setLoading(false);
    }
    load();
  }, [router]);

  const published = scenarios.filter((s) => s.status === "published").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Creator Dashboard</h1>
          <p className="text-slate-400 mt-1">Manage your scenarios</p>
        </div>
        <Link href="/scenarios/new" className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg font-medium">
          + New Scenario
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total Scenarios", value: scenarios.length },
          { label: "Published", value: published },
          { label: "Drafts", value: scenarios.length - published },
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
        {loading ? (
          <div className="p-12 text-center text-slate-500">Loading...</div>
        ) : scenarios.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <div className="text-4xl mb-3">📖</div>
            <p>No scenarios yet. Create your first one!</p>
            <Link href="/scenarios/new" className="text-purple-400 hover:text-purple-300 text-sm mt-2 inline-block">Create Scenario →</Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-700">
            {scenarios.map((s) => (
              <div key={s.id} className="p-5 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-white truncate">{s.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${
                      s.status === "published"
                        ? "bg-green-900/40 text-green-300 border-green-800"
                        : "bg-slate-700 text-slate-400 border-slate-600"
                    }`}>{s.status}</span>
                  </div>
                  <p className="text-slate-400 text-sm truncate">{s.description}</p>
                </div>
                <span className="text-xs text-slate-500 shrink-0">{s.genre}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
