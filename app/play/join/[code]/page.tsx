"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function JoinRoomPage({ params }: { params: { code: string } }) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "joining" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function joinRoom() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/play"); return; }

      // Find room by code
      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .select("*")
        .eq("room_code", params.code.toUpperCase())
        .single();

      if (roomError || !room) {
        setError("Room not found. Check the code and try again.");
        setStatus("error");
        return;
      }

      if (room.status === "completed") {
        setError("This room has already ended.");
        setStatus("error");
        return;
      }

      // Check if already in room
      const { data: existing } = await supabase
        .from("room_players")
        .select("id")
        .eq("room_id", room.id)
        .eq("user_id", user.id)
        .single();

      if (!existing) {
        // Check capacity
        const { count } = await supabase
          .from("room_players")
          .select("*", { count: "exact", head: true })
          .eq("room_id", room.id);

        if ((count ?? 0) >= room.max_players) {
          setError("This room is full.");
          setStatus("error");
          return;
        }

        await supabase.from("room_players").insert({ room_id: room.id, user_id: user.id });
      }

      router.push(`/rooms/${room.id}/lobby`);
    }
    joinRoom();
  }, [params.code, router]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        {status === "loading" && <p className="text-slate-400 text-lg">Joining room <span className="font-mono text-white">{params.code}</span>...</p>}
        {status === "error" && (
          <div>
            <p className="text-red-400 text-lg mb-4">{error}</p>
            <button onClick={() => router.push("/play/hub")} className="text-purple-400 hover:text-purple-300">← Back to Hub</button>
          </div>
        )}
      </div>
    </div>
  );
}
