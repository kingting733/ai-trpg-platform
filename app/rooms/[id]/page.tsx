"use client";
import { useEffect, useState, useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { currentSkillValue, SKILL_KEY_BY_ZH } from "@/lib/game/skills";

interface Character {
  id: string;
  user_id: string;
  name: string;
  hp: number; san: number; mp: number;
  str: number; con: number; siz: number; dex: number; app: number;
  int: number; pow: number; edu: number; luck: number;
  skills: Record<string, number> | null;
  occupation: string | null;
}

interface RollResult {
  requires_check: boolean;
  stat_used:      string | null;
  target:         number | null;  // roll-under value (skill or stat %)
  d100_roll:      number | null;
  outcome:        string | null;
  hp_change:      number;
  san_change:     number;
  consequence_summary: string;
  san_check?: {
    severity_label: string;
    trigger_text?:  string;
    pow:            number;
    roll:           number;
    success:        boolean;
    san_loss:       number;
  } | null;
  attack?: {
    type:          "str" | "fighting";
    skill_label:   string;
    target_name:   string;
    is_npc:        boolean;
    hit:           boolean;
    crit:          boolean;
    dodge_target:  number | null;
    dodge_roll:    number | null;
    dodged:        boolean;
    damage:        number;
    target_hp_after?: number;
    target_died?:  boolean;
  } | null;
}

interface StoryLogEntry {
  id: string;
  entry_type: "system" | "action" | "gm_response" | "location_media";
  content: string;
  character_id: string | null;
  player_id: string | null;
  created_at: string;
  characters?: { name: string } | null;
  roll_result?: RollResult | null;
  media_url?: string | null;
}

interface Room {
  id: string;
  name: string;
  room_code: string;
  status: string;
  current_round: number;
  current_turn_player_id: string | null;
  host_id: string;
  current_choices: string[] | null;
  current_choices_for_player_id: string | null;
  ending_type: string | null;
  ending_title: string | null;
  ending_summary: string | null;
  objectives: { id: string; text: string; required: boolean; scope?: "party" | "each_player" }[] | null;
  objective_progress: Record<string, { done: boolean; round: number | null; character: string | null; by?: Record<string, number> }> | null;
}

interface RoomPlayer {
  user_id: string;
  character_id: string | null;
  turn_order: number | null;
}

// Renders GM text with paragraph breaks and **bold** inline formatting
function StatBar({ label, cur, max, pct, color }: {
  label: string; cur: number; max: number; pct: number; color: string;
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-zinc-400 text-xs">{label}</span>
        <span className="text-zinc-200 text-xs font-bold tabular-nums">{cur}<span className="text-zinc-600">/{max}</span></span>
      </div>
      <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: "#0e0c08" }}>
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function GmText({ content }: { content: string }) {
  const paragraphs = content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return null;
  return (
    <div className="space-y-2">
      {paragraphs.map((para, i) => {
        // Bold header: paragraph that is entirely **...**
        const headerMatch = para.match(/^\*\*(.+?)\*\*$/);
        if (headerMatch) {
          return <p key={i} className="text-gold font-semibold text-sm">{headerMatch[1]}</p>;
        }
        // Inline **bold** within a line
        const parts = para.split(/(\*\*.+?\*\*)/g);
        return (
          <p key={i} className="text-zinc-300 text-sm leading-relaxed">
            {parts.map((part, j) => {
              const m = part.match(/^\*\*(.+?)\*\*$/);
              return m ? <strong key={j} className="text-white font-semibold">{m[1]}</strong> : part;
            })}
          </p>
        );
      })}
    </div>
  );
}

const SKILL_ZH: Record<string, string> = {
  spot_hidden: "偵查", listen: "聆聽", library_use: "圖書館使用",
  psychology: "心理學", persuade: "說服", fast_talk: "話術",
  charm: "魅惑", intimidate: "恐嚇", dodge: "閃避",
  first_aid: "急救", stealth: "潛行", lockpick: "開鎖", drive_auto: "駕駛汽車",
  firearms: "射擊", occult: "神秘學", fighting: "搏鬥",
};

// Grouped skill list for the player's skill-picker, mirroring the GM's 3-slot
// suggested-action structure (調查/感知 · 社交/心理 · 行動/風險).
const SKILL_PICKER: { label: string; keys: string[] }[] = [
  { label: "調查 / 感知", keys: ["spot_hidden", "listen", "library_use", "occult"] },
  { label: "社交 / 心理", keys: ["persuade", "fast_talk", "charm", "intimidate", "psychology"] },
  { label: "行動 / 風險", keys: ["dodge", "stealth", "lockpick", "drive_auto", "first_aid", "fighting", "firearms"] },
];

const STAT_ZH: Record<string, string> = {
  hp: "生命", san: "理智", mp: "魔力",
  str: "力量", con: "體質", siz: "體型", dex: "敏捷", app: "外貌",
  int: "智力", pow: "意志", edu: "教育", luck: "幸運",
};

// ─── Shared occult / aged-parchment styling ─────────────────────────────────
const PANEL: CSSProperties = {
  background: "linear-gradient(150deg,#1c1813 0%,#13100b 55%,#0f0c08 100%)",
  border: "1px solid #2e2416",
  boxShadow: "0 4px 24px rgba(0,0,0,0.45)",
};

// Parchment surface with an ornate inner frame.
function Panel({ children, className = "", style, frame = "rgba(201,169,110,0.14)" }: {
  children: ReactNode; className?: string; style?: CSSProperties; frame?: string;
}) {
  return (
    <div className={`relative rounded-xl ${className}`} style={{ ...PANEL, ...style }}>
      <div className="absolute inset-[6px] rounded-lg pointer-events-none" style={{ border: `1px solid ${frame}` }} />
      <div className="relative">{children}</div>
    </div>
  );
}

// Concentric occult seal glyph.
function Seal({ size = 38, glyph = "✦", className = "" }: { size?: number; glyph?: string; className?: string }) {
  return (
    <div className={`relative shrink-0 flex items-center justify-center text-gold/70 ${className}`} style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full" style={{ border: "1px solid rgba(201,169,110,0.30)" }} />
      <div className="absolute inset-[3px] rounded-full" style={{ border: "1px solid rgba(201,169,110,0.16)" }} />
      <span style={{ fontSize: size * 0.42, lineHeight: 1 }}>{glyph}</span>
    </div>
  );
}

// Decorative paper clip.
function Clip({ className = "" }: { className?: string }) {
  return (
    <div className={`absolute w-3.5 h-7 rounded-full -rotate-12 pointer-events-none z-10 ${className}`}
      style={{ border: "2px solid rgba(201,169,110,0.30)", borderBottom: "none" }} />
  );
}

// Small section header with an occult diamond marker.
function PanelHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-gold/70 text-sm leading-none">◈</span>
      <h3 className="font-serif text-gold text-sm tracking-wide">{title}</h3>
    </div>
  );
}

