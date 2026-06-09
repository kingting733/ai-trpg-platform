"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface ChatMessage {
  id: string;
  room_id: string;
  user_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

/**
 * Out-of-character player chat for a game room. Self-contained: renders its own
 * floating toggle button (with an unread badge) and a slide-over drawer. Live
 * updates arrive via a Supabase Realtime subscription on room_messages, which
 * stays active even while the drawer is closed so the unread count keeps ticking.
 *
 * These messages are NOT part of story_logs and are never sent to the AI GM.
 */
export function ChatDrawer({
  roomId,
  currentUserId,
  authorName,
}: {
  roomId: string;
  currentUserId: string | null;
  authorName: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const openRef = useRef(open);
  openRef.current = open;
  const listEndRef = useRef<HTMLDivElement>(null);

  const addMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    if (!openRef.current && m.user_id !== currentUserId) {
      setUnread((u) => u + 1);
    }
  }, [currentUserId]);

  // Initial load + realtime subscription (kept alive regardless of open state).
  useEffect(() => {
    const supabase = createClient();
    let active = true;

    (async () => {
      const { data } = await supabase
        .from("room_messages")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (active && data) setMessages(data as ChatMessage[]);
    })();

    const channel = supabase
      .channel(`room-chat-${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "room_messages", filter: `room_id=eq.${roomId}` },
        (payload) => addMessage(payload.new as ChatMessage),
      )
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [roomId, addMessage]);

  // Auto-scroll to newest when open / on new message.
  useEffect(() => {
    if (open) listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next) setUnread(0);
      return next;
    });
  }

  async function send() {
    const body = draft.trim();
    if (!body || !currentUserId || sending) return;
    setSending(true);
    setDraft("");
    const supabase = createClient();
    const { data, error } = await supabase
      .from("room_messages")
      .insert({ room_id: roomId, user_id: currentUserId, author_name: authorName, body })
      .select("*")
      .single();
    // Optimistic echo — realtime will dedupe by id.
    if (!error && data) addMessage(data as ChatMessage);
    setSending(false);
  }

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={toggle}
        className="fixed bottom-6 right-6 z-40 w-13 h-13 rounded-full flex items-center justify-center transition-all hover:brightness-110"
        style={{
          width: 52, height: 52,
          background: "linear-gradient(180deg,#1c1813,#0f0c08)",
          border: "1px solid rgba(201,169,110,0.45)",
          boxShadow: "0 4px 18px rgba(0,0,0,0.5), 0 0 16px rgba(201,169,110,0.12)",
        }}
        title="玩家聊天室"
      >
        <span className="text-xl">💬</span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
            style={{ background: "#b91c1c", color: "#fff", border: "1px solid #0f0c08" }}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 z-40" style={{ background: "rgba(5,4,2,0.45)" }} onClick={() => setOpen(false)} />
      )}

      {/* Slide-over drawer */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col transition-transform duration-300"
        style={{
          width: "min(360px, 90vw)",
          transform: open ? "translateX(0)" : "translateX(105%)",
          background: "linear-gradient(150deg,#1c1813 0%,#13100b 55%,#0f0c08 100%)",
          borderLeft: "1px solid #2e2416",
          boxShadow: "-8px 0 40px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid #2e2416" }}>
          <div className="flex items-center gap-2">
            <span className="text-lg">💬</span>
            <div>
              <h3 className="font-serif text-sm" style={{ color: "#e4d8be", letterSpacing: "0.05em" }}>玩家聊天室</h3>
              <p className="text-[10px] text-zinc-600">場外討論 · 主持人看不到</p>
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">✕</button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5 min-h-0">
          {messages.length === 0 ? (
            <p className="text-zinc-700 text-xs text-center mt-8 italic">還沒有訊息。打個招呼吧 👋</p>
          ) : (
            messages.map((m) => {
              const mine = m.user_id === currentUserId;
              return (
                <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                  {!mine && <span className="text-[10px] text-gold/70 mb-0.5 px-1">{m.author_name}</span>}
                  <div className="max-w-[80%] rounded-lg px-3 py-1.5 text-sm break-words"
                    style={mine
                      ? { background: "rgba(201,169,110,0.16)", border: "1px solid rgba(201,169,110,0.3)", color: "#f0e6d2" }
                      : { background: "rgba(14,12,8,0.7)", border: "1px solid #2a2010", color: "#d4cbb8" }}>
                    {m.body}
                  </div>
                </div>
              );
            })
          )}
          <div ref={listEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 shrink-0 flex gap-2" style={{ borderTop: "1px solid #2e2416" }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={currentUserId ? "輸入訊息…" : "登入後即可聊天"}
            disabled={!currentUserId || sending}
            maxLength={500}
            className="flex-1 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-gold/50 disabled:opacity-50"
            style={{ background: "rgba(14,12,8,0.8)", border: "1px solid #2e2416" }}
          />
          <button
            onClick={send}
            disabled={!currentUserId || !draft.trim() || sending}
            className="px-4 rounded-lg text-sm shrink-0 transition-all disabled:opacity-40 hover:brightness-110"
            style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07" }}
          >
            送出
          </button>
        </div>
      </div>
    </>
  );
}
