"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
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

  // Don't show while already in the game room or lobby.
  // (/play/join used to be listed here too — joining is now a modal on the hub,
  //  so there is no join route to exclude.)
  const isInGame = pathname.includes("/rooms/");

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
      <div
        className="rounded-xl p-4"
        style={{
          background: "#0c0a07",
          border: "1px solid rgba(201,169,110,0.3)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
        }}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse shrink-0 mt-1.5" />
            <div className="min-w-0">
              <p className="text-zinc-100 font-serif text-sm truncate">{room.name}</p>
              <p className="text-zinc-500 text-xs truncate">
                {room.scenarios?.title ?? "冒險"}
                <span className="text-zinc-700 mx-1">·</span>
                <span className="font-mono">{room.room_code}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="關閉"
            className="text-zinc-600 hover:text-zinc-300 text-xl leading-none shrink-0"
          >
            ×
          </button>
        </div>
        <p className="text-zinc-500 text-xs mb-3">你有一場冒險正在進行中。</p>
        <button
          type="button"
          onClick={() => router.push(`/rooms/${room.id}`)}
          className="w-full py-2 rounded-lg text-sm font-medium text-surface-dark transition-opacity hover:opacity-90 inline-flex items-center justify-center gap-1"
          style={{ background: "#c9a96e" }}
        >
          返回遊戲 <ArrowRight size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
