"use client";
// Join-by-code, as a modal.
//
// This used to be a whole route (/play/join/[code]): the hub pushed you to a
// bare centred page that immediately ran the join and, on failure, showed an
// error with a "back to lobby" link. That page had no theme styling and cost a
// full navigation each way just to surface a one-line error. Joining is a
// single form + a single query, so it lives here now — failures land the player
// back on the input with the code still typed, instead of on a dead-end page.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function JoinRoomModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);

  async function join() {
    const roomCode = code.trim().toUpperCase();
    if (roomCode.length < 4 || busy) return;
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login?next=/play/hub"); return; }

    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("id, status, max_players")
      .eq("room_code", roomCode)
      .maybeSingle();

    if (roomError || !room) {
      setError("找不到此房間，請確認代碼後再試。");
      setBusy(false);
      return;
    }
    if (room.status === "completed") {
      setError("此房間已結束。");
      setBusy(false);
      return;
    }

    // Already a member? Then capacity doesn't apply — just go back in.
    const { data: existing } = await supabase
      .from("room_players")
      .select("id")
      .eq("room_id", room.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!existing) {
      const { count } = await supabase
        .from("room_players")
        .select("*", { count: "exact", head: true })
        .eq("room_id", room.id);

      if ((count ?? 0) >= room.max_players) {
        setError("此房間已滿。");
        setBusy(false);
        return;
      }

      const { error: insErr } = await supabase
        .from("room_players")
        .insert({ room_id: room.id, user_id: user.id });
      if (insErr) {
        // Never swallow this: a policy failure here looks exactly like "nothing
        // happened" to the player, which is the worst possible feedback.
        console.error("[join-room] insert failed", insErr);
        setError("加入失敗，請稍後再試。");
        setBusy(false);
        return;
      }
    }

    router.push(`/rooms/${room.id}/lobby`);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.72)" }}
      role="dialog"
      aria-modal="true"
      aria-label="加入房間"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{
          background: "#0c0a07",
          border: "1px solid rgba(201,169,110,0.3)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-gold font-serif text-lg">加入房間</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="text-zinc-600 hover:text-zinc-300 text-xl leading-none shrink-0"
          >
            ×
          </button>
        </div>
        <p className="text-zinc-500 text-sm mb-4">輸入朋友給你的房間代碼。</p>

        <input
          ref={inputRef}
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") join(); }}
          placeholder="XXXXXX"
          maxLength={6}
          disabled={busy}
          className="w-full rounded-lg px-3 py-2.5 text-center font-mono text-xl tracking-[0.3em] uppercase text-zinc-100 placeholder-zinc-700 focus:outline-none disabled:opacity-50"
          style={{ background: "#161310", border: "1px solid rgba(201,169,110,0.25)" }}
        />

        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

        <button
          type="button"
          onClick={join}
          disabled={code.trim().length < 4 || busy}
          className="w-full mt-4 py-2.5 rounded-lg text-sm font-medium text-surface-dark disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          style={{ background: "#c9a96e" }}
        >
          {busy ? "加入中…" : "加入"}
        </button>
      </div>
    </div>
  );
}
