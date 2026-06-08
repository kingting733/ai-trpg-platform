"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Fallback manual character creation with default CoC-style stats.
// The primary path is /rooms/[id]/select-card (uses your rolled character card).
export default function CharacterCreationPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [charName, setCharName] = useState("");
  const [background, setBackground] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function check() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data } = await supabase
        .from("characters")
        .select("id")
        .eq("user_id", user.id)
        .eq("room_id", params.id)
        .single();
      if (data) { router.push(`/rooms/${params.id}`); return; }
      setChecking(false);
    }
    check();
  }, [params.id, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!charName.trim()) return;
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    // Default stats: all core stats at 50, derived values calculated.
    const defaults = {
      str: 50, con: 50, siz: 65, dex: 50, app: 50,
      int: 65, pow: 50, edu: 65, luck: 50,
      hp: 11,  // floor((50+65)/10)
      san: 50, // = pow
      mp: 10,  // floor(50/5)
      skills: {},
    };

    const { error: insertError } = await supabase.from("characters").insert({
      user_id: user.id,
      room_id: params.id,
      name: charName.trim(),
      background: background.trim() || null,
      ...defaults,
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    const { data: char } = await supabase
      .from("characters")
      .select("id")
      .eq("user_id", user.id)
      .eq("room_id", params.id)
      .single();

    if (char) {
      await supabase
        .from("room_players")
        .update({ character_id: char.id })
        .eq("room_id", params.id)
        .eq("user_id", user.id);
    }

    router.push(`/rooms/${params.id}`);
  }

  if (checking) return <div className="text-center text-slate-400 py-20">載入中...</div>;

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-3xl font-bold text-white mb-2">建立角色</h1>
      <p className="text-slate-400 mb-2 text-sm">輸入名稱即可加入。屬性將使用預設值（均為平均值）。</p>
      <p className="text-slate-500 text-xs mb-6">
        若想使用自己抽到的調查員，請前往{" "}
        <Link href={`/rooms/${params.id}/select-card`} className="text-zinc-100 hover:text-white underline">
          選擇調查員
        </Link>
        。
      </p>

      <form onSubmit={handleSubmit}>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-4 flex flex-col gap-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">角色名稱 *</label>
            <input
              value={charName}
              onChange={(e) => setCharName(e.target.value)}
              placeholder="例：木靈·凱拉"
              required
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">背景故事（選填）</label>
            <textarea
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              rows={3}
              placeholder="簡述你角色的過去..."
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-zinc-500 resize-none"
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading || !charName.trim()}
          className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium"
        >
          {loading ? "建立中..." : "確認角色並進入房間"}
        </button>
      </form>
    </div>
  );
}
