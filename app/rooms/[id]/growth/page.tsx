"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SKILL_ZH_BY_KEY } from "@/lib/game/skills";

interface EligibleSkill { key: string; name: string; current: number; }
interface Claim { skill_key: string; d100_roll: number; old_value: number; gain: number; new_value: number; }
interface GrowthResult {
  skillKey: string; skillName: string; roll: number;
  oldValue: number; improved: boolean; gain: number; newValue: number;
}

export default function GrowthPage({ params }: { params: { id: string } }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eligible, setEligible] = useState<EligibleSkill[]>([]);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState<GrowthResult | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/rooms/${params.id}/growth`);
        const data = await res.json();
        if (!res.ok) { setError(data.error ?? "無法載入成長頁。"); setLoading(false); return; }
        setEligible(data.eligible ?? []);
        setClaim(data.claim ?? null);
      } catch {
        setError("無法載入成長頁。");
      }
      setLoading(false);
    }
    load();
  }, [params.id]);

  async function doGrowth() {
    if (!selected || rolling) return;
    setRolling(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${params.id}/growth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillKey: selected }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "成長檢定失敗。"); setRolling(false); return; }
      setResult(data as GrowthResult);
    } catch {
      setError("成長檢定失敗。");
    }
    setRolling(false);
  }

  if (loading) return <div className="text-center text-slate-400 py-20">載入成長資料中...</div>;

  return (
    <div className="max-w-lg mx-auto py-10">
      <div className="text-center mb-6">
        <div className="text-4xl mb-2">📈</div>
        <h1 className="text-2xl font-bold text-white mb-1">角色成長</h1>
        <p className="text-slate-400 text-sm">
          挑選一個你在本場冒險中<span className="text-amber-400">成功使用過</span>的技能，進行成長檢定。<br />
          擲 d100，若骰值<span className="text-amber-400">高於</span>目前技能值，技能永久提升 1d10。
        </p>
        <p className="text-slate-500 text-xs mt-1">每位調查員每場冒險只能成長一次。</p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>
      )}

      {/* Already claimed (this story) — show the historical result */}
      {claim && !result && (
        <div className="bg-slate-800/60 border border-amber-700 rounded-xl p-5 mb-4 text-center">
          <p className="text-slate-300 text-sm mb-2">此調查員已在本場冒險中成長過：</p>
          <ResultDetail
            name={SKILL_ZH_BY_KEY[claim.skill_key] ?? claim.skill_key}
            roll={claim.d100_roll}
            oldValue={claim.old_value}
            improved={claim.gain > 0}
            gain={claim.gain}
            newValue={claim.new_value}
          />
        </div>
      )}

      {/* Live result of a growth just performed */}
      {result && (
        <div className={`bg-slate-800/60 border rounded-xl p-5 mb-4 text-center ${result.improved ? "border-emerald-600" : "border-slate-600"}`}>
          <ResultDetail
            name={result.skillName}
            roll={result.roll}
            oldValue={result.oldValue}
            improved={result.improved}
            gain={result.gain}
            newValue={result.newValue}
          />
        </div>
      )}

      {/* Skill picker — only when there's an unclaimed growth available */}
      {!claim && !result && (
        eligible.length === 0 ? (
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 text-center text-slate-400 text-sm mb-4">
            本局沒有可成長的技能。<br />
            <span className="text-slate-500 text-xs">（需在冒險中至少成功使用過一個技能，且該技能尚未達上限 99。）</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2 mb-4">
            {eligible.map((s) => {
              const isSel = selected === s.key;
              const improveChance = Math.max(0, 100 - s.current);
              return (
                <button
                  key={s.key}
                  onClick={() => setSelected(isSel ? null : s.key)}
                  disabled={rolling}
                  className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-all text-left ${isSel ? "border-amber-400 bg-amber-900/20 ring-1 ring-amber-400" : "border-slate-700 bg-slate-800/50 hover:border-slate-500"}`}
                >
                  <div>
                    <span className="text-white font-medium">{s.name}</span>
                    <span className="text-slate-500 text-xs ml-2">提升機率 ~{improveChance}%</span>
                  </div>
                  <span className="text-slate-300 text-sm">目前 <b className="text-white">{s.current}</b></span>
                </button>
              );
            })}
          </div>
        )
      )}

      {/* Roll button */}
      {!claim && !result && eligible.length > 0 && (
        <button
          onClick={doGrowth}
          disabled={!selected || rolling}
          className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold mb-4"
        >
          {rolling ? "擲骰中..." : selected ? "進行成長檢定 🎲" : "選擇一個技能"}
        </button>
      )}

      {/* Navigation */}
      <div className="flex gap-3">
        <Link href="/characters" className="flex-1 text-center border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white py-2.5 rounded-lg text-sm">
          我的調查員
        </Link>
        <Link href="/play/hub" className="flex-1 text-center border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white py-2.5 rounded-lg text-sm">
          遊戲大廳
        </Link>
      </div>
    </div>
  );
}

function ResultDetail({
  name, roll, oldValue, improved, gain, newValue,
}: { name: string; roll: number; oldValue: number; improved: boolean; gain: number; newValue: number; }) {
  return (
    <div>
      <div className="text-lg font-bold text-white mb-1">{name}</div>
      <div className="text-sm text-slate-400 mb-3">
        d100 = <b className="text-white">{roll}</b> vs 目前 <b className="text-white">{oldValue}</b>
      </div>
      {improved ? (
        <div className="text-emerald-300 font-semibold text-lg">
          ✓ 成長成功！+{gain}　<span className="text-white">{oldValue} → {newValue}</span>
        </div>
      ) : (
        <div className="text-slate-400">
          骰值未超過技能值，本次沒有提升。<span className="text-slate-500">（{oldValue} 維持不變）</span>
        </div>
      )}
    </div>
  );
}