export default function RoomPlayPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [roomPlayers, setRoomPlayers] = useState<RoomPlayer[]>([]);
  const [storyLog, setStoryLog] = useState<StoryLogEntry[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [myCharacter, setMyCharacter] = useState<Character | null>(null);
  const [actionText, setActionText] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [gmThinking, setGmThinking] = useState(false);
  const [endingGame, setEndingGame] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState<Record<string, boolean>>({});
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  function toggleSkills(id: string) { setSkillsOpen((p) => ({ ...p, [id]: !p[id] })); }

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    setCurrentUserId(user.id);
    setCurrentUserEmail(user.email ?? null);

    const { data: roomData } = await supabase.from("rooms").select("*").eq("id", params.id).single();
    if (!roomData) { router.push("/play/hub"); return; }
    setRoom(roomData);

    const { data: rp } = await supabase.from("room_players").select("user_id, character_id, turn_order").eq("room_id", params.id);
    setRoomPlayers(rp ?? []);

    const { data: chars } = await supabase.from("characters").select("*").eq("room_id", params.id);
    const sortedChars = (chars ?? []).sort((a, b) => b.dex - a.dex);
    setCharacters(sortedChars);

    const myChar = (chars ?? []).find((c: Character) => c.user_id === user.id);
    setMyCharacter(myChar ?? null);

    const { data: logs } = await supabase
      .from("story_logs")
      .select("*, characters(name)")
      .eq("room_id", params.id)
      .order("created_at", { ascending: true });
    setStoryLog((logs as unknown as StoryLogEntry[]) ?? []);
  }, [params.id, router]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 3000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // No auto-scroll — the player controls the scroll position entirely. A manual
  // "jump to latest" button (below) lets them return to the bottom on demand.
  const scrollToBottom = useCallback(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setAtBottom(true);
  }, []);

  const onLogScroll = useCallback(() => {
    const el = logContainerRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  }, []);

  async function initializeTurns() {
    if (!room || initializing) return;
    setInitializing(true);
    const supabase = createClient();

    const sorted = [...characters].sort((a, b) => b.dex - a.dex);
    if (sorted.length === 0) { setInitializing(false); return; }

    for (let i = 0; i < sorted.length; i++) {
      await supabase
        .from("room_players")
        .update({ turn_order: i + 1 })
        .eq("room_id", room.id)
        .eq("user_id", sorted[i].user_id);
    }

    const firstPlayer = sorted[0];
    await supabase
      .from("rooms")
      .update({ current_turn_player_id: firstPlayer.user_id, current_round: 1 })
      .eq("id", room.id);

    await supabase.from("story_logs").insert({
      room_id: room.id,
      round_number: 1,
      entry_type: "system",
      content: `Turn order: ${sorted.map((c) => `${c.name} (DEX ${c.dex})`).join(" → ")}`,
    });

    await fetchAll();

    // GM generates the opening scene
    setGmThinking(true);
    try {
      const res = await fetch("/api/gm/opening", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.id }),
      });
    } catch {
      // non-blocking
    }
    setGmThinking(false);

    await fetchAll();
    setInitializing(false);
  }

  async function submitAction(text?: string, skill?: string | null) {
    const finalText = (text ?? actionText).trim();
    if (!finalText || !room || !myCharacter || !currentUserId) return;
    // An explicit per-call skill wins; otherwise use the manually-picked skill.
    const forcedSkill = skill !== undefined ? skill : selectedSkill;
    setSubmitting(true);
    setActionText("");
    setSelectedSkill(null);
    setSkillMenuOpen(false);

    // All game state changes (action save, turn advance, GM response) happen server-side
    setGmThinking(true);
    try {
      await fetch("/api/gm/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: room.id,
          actionText: finalText,
          actingUserId: currentUserId,
          characterId: myCharacter.id,
          forcedSkill: forcedSkill ?? null,
        }),
      });
    } catch {
      // non-blocking
    }
    setGmThinking(false);

    await fetchAll();
    setSubmitting(false);
  }

  // A GM choice may be tagged like "[偵查] <Name> 翻找抽屜". Pull the skill out so
  // the roll matches the tag, and strip the tag from the action text we submit.
  function submitChoice(choice: string) {
    const m = choice.match(/^\s*[\[【]\s*([^\]】]+?)\s*[\]】]\s*([\s\S]*)$/);
    if (m) {
      const key = SKILL_KEY_BY_ZH[m[1].trim()] ?? null;
      submitAction(m[2].trim() || choice, key);
    } else {
      submitAction(choice, null);
    }
  }

  async function endGame() {
    if (!room || !window.confirm("確定要結束這場冒險嗎？此操作無法撤銷。")) return;
    setEndingGame(true);
    const supabase = createClient();
    await supabase.from("rooms").update({ status: "completed" }).eq("id", room.id);
    await fetchAll();
    setEndingGame(false);
  }

  if (!room) return <div className="text-center text-zinc-600 py-20">載入房間中...</div>;

  // Ending screen
  if (room.status === "completed") {
    return <EndingScreen room={room} storyLog={storyLog} onGrowth={() => router.push(`/rooms/${room.id}/growth`)} onHub={() => router.push("/play/hub")} onScenarios={() => router.push("/scenarios")} onDashboard={() => router.push("/dashboard")} />;
  }

  const iAmDown = (myCharacter?.hp ?? 1) <= 0;
  const iAmInsane = (myCharacter?.san ?? 1) <= 0;
  const iAmDead = iAmDown || iAmInsane;
  // A dead/insane character cannot act; the turn flow skips them server-side.
  const isMyTurn = room.current_turn_player_id === currentUserId && !iAmDead;
  // Choices must belong to the current turn player — guards against stale one-turn-lag choices
  const choicesAreForMe = room.current_choices_for_player_id === currentUserId;
  const sortedByDex = [...characters].sort((a, b) => b.dex - a.dex);
  const currentTurnChar = sortedByDex.find((c) => c.user_id === room.current_turn_player_id);
  const allHaveChars = roomPlayers.length > 0 && roomPlayers.every((p) => p.character_id);
  const needsInit = room.status === "in_progress" && room.current_round === 0 && allHaveChars;
  const hasStarted = room.current_round > 0;

  return (
    <>
    {/* Faint occult texture behind the whole play view */}
    <div className="fixed inset-0 -z-10 pointer-events-none opacity-[0.04]" aria-hidden
      style={{ backgroundImage: "radial-gradient(circle, #c9a96e 1px, transparent 1px)", backgroundSize: "42px 42px" }} />
    <div className="grid grid-cols-[1fr_280px] gap-4 h-[calc(100vh-7rem)]">
      {/* Main area */}
      <div className="flex flex-col gap-3 min-h-0">
        {/* Header */}
        <Panel className="px-5 py-3 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm">
              <Seal size={34} glyph="✶" />
              <span className="text-zinc-400">回合 <span className="text-gold font-bold">{room.current_round || "—"}</span></span>
              <span className="text-zinc-700">·</span>
              {currentTurnChar ? (
                <span className="text-zinc-400">
                  行動者：<span className={`font-bold ${isMyTurn ? "text-emerald-400" : "text-gold"}`}>
                    {isMyTurn ? "輪到你了！" : currentTurnChar.name}
                  </span>
                </span>
              ) : (
                <span className="text-zinc-600">等待開始...</span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs text-zinc-500 font-mono tracking-wider">房間代碼 {room.room_code}</span>
              {room.host_id === currentUserId && hasStarted && (
                <button
                  onClick={endGame}
                  disabled={endingGame}
                  className="text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 hover:brightness-125"
                  style={{ border: "1px solid rgba(185,28,28,0.5)", color: "#f87171", background: "rgba(127,29,29,0.15)" }}
                >
                  結束遊戲
                </button>
              )}
            </div>
          </div>
        </Panel>

        {/* Story log */}
        <div className="relative flex-1 min-h-0 flex flex-col rounded-xl" style={PANEL}>
          {/* Ornate frame + decorations (fixed to the panel, not the scroll content) */}
          <div className="absolute inset-[6px] rounded-lg pointer-events-none z-10" style={{ border: "1px solid rgba(201,169,110,0.16)" }} />
          <Clip className="-top-1.5 left-7" />
          <div className="absolute -top-2 right-9 px-3 py-1 rotate-3 pointer-events-none z-10 text-[10px] italic"
            style={{ background: "rgba(40,34,24,0.92)", border: "1px solid rgba(201,169,110,0.2)", color: "rgba(201,169,110,0.5)", boxShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>
            observe · record
          </div>
          <div className="absolute bottom-5 right-6 pointer-events-none z-0 opacity-[0.10]">
            <Seal size={88} glyph="◬" />
          </div>

          <div ref={logContainerRef} onScroll={onLogScroll} className="relative z-[1] flex-1 p-5 overflow-y-auto min-h-0 flex flex-col gap-3">
          {storyLog.length === 0 && (
            <p className="text-zinc-600 text-sm italic text-center mt-8">
              {needsInit ? "準備就緒 — 點擊下方「開始冒險」！" : "等待所有玩家選擇調查員..."}
            </p>
          )}
          {storyLog.map((entry) => (
            <div key={entry.id}>
              {entry.entry_type === "system" && (
                <p className="text-zinc-600 italic text-xs text-center">{entry.content}</p>
              )}
              {entry.entry_type === "action" && (
                <div className="flex flex-col gap-1">
                  <div className="flex gap-2">
                    <span className="text-gold font-medium text-sm shrink-0">{entry.characters?.name ?? "Player"}:</span>
                    <span className="text-zinc-300 text-sm">{entry.content}</span>
                  </div>
                  {entry.roll_result?.requires_check && <DiceResult roll={entry.roll_result} />}
                </div>
              )}
              {entry.entry_type === "gm_response" && (
                <div className="rounded-lg p-3.5" style={{ background: "rgba(20,16,11,0.6)", border: "1px solid rgba(201,169,110,0.18)" }}>
                  <span className="text-xs text-gold font-medium uppercase tracking-wider block mb-2">GM</span>
                  <GmText content={entry.content} />
                </div>
              )}
              {entry.entry_type === "location_media" && (
                <div className="rounded-lg p-3.5" style={{ background: "rgba(20,16,11,0.6)", border: "1px solid rgba(201,169,110,0.30)" }}>
                  <span className="text-xs text-gold font-medium uppercase tracking-wider flex items-center gap-1 mb-2">🔍 發現</span>
                  {entry.media_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.media_url}
                      alt="發現"
                      className="rounded-lg w-full object-cover mb-2 border"
                      style={{ borderColor: "rgba(201,169,110,0.25)", maxHeight: "22rem" }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                  {entry.content && <GmText content={entry.content} />}
                </div>
              )}
            </div>
          ))}
          {gmThinking && (
            <div className="rounded-lg p-3.5" style={{ background: "rgba(20,16,11,0.5)", border: "1px solid rgba(201,169,110,0.10)" }}>
              <span className="text-xs text-gold/60 font-medium uppercase tracking-wider block mb-1">GM</span>
              <span className="text-zinc-600 text-sm italic">thinking...</span>
            </div>
          )}
          <div ref={logEndRef} />
          </div>

          {/* Jump-to-latest button — appears only when scrolled away from the bottom */}
          {!atBottom && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-3 right-3 z-20 text-xs font-medium px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1 transition-colors"
              style={{ background: "rgba(26,21,14,0.95)", border: "1px solid rgba(201,169,110,0.35)", color: "#c9a96e" }}
            >
              ↓ 最新訊息
            </button>
          )}
        </div>

        {/* Suggested choices — only shown if they were generated FOR the current turn player */}
        {isMyTurn && choicesAreForMe && (room.current_choices?.length ?? 0) === 3 && hasStarted && (
          <div className="flex flex-col gap-2 shrink-0">
            <p className="text-xs tracking-wider"><span className="text-gold font-medium">建議行動</span> <span className="text-zinc-600">— 或在下方輸入自己的行動</span></p>
            <div className="grid grid-cols-1 gap-2">
              {room.current_choices!.map((c, i) => {
                // Split a "[技能] 行動" choice so the skill tag renders as its own chip.
                const m = c.match(/^\s*[\[【]\s*([^\]】]+?)\s*[\]】]\s*([\s\S]*)$/);
                const tag = m ? m[1].trim() : null;
                const bodyText = m ? (m[2].trim() || c) : c;
                return (
                  <button
                    key={i}
                    onClick={() => submitChoice(c)}
                    disabled={submitting}
                    className="group flex items-center gap-3 text-left rounded-lg px-4 py-3 transition-all disabled:opacity-40 hover:brightness-110"
                    style={{ background: "rgba(26,21,14,0.6)", border: "1px solid #2e2416" }}
                  >
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0 text-xs text-gold"
                      style={{ border: "1px solid rgba(201,169,110,0.35)" }}>{i + 1}</span>
                    {tag && (
                      <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full text-gold"
                        style={{ background: "rgba(201,169,110,0.12)", border: "1px solid rgba(201,169,110,0.35)" }}>
                        {tag}
                      </span>
                    )}
                    <span className="text-zinc-300 group-hover:text-zinc-100 text-sm">{bodyText}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Action input */}
        {needsInit && room.host_id === currentUserId ? (
          <button
            onClick={initializeTurns}
            disabled={initializing}
            className="w-full py-3 rounded-xl font-serif text-base shrink-0 transition-all disabled:opacity-50 hover:brightness-110"
            style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 18px rgba(201,169,110,0.2)" }}
          >
            {initializing ? "開始中..." : "開始冒險"}
          </button>
        ) : hasStarted && iAmDead ? (
          <div className="text-center text-sm py-3 shrink-0 border rounded-xl"
            style={iAmInsane && !iAmDown
              ? { color: "#5eead4", borderColor: "rgba(19,78,74,0.6)", background: "rgba(19,78,74,0.25)" }
              : { color: "#fca5a5", borderColor: "rgba(127,29,29,0.5)", background: "rgba(127,29,29,0.2)" }}>
            {iAmInsane && !iAmDown
              ? `${myCharacter?.name ?? "你的調查員"} 的精神已完全崩潰，永遠迷失在黑暗中。`
              : `${myCharacter?.name ?? "你的調查員"} 已在此倒下，無法再行動。`}
          </div>
        ) : hasStarted ? (
          <div className="flex flex-col gap-2 shrink-0">
          <div className="flex gap-3 items-stretch relative">
            {/* Skill picker */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setSkillMenuOpen((o) => !o)}
                disabled={!isMyTurn || submitting}
                className="h-full px-3 rounded-xl text-sm transition-all disabled:opacity-40 hover:brightness-110 flex items-center gap-1.5"
                style={selectedSkill
                  ? { background: "rgba(201,169,110,0.14)", border: "1px solid rgba(201,169,110,0.5)", color: "#e4d8be" }
                  : { background: "rgba(14,12,8,0.8)", border: "1px solid #2e2416", color: "#9a8c6e" }}
                title="選擇要使用的技能（可選）"
              >
                <span>🎲</span>
                <span className="whitespace-nowrap">{selectedSkill ? (SKILL_ZH[selectedSkill] ?? selectedSkill) : "技能"}</span>
                <span className="text-[10px] opacity-70">▾</span>
              </button>

              {skillMenuOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-64 max-h-80 overflow-y-auto rounded-xl p-2 z-30 shadow-xl"
                  style={{ background: "rgba(20,16,11,0.98)", border: "1px solid rgba(201,169,110,0.3)" }}>
                  <button
                    type="button"
                    onClick={() => { setSelectedSkill(null); setSkillMenuOpen(false); }}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm hover:brightness-125 transition-all"
                    style={{ background: selectedSkill === null ? "rgba(201,169,110,0.12)" : "transparent", color: "#cbb890" }}
                  >
                    自動偵測（依行動文字判斷）
                  </button>
                  {SKILL_PICKER.map((group) => (
                    <div key={group.label} className="mt-1.5">
                      <p className="text-[10px] uppercase tracking-wider px-2 py-1" style={{ color: "rgba(201,169,110,0.5)" }}>{group.label}</p>
                      {group.keys.map((key) => {
                        const val = myCharacter
                          ? currentSkillValue(key, myCharacter.skills, { dex: myCharacter.dex, app: myCharacter.app })
                          : 0;
                        const active = selectedSkill === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => { setSelectedSkill(key); setSkillMenuOpen(false); }}
                            className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-sm hover:brightness-125 transition-all"
                            style={{ background: active ? "rgba(201,169,110,0.16)" : "transparent", color: active ? "#e4d8be" : "#bdb29a" }}
                          >
                            <span>{SKILL_ZH[key] ?? key}</span>
                            <span className="tabular-nums text-xs text-gold">{val}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <input
              value={actionText}
              onChange={(e) => setActionText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && isMyTurn && !submitting) { e.preventDefault(); submitAction(); } }}
              placeholder={isMyTurn ? "描述你的行動..." : `等待 ${currentTurnChar?.name ?? "..."} 行動...`}
              disabled={!isMyTurn || submitting}
              className="flex-1 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-gold/50 disabled:opacity-50 transition-colors"
              style={{ background: "rgba(14,12,8,0.8)", border: "1px solid #2e2416" }}
            />
            <button
              onClick={() => submitAction()}
              disabled={!isMyTurn || !actionText.trim() || submitting}
              className="px-7 py-3 rounded-xl font-serif text-sm shrink-0 transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
              style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 16px rgba(201,169,110,0.18)" }}
            >
              {submitting ? "..." : "Submit"}
            </button>
          </div>
          {selectedSkill && (
            <p className="text-[11px] text-zinc-500 pl-1">
              將以 <span className="text-gold">{SKILL_ZH[selectedSkill] ?? selectedSkill}</span> 進行檢定 ——
              <button type="button" onClick={() => setSelectedSkill(null)} className="ml-1 underline hover:text-zinc-300">改回自動</button>
            </p>
          )}
          </div>
        ) : (
          <div className="text-center text-sm py-3 shrink-0">
            {(() => {
              const myPlayer = roomPlayers.find((p) => p.user_id === currentUserId);
              const iNeedCard = myPlayer && !myPlayer.character_id;
              if (iNeedCard) {
                return (
                  <button
                    onClick={() => router.push(`/rooms/${params.id}/select-card`)}
                    className="px-6 py-2.5 rounded-lg font-serif transition-all hover:brightness-110"
                    style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07" }}
                  >
                    選擇調查員以繼續 →
                  </button>
                );
              }
              return <span className="text-zinc-600">{allHaveChars ? "等待主持人開始..." : "等待所有玩家選擇調查員..."}</span>;
            })()}
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="flex flex-col gap-3 overflow-y-auto">

        {/* Objective Tracker — restricted to a single account */}
        {currentUserEmail === "kingtingtai@gmail.com" && room.objectives && room.objectives.length > 0 && (
          <Panel className="p-4 shrink-0">
            <PanelHeader title="任務目標" />
            <div className="flex flex-col gap-2">
              {room.objectives.map((obj) => {
                const prog = room.objective_progress?.[obj.id];
                const done = prog?.done === true;
                return (
                  <div key={obj.id} className={`flex items-start gap-2 text-xs ${done ? "opacity-60" : ""}`}>
                    <span className="shrink-0 mt-0.5 w-4 h-4 rounded flex items-center justify-center font-bold"
                      style={done
                        ? { background: "rgba(6,78,59,0.5)", color: "#6ee7b7", border: "1px solid rgba(6,95,70,0.7)" }
                        : { background: "rgba(14,12,8,0.8)", color: "#71717a", border: "1px solid #2e2416" }}>
                      {done ? "✓" : "○"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className={done ? "text-zinc-500 line-through" : "text-zinc-300"}>{obj.text}</span>
                      {obj.scope === "each_player" && !done && (
                        <span className="ml-1.5 text-[10px] text-zinc-600">（各自完成）</span>
                      )}
                      {done && prog?.character && (
                        <span className="ml-1.5 text-[10px] text-emerald-600">by {prog.character}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

        <Panel className="p-4 shrink-0">
          <PanelHeader title="行動順序" />
          <div className="flex flex-col gap-1.5">
            {sortedByDex.length === 0 && <p className="text-zinc-600 text-xs">尚無調查員</p>}
            {sortedByDex.map((c, i) => {
              const isActive = c.user_id === room.current_turn_player_id && hasStarted;
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs"
                  style={isActive ? { background: "rgba(201,169,110,0.10)", border: "1px solid rgba(201,169,110,0.30)" } : { border: "1px solid transparent" }}
                >
                  <span className="text-zinc-600 w-3">{i + 1}.</span>
                  <span className={`flex-1 font-medium truncate ${isActive ? "text-gold" : "text-zinc-300"}`}>{c.name}</span>
                  <span className="text-zinc-500">DEX {c.dex}</span>
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-gold shrink-0" />}
                </div>
              );
            })}
          </div>
        </Panel>

        {sortedByDex.map((c) => {
          const isActive = c.user_id === room.current_turn_player_id && hasStarted;
          const down = c.hp <= 0;
          const insane = c.san <= 0;
          const dead = down || insane;
          return (
            <Panel key={c.id} className="p-4 shrink-0"
              frame={dead ? "rgba(185,28,28,0.4)" : isActive ? "rgba(201,169,110,0.40)" : "rgba(201,169,110,0.14)"}
              style={dead ? { opacity: 0.65 } : undefined}>
              <div className="flex items-center justify-between mb-3 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-gold/70 text-sm leading-none">◈</span>
                  <h4 className="font-serif text-gold truncate">{c.name}</h4>
                  {c.occupation && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ background: "rgba(201,169,110,0.1)", border: "1px solid rgba(201,169,110,0.3)", color: "#c9a96e" }}>
                      {c.occupation}
                    </span>
                  )}
                </div>
                {down && <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: "rgba(127,29,29,0.6)", color: "#fca5a5", border: "1px solid rgba(153,27,27,0.7)" }}>陣亡</span>}
                {!down && insane && <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: "rgba(19,78,74,0.6)", color: "#5eead4", border: "1px solid rgba(17,94,89,0.7)" }}>發瘋</span>}
              </div>
              {(() => {
                const maxHp = Math.max(1, Math.floor((c.con + c.siz) / 10));
                const maxSan = Math.max(1, c.pow);
                const maxMp = Math.max(1, Math.floor(c.pow / 5));
                const hpPct = Math.min(100, Math.max(0, (c.hp / maxHp) * 100));
                const sanPct = Math.min(100, Math.max(0, (c.san / maxSan) * 100));
                const mpPct = Math.min(100, Math.max(0, (c.mp / maxMp) * 100));
                return (
                  <div className="space-y-1.5 mb-2">
                    <StatBar label="生命" cur={c.hp} max={maxHp} pct={hpPct}
                      color={c.hp <= 3 ? "bg-red-500" : "bg-emerald-500"} />
                    <StatBar label="理智" cur={c.san} max={maxSan} pct={sanPct}
                      color={c.san <= 15 ? "bg-amber-500" : "bg-teal-400"} />
                    <StatBar label="魔力" cur={c.mp} max={maxMp} pct={mpPct}
                      color="bg-sky-500" />
                  </div>
                );
              })()}
              <div className="grid grid-cols-2 gap-x-4 gap-y-px">
                {(["str","con","siz","dex","app","int","pow","edu","luck"] as const).map((k) => (
                  <div key={k} className="flex justify-between items-center py-1" style={{ borderBottom: "1px solid rgba(42,32,16,0.5)" }}>
                    <span className="text-zinc-600 text-[11px]">{STAT_ZH[k]}</span>
                    <span className="text-zinc-200 text-xs font-semibold">{c[k]}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => toggleSkills(c.id)}
                className="mt-3 w-full text-xs text-gold/80 hover:text-gold text-left"
              >
                {skillsOpen[c.id] ? "收起技能 ▲" : "查看技能 ▼"}
              </button>
              {skillsOpen[c.id] && (
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {c.skills && Object.entries(c.skills).filter(([,v]) => (v ?? 0) > 0).sort(([,a],[,b]) => b-a).map(([k,v]) => (
                    <div key={k} className="flex justify-between rounded px-2 py-1" style={{ background: "rgba(0,0,0,0.3)" }}>
                      <span className="text-zinc-500 text-xs truncate">{SKILL_ZH[k] ?? k.replace(/_/g," ")}</span>
                      <span className="text-gold text-xs font-bold">{v}%</span>
                    </div>
                  ))}
                  {(!c.skills || Object.values(c.skills).every(v => (v??0) === 0)) && (
                    <p className="col-span-2 text-zinc-600 text-xs text-center py-1">尚未分配技能</p>
                  )}
                </div>
              )}
            </Panel>
          );
        })}
      </div>
    </div>
    </>
  );
}

// ─── Ending Screen ────────────────────────────────────────────────────────────

const ENDING_META: Record<string, { icon: string; badge: string; accent: string; glow: string }> = {
  best:    { icon: "✦", badge: "最佳結局", accent: "#c9a96e", glow: "rgba(201,169,110,0.45)" },
  normal:  { icon: "✔", badge: "勝利",     accent: "#6ee7b7", glow: "rgba(110,231,183,0.40)" },
  bad:     { icon: "↗", badge: "苦甜結局", accent: "#fdba74", glow: "rgba(253,186,116,0.40)" },
  failure: { icon: "✕", badge: "失敗",     accent: "#fca5a5", glow: "rgba(252,165,165,0.40)" },
};

function EndingScreen({
  room, storyLog, onGrowth, onHub, onScenarios, onDashboard,
}: {
  room: Room;
  storyLog: StoryLogEntry[];
  onGrowth: () => void;
  onHub: () => void;
  onScenarios: () => void;
  onDashboard: () => void;
}) {
  const hasEnding = !!room.ending_title;
  const meta = ENDING_META[room.ending_type ?? ""] ?? ENDING_META.normal;
  const canGrow = room.ending_type === "good" || room.ending_type === "normal";
  const accent = hasEnding ? meta.accent : "#c9a96e";
  const glow = hasEnding ? meta.glow : "rgba(201,169,110,0.40)";

  return (
    <>
    {/* Faint occult texture behind the ending */}
    <div className="fixed inset-0 -z-10 pointer-events-none opacity-[0.04]" aria-hidden
      style={{ backgroundImage: "radial-gradient(circle, #c9a96e 1px, transparent 1px)", backgroundSize: "42px 42px" }} />
    <div className="flex flex-col items-center justify-start min-h-[70vh] gap-6 py-10 max-w-2xl mx-auto">
      {/* Icon + type badge */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative w-16 h-16 rounded-full flex items-center justify-center text-3xl"
          style={{ background: "linear-gradient(150deg,#1c1813,#0f0c08)", border: `2px solid ${glow}`, color: accent, boxShadow: `0 0 28px ${glow}` }}>
          <div className="absolute inset-[4px] rounded-full pointer-events-none" style={{ border: `1px solid ${glow}` }} />
          {hasEnding ? meta.icon : "⚔"}
        </div>
        {hasEnding && (
          <span className="text-xs px-3 py-1 rounded-full font-semibold uppercase tracking-wider"
            style={{ background: "rgba(20,16,11,0.8)", border: `1px solid ${glow}`, color: accent }}>
            {meta.badge}
          </span>
        )}
      </div>

      {/* Title + room name */}
      <div className="text-center">
        <h1 className="font-serif text-3xl mb-1.5" style={{ color: accent, letterSpacing: "0.04em" }}>
          {hasEnding ? room.ending_title : "冒險結束"}
        </h1>
        <p className="text-zinc-500 text-sm">
          <span className="text-gold">{room.name}</span> 的故事已結束。
        </p>
      </div>

      {/* Ending summary — ~300-word epilogue */}
      {room.ending_summary && (
        <Panel className="w-full p-6" frame={glow}>
          <div className="max-h-[22rem] overflow-y-auto pr-1 leading-relaxed">
            <GmText content={room.ending_summary} />
          </div>
        </Panel>
      )}

      {/* Story log (last 10 non-system entries) */}
      <Panel className="w-full p-5">
        <PanelHeader title="故事回顧" />
        <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
          {storyLog
            .filter((e) => e.entry_type !== "system")
            .slice(-10)
            .map((entry) => (
              <div key={entry.id} className="text-sm">
                {entry.entry_type === "action" && (
                  <p className="text-zinc-400">
                    <span className="text-gold">{entry.characters?.name ?? "Player"}:</span>{" "}
                    {entry.content}
                  </p>
                )}
                {entry.entry_type === "gm_response" && (
                  <GmText content={entry.content} />
                )}
              </div>
            ))}
        </div>
      </Panel>

      {/* Character growth — only available on good/normal endings */}
      {canGrow ? (
        <button
          onClick={onGrowth}
          className="w-full py-3 rounded-lg font-serif transition-all hover:brightness-110 flex items-center justify-center gap-2"
          style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 18px rgba(201,169,110,0.2)" }}
        >
          📈 角色成長 — 對本局成功使用過的技能進行成長檢定
        </button>
      ) : (
        <div className="w-full text-center text-zinc-600 text-sm py-2.5 rounded-lg" style={{ border: "1px solid #2e2416" }}>
          失敗結局不開放角色成長
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3 w-full">
        <button
          onClick={onScenarios}
          className="flex-1 py-3 rounded-lg font-medium transition-all hover:brightness-110"
          style={{ background: "rgba(26,21,14,0.9)", border: "1px solid rgba(201,169,110,0.35)", color: "#c9a96e" }}
        >
          瀏覽劇本
        </button>
        <button
          onClick={onHub}
          className="flex-1 py-3 rounded-lg font-medium transition-colors text-zinc-400 hover:text-zinc-200"
          style={{ background: "#1a150e", border: "1px solid #2e2416" }}
        >
          遊戲大廳
        </button>
        <button
          onClick={onDashboard}
          className="flex-1 py-3 rounded-lg font-medium transition-colors text-zinc-400 hover:text-zinc-200"
          style={{ background: "#1a150e", border: "1px solid #2e2416" }}
        >
          後台
        </button>
      </div>
    </div>
    </>
  );
}

// ─── Dice Result ─────────────────────────────────────────────────────────────

const OUTCOME_STYLES: Record<string, { label: string; cls: string }> = {
  critical_success: { label: "大成功", cls: "text-emerald-300 border-emerald-700 bg-emerald-900/30" },
  success:          { label: "成功",   cls: "text-green-300 border-green-700 bg-green-900/30" },
  failure:          { label: "失敗",   cls: "text-orange-300 border-orange-700 bg-orange-900/30" },
  critical_failure: { label: "大失敗", cls: "text-red-300 border-red-700 bg-red-900/30" },
};

function DiceResult({ roll }: { roll: RollResult }) {
  const style = roll.outcome ? OUTCOME_STYLES[roll.outcome] : null;
  const sc = roll.san_check;
  return (
    <div className="ml-6 space-y-1.5">
      {/* Action check box — only when an action roll happened */}
      {roll.d100_roll != null && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${style?.cls ?? "border-slate-700 bg-slate-900/40"}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold tracking-wider">🎲 {STAT_ZH[roll.stat_used ?? ""] ?? roll.stat_used?.toUpperCase()}</span>
            <span className="opacity-90">
              d100 = <b>{roll.d100_roll}</b> vs {roll.target}%
            </span>
            <span className="font-bold">→ {style?.label ?? roll.outcome}</span>
          </div>
          {(roll.hp_change !== 0 || roll.san_change !== 0 || roll.consequence_summary) && (
            <div className="mt-1 opacity-90">
              {roll.consequence_summary}
              {roll.hp_change !== 0 && <span className="ml-1 font-semibold">生命 {roll.hp_change}</span>}
              {roll.san_change !== 0 && <span className="ml-1 font-semibold">理智 {roll.san_change}</span>}
            </div>
          )}
        </div>
      )}

      {/* Attack box — dodge contest + damage for a contested attack */}
      {roll.attack && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${
          roll.attack.damage > 0
            ? "text-rose-300 border-rose-700 bg-rose-950/40"
            : "text-zinc-300 border-slate-700 bg-slate-900/40"
        }`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold tracking-wider">⚔️ 攻擊 → {roll.attack.target_name}</span>
            {!roll.attack.hit ? (
              <span className="font-bold">落空</span>
            ) : roll.attack.crit ? (
              <span className="font-bold">重擊命中（無法閃避）</span>
            ) : roll.attack.dodge_roll != null ? (
              <span className="opacity-90">
                閃避 d100 = <b>{roll.attack.dodge_roll}</b> vs {roll.attack.dodge_target}% → {roll.attack.dodged ? "閃過" : "未閃過"}
              </span>
            ) : null}
          </div>
          {roll.attack.damage > 0 && (
            <div className="mt-1 font-semibold">
              {roll.attack.skill_label}傷害 −{roll.attack.damage} HP
              {roll.attack.target_hp_after != null && !roll.attack.is_npc && `（剩餘 ${roll.attack.target_hp_after}）`}
              {roll.attack.target_died && <span className="ml-1">☠ 倒下</span>}
            </div>
          )}
        </div>
      )}

      {/* SAN check box — separate roll for facing horror */}
      {sc && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${sc.success ? "text-teal-200 border-teal-800 bg-teal-950/30" : "text-rose-300 border-rose-700 bg-rose-950/40"}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold uppercase tracking-wider">🧠 理智檢定</span>
            <span className="opacity-80">{sc.severity_label}</span>
            <span className="opacity-90">d100 = <b>{sc.roll}</b> vs 意志 {sc.pow}</span>
            <span className="font-bold">→ {sc.success ? "撐住" : "失守"}</span>
          </div>
          {sc.trigger_text && (
            <div className="mt-1 opacity-90">
              目睹了「{sc.trigger_text}」相關的景象，{sc.success ? "勉強穩住心神。" : "心神受到衝擊。"}
            </div>
          )}
          {sc.san_loss > 0 && (
            <div className="mt-1 font-semibold">理智 −{sc.san_loss}</div>
          )}
        </div>
      )}
    </div>
  );
}
