"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface ActiveRoom {
  id: string;
  name: string;
  room_code: string;
  scenarios: { title: string } | null;
}

export function ActiveGamePopup() {
  const pathname = usePathname();
  const router = useRouter();
  const [room, setRoom] = useState<ActiveRoom | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Don't show while already in the game room or lobby
  const isInGame =
    pathname.includes("/rooms/") ||
    pathname.startsWith("/play/join");

  useEffect(() => {
    // Reset dismissed state on every page navigation
    setDismissed(false);
  }, [pathname]);

  useEffect(() => {
    if (isInGame) { setRoom(null); return; }

    async function check() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: rpData } = await supabase
        .from("room_players")
        .select("room_id")
        .eq("user_id", user.id);

      const roomIds = (rpData ?? []).map((r: { room_id: string }) => r.room_id);
      if (roomIds.length === 0) return;

      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: roomData } = await supabase
        .from("rooms")
        .select("id, name, room_code, scenarios(title)")
        .in("id", roomIds)
        .eq("status", "in_progress")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (roomData) setRoom(roomData as unknown as ActiveRoom);
    }
    check();
  }, [pathname, isInGame]);

  if (!room || dismissed || isInGame) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 animate-in">
      <div className="bg-slate-900 border border-purple-600 rounded-xl shadow-2xl shadow-purple-900/40 p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0 mt-1" />
            <div>
              <p className="text-white font-semibold text-sm">{room.name}</p>
              <p className="text-slate-400 text-xs">{room.scenarios?.title ?? "Adventure"} · {room.room_code}</p>
            </div>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-slate-500 hover:text-slate-300 text-lg leading-none shrink-0"
          >
            ×
          </button>
        </div>
        <p className="text-slate-400 text-xs mb-3">你有一場冒險正在進行中。</p>
        <button
          onClick={() => router.push(`/rooms/${room.id}`)}
          className="w-full bg-purple-600 hover:bg-purple-500 text-white py-2 rounded-lg text-sm font-medium transition-colors"
        >
          返回遊戲 →
        </button>
      </div>
    </div>
  );
}
