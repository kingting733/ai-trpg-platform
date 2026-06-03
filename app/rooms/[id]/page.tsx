"use client";
import { useState } from "react";

const MOCK_PLAYERS = [
  { name: "Kira Ashwood", speed: 12, hp: 18, san: 15, str: 8, agi: 10, int: 7, cha: 6, luck: 4, isCurrentTurn: true },
  { name: "Marcus Bold", speed: 9, hp: 22, san: 10, str: 14, agi: 6, int: 5, cha: 8, luck: 7, isCurrentTurn: false },
  { name: "Yumi Sato", speed: 7, hp: 12, san: 18, str: 4, agi: 8, int: 15, cha: 10, luck: 3, isCurrentTurn: false },
];

const MOCK_LOG = [
  { type: "system", text: "The adventure begins. You stand at the entrance of the Lost Temple..." },
  { type: "action", player: "Kira Ashwood", text: "I examine the carvings on the entrance door." },
  { type: "gm", text: "The carvings depict a great serpent coiled around a sun. You notice a faint click as your fingers trace the serpent's eye." },
];

export default function RoomPlayPage() {
  const [action, setAction] = useState("");

  return (
    <div className="grid grid-cols-[1fr_300px] gap-6 h-[calc(100vh-8rem)]">
      <div className="flex flex-col gap-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-slate-400 text-sm">Round </span>
            <span className="text-white font-bold">1</span>
            <span className="text-slate-600 mx-2">·</span>
            <span className="text-slate-400 text-sm">Current Turn: </span>
            <span className="text-purple-400 font-bold">Kira Ashwood</span>
          </div>
          <div className="text-xs text-slate-500">Room: <span className="font-mono text-slate-300">ABC12</span></div>
        </div>

        <div className="flex-1 bg-slate-900/50 border border-slate-700 rounded-xl p-5 overflow-y-auto flex flex-col gap-3">
          {MOCK_LOG.map((entry, i) => (
            <div key={i}>
              {entry.type === "system" && (
                <p className="text-slate-400 italic text-sm text-center">{entry.text}</p>
              )}
              {entry.type === "action" && (
                <div className="flex gap-2">
                  <span className="text-purple-400 font-medium text-sm shrink-0">{entry.player}:</span>
                  <span className="text-slate-300 text-sm">{entry.text}</span>
                </div>
              )}
              {entry.type === "gm" && (
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
                  <span className="text-xs text-amber-500 font-medium uppercase tracking-wider block mb-1">GM</span>
                  <p className="text-slate-200 text-sm leading-relaxed">{entry.text}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="Describe your action... (your turn)"
            className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />
          <button className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-3 rounded-lg font-medium">
            Submit
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Turn Order</h3>
          <div className="flex flex-col gap-2">
            {MOCK_PLAYERS.map((p, i) => (
              <div key={p.name} className={`flex items-center gap-2 p-2 rounded-lg text-sm ${p.isCurrentTurn ? "bg-purple-900/40 border border-purple-700" : "border border-transparent"}`}>
                <span className="text-slate-500 w-4">{i + 1}.</span>
                <span className={`flex-1 font-medium ${p.isCurrentTurn ? "text-purple-300" : "text-slate-300"}`}>{p.name}</span>
                <span className="text-xs text-slate-500">SPD {p.speed}</span>
                {p.isCurrentTurn && <span className="text-xs bg-purple-600 text-white px-1.5 py-0.5 rounded">Active</span>}
              </div>
            ))}
          </div>
        </div>

        {MOCK_PLAYERS.map((p) => (
          <div key={p.name} className={`bg-slate-800/50 border rounded-xl p-4 ${p.isCurrentTurn ? "border-purple-700" : "border-slate-700"}`}>
            <h4 className="font-medium text-white mb-3 text-sm">{p.name}</h4>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {([["HP", p.hp], ["SAN", p.san], ["STR", p.str], ["AGI", p.agi], ["INT", p.int], ["CHA", p.cha], ["LUCK", p.luck], ["SPD", p.speed]] as [string, number][]).map(([k, v]) => (
                <div key={k} className="flex justify-between bg-slate-900/50 rounded px-2 py-1">
                  <span className="text-slate-500">{k}</span>
                  <span className="text-slate-300 font-medium">{v}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
