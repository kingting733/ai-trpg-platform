"use client";
import { useEffect, useState, useCallback, useRef, useMemo, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { currentSkillValue, SKILL_KEY_BY_ZH } from "@/lib/game/skills";
import { endingAllowsGrowth } from "@/lib/game/endings";
import { MYTHOS_SPELLS, MYTHOS_ZH_BY_KEY, MYTHOS_KEY_BY_ZH, MYTHOS_MP_COST, mythosSuccessRate } from "@/lib/game/mythos";
import { coerceLocationGraph, coerceLocationState, computeExits, positionOf, type LocationGraph } from "@/lib/game/locations";
import { ChatDrawer } from "@/components/ChatDrawer";
import {
  MapPin, Lock, Package, CircleCheck, Circle, Search, ArrowDown, Dices, Sparkles,
  ArrowRight, Map as MapIcon, Backpack, Users, X, Skull, Brain, Swords, TrendingUp,
  type LucideIcon,
} from "lucide-react";

interface Character {
  id: string;
  user_id: string;
  name: string;
  hp: number; san: number; mp: number;
  str: number; con: number; siz: number; dex: number; app: number;
  int: number; pow: number; edu: number; luck: number;
  skills: Record<string, number> | null;
  occupation: string | null;
  cthulhu_knowledge?: number | null;
  mythos_skills?: string[] | null;
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
  scenario_id: string;
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
  location_state: {
    current: string | null;
    status: Record<string, "hidden" | "discovered" | "unlocked">;
    visited: string[];
    evidence_found: string[];
  } | null;
  inventory: { name: string; note?: string; evidence_id?: string | null; round?: number }[] | null;
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

// Inline markup the GM may emit: **bold** plus curated dramatic effect spans
// [[dread]] / [[whisper]] / [[chant]]. Any unrecognized [[...]] marker is
// stripped so raw tags never leak to players.
const FX_TAGS = "dread|whisper|chant|key|eerie";
const FX_SPAN = new RegExp(`(\\*\\*[\\s\\S]+?\\*\\*|\\[\\[(?:${FX_TAGS})\\]\\][\\s\\S]+?\\[\\[\\/(?:${FX_TAGS})\\]\\])`, "g");
const FX_CLASS: Record<string, string> = {
  dread: "fx-dread", whisper: "fx-whisper", chant: "fx-chant", key: "fx-key", eerie: "fx-eerie",
};

function renderInline(text: string) {
  return text.split(FX_SPAN).map((part, j) => {
    let m: RegExpMatchArray | null;
    if ((m = part.match(/^\*\*([\s\S]+?)\*\*$/)))
      return <strong key={j} className="text-white font-semibold">{m[1]}</strong>;
    if ((m = part.match(new RegExp(`^\\[\\[(${FX_TAGS})\\]\\]([\\s\\S]+?)\\[\\[\\/\\1\\]\\]$`))))
      return <span key={j} className={FX_CLASS[m[1]]}>{m[2]}</span>;
    // Plain text — strip any stray/typo'd effect markers.
    return part.replace(/\[\[\/?[a-zA-Z]+\]\]/g, "");
  });
}

function GmText({ content }: { content: string }) {
  const paragraphs = content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return null;
  return (
    <div className="space-y-2">
      {paragraphs.map((para, i) => {
        // Section break (分段): a line of --- / *** / [[break]] → decorative divider.
        if (/^(-{3,}|\*{3,}|\[\[break\]\])$/.test(para)) {
          return <hr key={i} className="fx-divider" />;
        }
        // Bold header: paragraph that is entirely **...**
        const headerMatch = para.match(/^\*\*(.+?)\*\*$/);
        if (headerMatch) {
          return <p key={i} className="text-gold font-semibold text-sm">{headerMatch[1]}</p>;
        }
        return (
          <p key={i} className="text-zinc-300 text-sm leading-relaxed">
            {renderInline(para)}
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

// Flavor lines shown while the GM is thinking, BEFORE the first narration token
// streams in (once real prose arrives it takes over). Cosmetic only — they cycle
// on a timer and don't reflect real server phases. The dice line gets a rolling-
// die animation (also cosmetic; the real roll is shown in the dice-result box).
const THINKING_MESSAGES: { text: string; dice?: boolean }[] = [
  { text: "主持人正在翻閱筆記…" },
  { text: "命運正在低語…" },
  { text: "骰子仍在滾動…", dice: true },
  { text: "迷霧正在散去…" },
  { text: "古老的書頁沙沙作響…" },
  { text: "陰影正在挪移…" },
  { text: "主持人正在傾聽黑暗…" },
  { text: "命運之輪緩緩轉動…" },
  { text: "燭火搖曳，故事繼續…" },
  { text: "遠處傳來低沉的鐘聲…" },
  { text: "無形之物正在窺視…" },
  { text: "主持人正在編織後續…" },
  { text: "空氣中的絲線正在交纏…" },
  { text: "星辰正在重新排列…" },
  { text: "主持人正在推演接下來的可能…" },
  { text: "古神在夢中翻了個身…" },
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
  // Live narration text as it streams in from the GM this turn. null = not
  // currently streaming (either idle, or waiting for the first token — the
  // "thinking..." placeholder covers that gap). Cleared once fetchAll() pulls
  // the persisted turn from the DB, so there's never a duplicate/stale copy.
  const [streamingText, setStreamingText] = useState<string | null>(null);
  // Which flavor line is showing while the GM thinks (pre-stream). Cycles on a 2s timer.
  const [thinkingMsgIdx, setThinkingMsgIdx] = useState(0);
  // Evidence/reveal image opened full-size in the lightbox, or null.
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [endingGame, setEndingGame] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState<Record<string, boolean>>({});
  // Mobile only: which info panel is open as a bottom-sheet popup (地點/物品/
  // 隊伍), or null. Opened from the fixed bottom button bar.
  const [activePanel, setActivePanel] = useState<"location" | "item" | "team" | null>(null);
  // True from the moment this player submits until their own fetchAll() has
  // synced the persisted turn. While true, the background 3s poll is skipped so
  // it can't load the persisted gm_response and briefly render it ALONGSIDE the
  // still-visible live streaming box (the "two GM boxes that vanish" flash).
  const streamingRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  // "你的上一幕" orientation aid (option 2): DOM nodes of each log entry, so we
  // can scroll MY last scene into view when it becomes my turn.
  const sceneRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevMyTurnRef = useRef(false);
  const [flashScene, setFlashScene] = useState(false);
  // Mobile: the suggested-action list can be collapsed to free up the short
  // story window; it re-shows automatically on a new turn.
  const [choicesHidden, setChoicesHidden] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [locGraph, setLocGraph] = useState<LocationGraph | null>(null);
  function toggleSkills(id: string) { setSkillsOpen((p) => ({ ...p, [id]: !p[id] })); }

  // Split into LOAD (pure fetch, no state) and APPLY (pure state, no awaits).
  // The end-of-turn handoff needs to swap the streaming text for the persisted
  // row in a SINGLE render — with state writes buried inside the fetch, the
  // narration was hidden the moment the stream ended and only reappeared after
  // several network round-trips, which read as a flicker/reflow.
  type RoomSnapshot = {
    user: { id: string; email: string | null };
    roomData: Room;
    rp: RoomPlayer[];
    chars: Character[];
    logs: StoryLogEntry[];
  };

  const loadAll = useCallback(async (): Promise<RoomSnapshot | null> => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return null; }

    const { data: roomData } = await supabase.from("rooms").select("*").eq("id", params.id).single();
    if (!roomData) { router.push("/play/hub"); return null; }

    // Independent queries — run them together rather than in sequence.
    const [{ data: rp }, { data: chars }, { data: logs }] = await Promise.all([
      supabase.from("room_players").select("user_id, character_id, turn_order").eq("room_id", params.id),
      supabase.from("characters").select("*").eq("room_id", params.id),
      supabase.from("story_logs").select("*, characters(name)").eq("room_id", params.id)
        .order("created_at", { ascending: true }),
    ]);

    return {
      user: { id: user.id, email: user.email ?? null },
      roomData,
      rp: rp ?? [],
      chars: (chars ?? []) as Character[],
      logs: (logs as unknown as StoryLogEntry[]) ?? [],
    };
  }, [params.id, router]);

  /** Synchronous — every setState here lands in ONE React render. */
  const applySnapshot = useCallback((d: RoomSnapshot | null) => {
    if (!d) return;
    setCurrentUserId(d.user.id);
    setCurrentUserEmail(d.user.email);
    setRoom(d.roomData);
    setRoomPlayers(d.rp);
    setCharacters([...d.chars].sort((a, b) => b.dex - a.dex));
    setMyCharacter(d.chars.find((c) => c.user_id === d.user.id) ?? null);
    setStoryLog(d.logs);
  }, []);

  const fetchAll = useCallback(async () => {
    applySnapshot(await loadAll());
  }, [loadAll, applySnapshot]);

  // SPECTATOR TURN STATE — what the players who are NOT acting should see.
  // Derived purely from the log, so it needs no schema change and no extra
  // request: the acting player's action row is persisted BEFORE narration
  // begins, so "an action with no gm_response after it" means the GM is
  // currently writing. Anything older than STALE_MS is treated as a turn that
  // errored out, so a crashed turn can't leave everyone staring at a spinner
  // forever.
  const SPECTATOR_STALE_MS = 150_000;
  const [nowTick, setNowTick] = useState(() => Date.now());
  const pendingTurn = useMemo(() => {
    for (let i = storyLog.length - 1; i >= 0; i--) {
      const e = storyLog[i];
      if (e.entry_type === "gm_response") return null; // narration already landed
      if (e.entry_type === "action") {
        const age = nowTick - new Date(e.created_at).getTime();
        if (age > SPECTATOR_STALE_MS) return null;
        return { name: e.characters?.name ?? "調查員" };
      }
    }
    return null;
  }, [storyLog, nowTick]);

  // Re-evaluate the staleness cutoff periodically; without this a stuck turn
  // would keep showing "GM is writing" until the next poll changed storyLog.
  useEffect(() => {
    if (!pendingTurn) return;
    const id = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(id);
  }, [pendingTurn]);

  // Adaptive polling. Normally 3s is plenty, but while ANOTHER player's turn is
  // being narrated the spectators are staring at a "GM is writing" indicator —
  // poll faster so both that indicator and the narration itself land promptly
  // instead of up to 3s late.
  // Any turn mid-narration, regardless of whose turn it now is — the server
  // advances the turn pointer before narrating, so keying this off "not my
  // turn" made the NEXT player (the one waiting to act) poll slowly.
  // The submitting player pauses polling entirely via streamingRef.
  const turnInFlight = !!pendingTurn;
  useEffect(() => {
    fetchAll();
    const interval = setInterval(() => {
      // Skip the poll while THIS player is mid-stream — their own fetchAll at
      // the end of submitAction is the source of truth, and polling here would
      // duplicate the streaming box with the freshly-persisted DB entry.
      if (!streamingRef.current) fetchAll();
    }, turnInFlight ? 1200 : 3000);
    return () => clearInterval(interval);
  }, [fetchAll, turnInFlight]);

  // Cycle the GM "thinking" flavor line every 2s — only while waiting for the
  // FIRST narration token (once prose streams in, that view takes over).
  useEffect(() => {
    if (!gmThinking || streamingText) return;
    setThinkingMsgIdx(Math.floor(Math.random() * THINKING_MESSAGES.length));
    const id = setInterval(() => {
      setThinkingMsgIdx((cur) => {
        if (THINKING_MESSAGES.length <= 1) return cur;
        let next = cur;
        while (next === cur) next = Math.floor(Math.random() * THINKING_MESSAGES.length);
        return next;
      });
    }, 2000);
    return () => clearInterval(id);
  }, [gmThinking, streamingText]);

  // ESC closes the evidence lightbox.
  useEffect(() => {
    if (!lightboxSrc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightboxSrc(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxSrc]);

  // The scenario's location graph is static for the whole game — fetch once.
  // Collapse the 移動 list whenever the turn advances: the exits it is showing
  // belong to the round it was opened in, and a stale open list invites a
  // click that no longer means what the player thinks it means.
  useEffect(() => { setMoveOpen(false); }, [room?.current_round]);

  useEffect(() => {
    if (!room?.scenario_id) return;
    const supabase = createClient();
    supabase
      .from("scenarios")
      .select("location_graph")
      .eq("id", room.scenario_id)
      .single()
      .then(({ data }) => {
        setLocGraph(coerceLocationGraph(data?.location_graph));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.scenario_id]);

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

  // Follow-the-bottom auto-scroll for NEW LOG ENTRIES only.
  //
  // Deliberately NOT keyed on `streamingText`: pinning to the bottom on every
  // token yanked the page a line at a time while the player was still reading
  // the paragraph above, which made the narration hard to follow. The text now
  // grows downward from where it started and the player scrolls at their own
  // pace; "↓ 最新訊息" returns them to the end whenever they want.
  useEffect(() => {
    if (atBottom) logEndRef.current?.scrollIntoView({ behavior: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyLog, gmThinking]);

  // Streaming grows the content without firing a scroll event, so `atBottom`
  // would go stale — and the "↓ 最新訊息" button (which renders on !atBottom)
  // would stay hidden precisely while the text is running away below the fold.
  // Re-measure as tokens arrive. Measures only; never scrolls.
  useEffect(() => {
    if (streamingText == null) return;
    const el = logContainerRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  }, [streamingText]);

  // The ids that make up MY last scene: my most-recent action + the GM
  // response(s) that answered it (up to my next action). Marked with a
  // persistent left accent, and flashed on my turn (see below).
  const myLastSceneIds = useMemo(() => {
    const set = new Set<string>();
    const myId = myCharacter?.id;
    if (!myId) return set;
    let start = -1;
    for (let i = storyLog.length - 1; i >= 0; i--) {
      if (storyLog[i].entry_type === "action" && storyLog[i].character_id === myId) { start = i; break; }
    }
    if (start < 0) return set;
    for (let i = start; i < storyLog.length; i++) {
      if (i > start && storyLog[i].entry_type === "action") break; // next player's turn begins
      set.add(storyLog[i].id);
    }
    return set;
  }, [storyLog, myCharacter?.id]);

  // Option 2: when the turn swings back to me (with 3 other players between my
  // turns my last scene is buried far up the log), scroll it into view and
  // flash it once so I don't have to hunt. Pure client render aid — no state.
  // NOTE the !pendingTurn guard: the server advances the turn pointer BEFORE it
  // generates the previous turn's narration, so without it this would yank the
  // view to a centred old scene while the new one was still streaming in.
  // Wait until the turn has actually resolved.
  const myTurnActive =
    !!room && room.current_turn_player_id === currentUserId && !pendingTurn;
  useEffect(() => {
    const was = prevMyTurnRef.current;
    prevMyTurnRef.current = myTurnActive;
    if (!myTurnActive || was || myLastSceneIds.size === 0) return;
    const firstId = myLastSceneIds.values().next().value as string | undefined;
    const el = firstId ? sceneRefs.current.get(firstId) : null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setAtBottom(false); // don't let the follow-the-bottom effect yank me back down
    setFlashScene(true);
    const t = setTimeout(() => setFlashScene(false), 2600);
    return () => clearTimeout(t);
  }, [myTurnActive, myLastSceneIds, currentUserId, room]);

  // Re-show the collapsed suggested actions when a new turn begins.
  useEffect(() => {
    setChoicesHidden(false);
  }, [room?.current_round]);

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

    // Same atomic handoff as submitAction: load first, then drop the thinking
    // indicator in the same commit as the opening scene appearing — otherwise
    // there is a blank gap for the length of the fetch.
    const snapshot = await loadAll();
    applySnapshot(snapshot);
    setGmThinking(false);
    setInitializing(false);
  }

  async function submitAction(text?: string, skill?: string | null) {
    const finalText = (text ?? actionText).trim();
    if (!finalText || !room || !myCharacter || !currentUserId) return;
    // An explicit per-call skill wins; otherwise use the manually-picked skill.
    const forcedSkill = skill !== undefined ? skill : selectedSkill;
    setSubmitting(true);
    streamingRef.current = true; // pause background polling for the duration
    setActionText("");
    setSelectedSkill(null);
    setSkillMenuOpen(false);

    // All game state changes (action save, turn advance, GM response) happen
    // server-side. The route streams the GM's narration back as NDJSON (one
    // JSON object per line: {type:"delta",text} while narrating, then a single
    // {type:"done",...} or {type:"error",...} at the end) so the player sees
    // the story appear token-by-token instead of staring at "thinking..." for
    // the whole turn.
    setGmThinking(true);
    setStreamingText("");
    try {
      const res = await fetch("/api/gm/respond", {
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
      // A refusal (e.g. a Mythos cast blocked: no MP / no target) is a plain
      // JSON error BEFORE any game write — the turn was NOT consumed. Restore
      // the input so the player can adjust and resend.
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        if (j?.error) window.alert(j.error);
        setActionText(finalText);
        setSelectedSkill(forcedSkill ?? null);
        setGmThinking(false);
        setStreamingText(null);
        setSubmitting(false);
        streamingRef.current = false;
        return;
      }
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let buf = "";
        let live = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
              const evt = JSON.parse(line);
              if (evt.type === "prelude" && Array.isArray(evt.rows)) {
                // Variant B: the mechanics (action + dice, 📍 travel, 📦 items,
                // SAN, unlocks) arrive BEFORE the narration. Render them now so
                // the player sees the move + 檢定 first, then the GM prose
                // streams in below. Supabase returns the characters join as an
                // array for the typed relation — normalize to { name }.
                const rows: StoryLogEntry[] = evt.rows.map((r: any) => ({
                  ...r,
                  characters: Array.isArray(r.characters) ? (r.characters[0] ?? null) : (r.characters ?? null),
                }));
                setStoryLog((prev) => {
                  const have = new Set(prev.map((e) => e.id));
                  const fresh = rows.filter((r) => !have.has(r.id));
                  return fresh.length ? [...prev, ...fresh] : prev;
                });
              } else if (evt.type === "delta" && typeof evt.text === "string") {
                live += evt.text;
                setStreamingText(live);
              }
              // "done"/"error" events carry the same info fetchAll() will pick
              // up from the DB right after — no need to act on them here.
            } catch {
              // Malformed line — ignore and keep reading; fetchAll() below is
              // the source of truth regardless.
            }
          }
        }
      }
    } catch {
      // non-blocking — fetchAll() below still syncs whatever the server
      // actually persisted, even if the stream connection itself hiccuped.
    }
    // ATOMIC HANDOFF. Keep the streamed narration on screen while the persisted
    // copy loads, then swap both in one synchronous block so React commits a
    // single render. Clearing gmThinking BEFORE the fetch (as this used to do)
    // unmounted the text and left a blank gap for the whole round-trip, so the
    // scene visibly vanished and popped back in.
    const snapshot = await loadAll();
    applySnapshot(snapshot);   // the real gm_response row is now in storyLog…
    setStreamingText(null);    // …so the live copy can go in the same commit
    setGmThinking(false);
    setSubmitting(false);
    streamingRef.current = false; // resume background polling
  }

  // A GM choice may be tagged like "[偵查] <Name> 翻找抽屜". Pull the skill out so
  // the roll matches the tag, and strip the tag from the action text we submit.
  function submitChoice(choice: string) {
    if (typeof choice !== "string" || !choice.trim()) return;
    const m = choice.match(/^\s*[\[【]\s*([^\]】]+?)\s*[\]】]\s*([\s\S]*)$/);
    if (m) {
      // Mythos tags map too — otherwise a clicked 「[萎縮術]」 choice would
      // submit as free text and cast nothing (the server double-checks
      // ownership/MP and refuses harmlessly if this actor can't cast it).
      const tag = m[1].trim();
      const key = SKILL_KEY_BY_ZH[tag] ?? MYTHOS_KEY_BY_ZH[tag] ?? null;
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
  // The server advances current_turn_player_id BEFORE generating the previous
  // turn's narration, so being "the current player" is not enough to act: the
  // last scene may still be mid-write. Acting then would start a second,
  // concurrent turn on top of an incomplete one. `pendingTurn` closes that
  // window (it clears the moment the gm_response row lands). `gmThinking`
  // means it is MY OWN submit in flight, which submitAction already guards.
  const turnIsResolving = !!pendingTurn && !gmThinking;
  const isMyTurn =
    room.current_turn_player_id === currentUserId && !iAmDead && !turnIsResolving;
  // Choices must belong to the current turn player — guards against stale one-turn-lag choices
  const choicesAreForMe = room.current_choices_for_player_id === currentUserId;
  const sortedByDex = [...characters].sort((a, b) => b.dex - a.dex);
  const currentTurnChar = sortedByDex.find((c) => c.user_id === room.current_turn_player_id);
  const allHaveChars = roomPlayers.length > 0 && roomPlayers.every((p) => p.character_id);
  const needsInit = room.status === "in_progress" && room.current_round === 0 && allHaveChars;
  const hasStarted = room.current_round > 0;

  // ─── Info panels, defined once and rendered in BOTH the desktop sidebar and
  // the mobile per-button popups (地點 / 物品 / 隊伍), so the JSX never diverges.
  const shortLoc = (n: string) => n.split(/[：:，,。．\.\n——–\-（(【\[]/)[0].trim().slice(0, 30);

  // Server-authoritative exits from MY character's own node (split-party: each
  // character stands somewhere; positionOf falls back to the legacy party
  // position for old rooms). Same math as the GM prompt.
  //
  // Computed ONCE here because two surfaces need it — the 地點 panel and the
  // 移動 button in the suggested actions. Recomputing per surface would let
  // them disagree about where you can go, which is the worst possible bug in a
  // control that moves your character.
  const travel = locGraph && room.location_state ? (() => {
    const ls = coerceLocationState(room.location_state, locGraph);
    const myNode = myCharacter ? positionOf(ls, myCharacter.id, locGraph) : ls.current;
    return { ls, myNode, exits: computeExits(locGraph, ls, myNode) };
  })() : null;

  // The 移動 button replaces the third suggestion only when there is somewhere
  // to actually go.
  const canMove = (travel?.exits.open.length ?? 0) > 0;

  const locationPanel = locGraph && travel && (() => {
    const { ls, myNode, exits } = travel;
    const current = locGraph.nodes.find((n) => n.id === myNode);
    const region = current?.container ? locGraph.containers.find((c) => c.id === current.container) : null;
    // Teammates elsewhere (shared party knowledge — everyone sees the map).
    const teammates = characters
      .filter((c) => c.id !== myCharacter?.id)
      .map((c) => ({ name: c.name, node: positionOf(ls, c.id, locGraph) }))
      .filter((tm) => tm.node && tm.node !== myNode);
    if (!current && exits.open.length === 0 && exits.locked.length === 0) {
      return <p className="text-zinc-600 text-xs">尚無已知地點</p>;
    }
    return (
      <Panel className="p-4 shrink-0">
        <PanelHeader title="地點" />
        <div className="flex flex-col gap-1.5">
          {current && (
            <div className="flex items-center gap-2 text-xs mb-1">
              <span className="shrink-0 w-4 flex items-center justify-center"><MapPin size={12} strokeWidth={2} /></span>
              <span className="text-gold font-semibold">
                {region && <span className="text-gold/60">{shortLoc(region.name)} › </span>}
                {shortLoc(current.name)}
              </span>
            </div>
          )}
          {teammates.length > 0 && (
            <div className="text-[11px] text-zinc-600 mb-1">
              {teammates.map((tm) => (
                <span key={tm.name} className="mr-2">
                  {tm.name} @ {shortLoc(locGraph.nodes.find((n) => n.id === tm.node)?.name ?? "")}
                </span>
              ))}
            </div>
          )}
          {exits.open.length > 0 && (
            <>
              <p className="text-[10px] tracking-wider text-zinc-600 mt-1">可前往</p>
              {exits.open.map((n) => {
                const visited = ls.visited.includes(n.id);
                const canGo = isMyTurn && !submitting;
                const label = (
                  <span className={visited ? "text-zinc-500" : "text-zinc-300"}>{shortLoc(n.name)}</span>
                );
                return (
                  <div key={n.id} className="flex items-center gap-2 text-xs">
                    <span className="shrink-0 w-4 flex items-center justify-center">{visited ? <CircleCheck size={12} strokeWidth={2} /> : <Circle size={10} strokeWidth={2} />}</span>
                    {canGo ? (
                      <button
                        type="button"
                        onClick={() => { setActionText(shortLoc(n.name)); setActivePanel(null); }}
                        title={shortLoc(n.name)}
                        className="text-left hover:text-gold hover:underline decoration-dotted underline-offset-2 transition-colors"
                      >
                        {label}
                      </button>
                    ) : label}
                  </div>
                );
              })}
            </>
          )}
          {exits.locked.length > 0 && (
            <>
              <p className="text-[10px] tracking-wider text-zinc-600 mt-1">看得到但進不去</p>
              {exits.locked.map((n) => (
                <div key={n.id} className="flex items-center gap-2 text-xs">
                  <span className="shrink-0 w-4 flex items-center justify-center"><Lock size={11} strokeWidth={2} /></span>
                  <span className="text-zinc-600">{shortLoc(n.name)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </Panel>
    );
  })();

  const itemPanel = (
    <Panel className="p-4 shrink-0">
      <PanelHeader title="隊伍物品" />
      {room.inventory && room.inventory.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {room.inventory.map((it, i) => (
            <span
              key={`${it.name}-${i}`}
              title={it.note || undefined}
              className="text-xs px-2 py-1 rounded inline-flex items-center gap-1"
              style={{ background: "rgba(14,12,8,0.8)", color: "#d4d4d8", border: "1px solid #2e2416" }}
            >
              <Package size={11} strokeWidth={2} />{it.name}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-zinc-600 text-xs">尚無物品</p>
      )}
    </Panel>
  );

  const teamPanel = (
    <>
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
                    {done ? <CircleCheck size={11} strokeWidth={2} /> : <Circle size={9} strokeWidth={2} />}
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
    </>
  );

  return (
    <>
    {/* Evidence / reveal image lightbox — click any 發現 image to inspect it full-size */}
    {lightboxSrc && (
      <div
        onClick={() => setLightboxSrc(null)}
        className="fixed inset-0 z-50 flex items-center justify-center p-6 cursor-zoom-out"
        style={{ background: "rgba(0,0,0,0.88)" }}
        role="dialog"
        aria-modal="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={lightboxSrc}
          alt="發現"
          onClick={(e) => e.stopPropagation()}
          className="max-w-full max-h-full rounded-lg cursor-default"
          style={{ border: "1px solid rgba(201,169,110,0.4)", boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }}
        />
        <button
          type="button"
          onClick={() => setLightboxSrc(null)}
          aria-label="關閉"
          className="fixed top-5 right-6 text-3xl text-zinc-300 hover:text-white leading-none"
        >
          ×
        </button>
      </div>
    )}
    {/* OOC player chat — floating button + slide-over drawer (GM never sees it) */}
    <ChatDrawer
      roomId={params.id}
      currentUserId={currentUserId}
      authorName={myCharacter?.name ?? currentUserEmail?.split("@")[0] ?? "玩家"}
    />
    {/* Faint occult texture behind the whole play view */}
    <div className="fixed inset-0 -z-10 pointer-events-none opacity-[0.04]" aria-hidden
      style={{ backgroundImage: "radial-gradient(circle, #c9a96e 1px, transparent 1px)", backgroundSize: "42px 42px" }} />
    <div className="fixed inset-x-0 top-14 bottom-0 z-30 flex flex-col gap-3 p-3 lg:static lg:z-auto lg:inset-auto lg:p-0 lg:grid lg:grid-cols-[1fr_280px] lg:gap-4 lg:h-[calc(100vh-7rem)]">
      {/* Main area */}
      <div className="flex flex-col gap-3 min-h-0 flex-1 lg:flex-none">
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
          {/* Ornate frame + decorations (fixed to the panel, not the scroll
              content). Hidden below sm — on a phone they only eat width/height
              that the narration needs. */}
          <div className="absolute inset-[6px] rounded-lg pointer-events-none z-10 hidden sm:block" style={{ border: "1px solid rgba(201,169,110,0.16)" }} />
          <Clip className="hidden sm:block -top-1.5 left-7" />
          <div className="absolute -top-2 right-9 px-3 py-1 rotate-3 pointer-events-none z-10 text-[10px] italic hidden sm:block"
            style={{ background: "rgba(40,34,24,0.92)", border: "1px solid rgba(201,169,110,0.2)", color: "rgba(201,169,110,0.5)", boxShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>
            observe · record
          </div>
          <div className="absolute bottom-5 right-6 pointer-events-none z-0 opacity-[0.10] hidden sm:block">
            <Seal size={88} glyph="◬" />
          </div>

          <div ref={logContainerRef} onScroll={onLogScroll} className="relative z-[1] flex-1 p-3 sm:p-5 overflow-y-auto min-h-0 flex flex-col gap-3">
          {storyLog.length === 0 && (
            <p className="text-zinc-600 text-sm italic text-center mt-8">
              {needsInit ? "準備就緒 — 點擊下方「開始冒險」！" : "等待所有玩家選擇調查員..."}
            </p>
          )}
          {storyLog.map((entry) => {
            const mine = myLastSceneIds.has(entry.id);
            const cls = `${mine ? "my-scene" : ""} ${mine && flashScene ? "scene-flash" : ""}`.trim();
            return (
            <div
              key={entry.id}
              ref={(el) => { if (el) sceneRefs.current.set(entry.id, el); else sceneRefs.current.delete(entry.id); }}
              className={cls || undefined}
            >
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
                  <span className="text-xs text-gold font-medium uppercase tracking-wider flex items-center gap-1 mb-2"><Search size={12} strokeWidth={2} />發現</span>
                  {entry.media_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.media_url}
                      alt="發現"
                      title="點擊放大檢視"
                      onClick={() => setLightboxSrc(entry.media_url!)}
                      className="rounded-lg w-full object-contain mb-2 border cursor-zoom-in hover:brightness-110 transition"
                      style={{ borderColor: "rgba(201,169,110,0.25)", maxHeight: "22rem", background: "rgba(0,0,0,0.25)" }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                  {entry.content && <GmText content={entry.content} />}
                </div>
              )}
            </div>
            );
          })}
          {gmThinking && (
            <div className="rounded-lg p-3.5" style={{ background: "rgba(20,16,11,0.5)", border: "1px solid rgba(201,169,110,0.10)" }}>
              <span className="text-xs text-gold/60 font-medium uppercase tracking-wider block mb-1">GM</span>
              {streamingText ? (
                <div className="gm-streaming">
                  <GmText content={streamingText} />
                  <span className="gm-caret" aria-hidden />
                </div>
              ) : (
                <span className="gm-thinking-line text-zinc-400 text-sm italic inline-flex items-center gap-1.5">
                  {THINKING_MESSAGES[thinkingMsgIdx]?.dice && <span className="dice-roll" aria-hidden />}
                  {THINKING_MESSAGES[thinkingMsgIdx]?.text ?? "主持人思考中…"}
                </span>
              )}
            </div>
          )}

          {/* GM IS NARRATING — shown to everyone except the player who
              submitted (they get the live streaming box instead).
              NOT gated on isMyTurn: the server advances current_turn_player_id
              BEFORE it generates the narration, so the *next* player already
              sees the turn as theirs while the previous scene is still being
              written. Gating this on !isMyTurn made it invisible to exactly the
              person most likely to be staring at the screen. */}
          {pendingTurn && !gmThinking && hasStarted && (
            <div className="rounded-lg p-3.5" style={{ background: "rgba(20,16,11,0.5)", border: "1px solid rgba(201,169,110,0.10)" }}>
              <span className="text-xs text-gold/60 font-medium uppercase tracking-wider block mb-1">GM</span>
              <span className="gm-thinking-line text-zinc-400 text-sm italic inline-flex items-center gap-1.5">
                <span className="dice-roll" aria-hidden />
                主持人正在敘述 {pendingTurn.name} 的行動…
              </span>
            </div>
          )}

          {/* WAITING ON A HUMAN — the active player has not chosen yet. */}
          {!pendingTurn && !isMyTurn && !gmThinking && hasStarted && !iAmDead && currentTurnChar && (
            <div className="rounded-lg px-3.5 py-2.5 flex items-center gap-2.5"
              style={{ background: "rgba(20,16,11,0.35)", border: "1px dashed rgba(201,169,110,0.16)" }}>
              <span className="waiting-pulse shrink-0" aria-hidden />
              <span className="text-zinc-500 text-sm italic">
                等待 <span className="text-gold/80 not-italic">{currentTurnChar.name}</span> 選擇行動
                <span className="waiting-dots" aria-hidden />
              </span>
            </div>
          )}
          <div ref={logEndRef} />
          </div>

          {/* Jump-to-latest button — appears only when scrolled away from the bottom */}
          {!atBottom && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-3 right-3 z-20 text-sm sm:text-xs font-medium px-4 py-2.5 sm:py-1.5 rounded-full shadow-lg flex items-center gap-1 transition-colors active:brightness-125"
              style={{ background: "rgba(26,21,14,0.97)", border: "1px solid rgba(201,169,110,0.45)", color: "#c9a96e" }}
            >
              <ArrowDown size={13} strokeWidth={2} />最新訊息
            </button>
          )}
        </div>

        {/* Suggested choices — only shown if they were generated FOR the current turn player */}
        {isMyTurn && choicesAreForMe && (room.current_choices?.length ?? 0) === 3 && hasStarted && (
          <div className="flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between">
              <p className="text-xs tracking-wider"><span className="text-gold font-medium">建議行動</span> <span className="text-zinc-600">— 或在下方輸入自己的行動</span></p>
              <button
                type="button"
                onClick={() => setChoicesHidden((h) => !h)}
                className="text-[11px] text-zinc-500 hover:text-gold transition-colors shrink-0 px-1"
              >
                {choicesHidden ? "顯示 ▾" : "隱藏 ▴"}
              </button>
            </div>
            {!choicesHidden && (
            <div className="grid grid-cols-1 gap-2">
              {/* The third slot is the fixed 移動 button whenever this scenario
                  actually has somewhere to go, so travel is always one click
                  away instead of depending on the GM happening to suggest it.
                  With no open exit (no location graph, or every way out
                  locked) the AI's third suggestion is shown instead — losing a
                  suggestion AND getting a dead button would be worse. */}
              {room.current_choices!.slice(0, canMove ? 2 : 3).map((c, i) => {
                // Split a "[技能] 行動" choice so the skill tag renders as its own chip.
                const m = typeof c === "string" ? c.match(/^\s*[\[【]\s*([^\]】]+?)\s*[\]】]\s*([\s\S]*)$/) : null;
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

              {canMove && (
                <div className="rounded-lg overflow-hidden" style={{ background: "rgba(26,21,14,0.6)", border: "1px solid #2e2416" }}>
                  <button
                    type="button"
                    onClick={() => setMoveOpen((o) => !o)}
                    disabled={submitting}
                    aria-expanded={moveOpen}
                    className="group w-full flex items-center gap-3 text-left px-4 py-3 transition-all disabled:opacity-40 hover:brightness-110"
                  >
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0 text-xs text-gold"
                      style={{ border: "1px solid rgba(201,169,110,0.35)" }}>3</span>
                    <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full text-gold inline-flex items-center gap-1"
                      style={{ background: "rgba(201,169,110,0.12)", border: "1px solid rgba(201,169,110,0.35)" }}>
                      <MapPin size={11} strokeWidth={2} />移動
                    </span>
                    <span className="text-zinc-300 group-hover:text-zinc-100 text-sm">
                      前往其他地點（{travel!.exits.open.length}）
                    </span>
                    <span className="ml-auto text-[11px] text-zinc-500 shrink-0">{moveOpen ? "▴" : "▾"}</span>
                  </button>

                  {moveOpen && (
                    <div className="px-3 pb-3 pt-1 flex flex-col gap-1.5" style={{ borderTop: "1px solid #2e2416" }}>
                      {travel!.exits.open.map((n) => {
                        const visited = travel!.ls.visited.includes(n.id);
                        return (
                          <button
                            key={n.id}
                            type="button"
                            // Submits the bare location name — the same string the
                            // 地點 panel writes into the action box, so the server's
                            // resolveTravelIntent sees input it already handles.
                            onClick={() => { setMoveOpen(false); submitChoice(shortLoc(n.name)); }}
                            disabled={submitting}
                            title={n.name}
                            className="flex items-center gap-2 text-left text-sm rounded-md px-3 py-2 transition-colors disabled:opacity-40 hover:brightness-125"
                            style={{ background: "rgba(14,12,8,0.5)", border: "1px solid #2a2010" }}
                          >
                            <span className="shrink-0 w-4 flex items-center justify-center text-zinc-500">
                              {visited ? <CircleCheck size={12} strokeWidth={2} /> : <Circle size={10} strokeWidth={2} />}
                            </span>
                            <span className={visited ? "text-zinc-500" : "text-zinc-200"}>{shortLoc(n.name)}</span>
                            {!visited && <span className="ml-auto text-[10px] text-gold/60 shrink-0">未探索</span>}
                          </button>
                        );
                      })}
                      {/* Locked exits are shown as dead entries, exactly as the
                          地點 panel already shows them — no new information is
                          revealed here, and hiding them would make the list look
                          wrong to anyone who has the panel open. */}
                      {travel!.exits.locked.map((n) => (
                        <div key={n.id} className="flex items-center gap-2 text-xs px-3 py-1.5 text-zinc-600">
                          <span className="shrink-0 w-4 flex items-center justify-center"><Lock size={11} strokeWidth={2} /></span>
                          {shortLoc(n.name)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            )}
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
          <div className="flex gap-2 sm:gap-3 items-stretch relative">
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
                <Dices size={14} strokeWidth={2} />
                <span className="whitespace-nowrap">{selectedSkill ? (SKILL_ZH[selectedSkill] ?? MYTHOS_ZH_BY_KEY[selectedSkill] ?? selectedSkill) : "技能"}</span>
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
                  {/* 禁咒 — shown ONLY when this card has Mythos spells bound.
                      Success = 30 + 克蘇魯知識; every cast costs 1d4 SAN + 3 MP. */}
                  {(myCharacter?.mythos_skills?.length ?? 0) > 0 && (
                    <div className="mt-1.5">
                      <p className="text-[10px] uppercase tracking-wider px-2 py-1" style={{ color: "rgba(155,120,190,0.75)" }}>禁咒 · 神話法術</p>
                      {MYTHOS_SPELLS.filter((s) => myCharacter!.mythos_skills!.includes(s.key)).map((s) => {
                        const rate = mythosSuccessRate(myCharacter?.cthulhu_knowledge);
                        const active = selectedSkill === s.key;
                        const noMp = (myCharacter?.mp ?? 0) < MYTHOS_MP_COST;
                        return (
                          <button
                            key={s.key}
                            type="button"
                            disabled={noMp}
                            title={noMp ? `魔力不足（需要 ${MYTHOS_MP_COST}）` : s.desc}
                            onClick={() => { setSelectedSkill(s.key); setSkillMenuOpen(false); }}
                            className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-sm hover:brightness-125 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: active ? "rgba(155,120,190,0.16)" : "transparent", color: active ? "#d9c8ec" : "#b3a1c6" }}
                          >
                            <span className="inline-flex items-center gap-1"><Sparkles size={12} strokeWidth={2} />{s.zh}</span>
                            <span className="tabular-nums text-[11px]" style={{ color: "#9b78be" }}>{rate}%＋代價</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
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
              placeholder={
                isMyTurn
                  ? "描述你的行動..."
                  : turnIsResolving
                    // It may already be THIS player's turn while the previous
                    // scene is still being written — say that, rather than
                    // telling them to wait for themselves.
                    ? `主持人正在敘述 ${pendingTurn?.name ?? ""} 的行動…`
                    : `等待 ${currentTurnChar?.name ?? "..."} 行動...`
              }
              disabled={!isMyTurn || submitting}
              className="flex-1 min-w-0 rounded-xl px-3 sm:px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-gold/50 disabled:opacity-50 transition-colors"
              style={{ background: "rgba(14,12,8,0.8)", border: "1px solid #2e2416" }}
            />
            <button
              onClick={() => submitAction()}
              disabled={!isMyTurn || !actionText.trim() || submitting}
              className="px-4 sm:px-7 py-3 rounded-xl font-serif text-sm shrink-0 transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
              style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07", boxShadow: "0 0 16px rgba(201,169,110,0.18)" }}
            >
              {submitting ? "..." : "送出"}
            </button>
          </div>
          {selectedSkill && (
            <p className="text-[11px] text-zinc-500 pl-1">
              {MYTHOS_ZH_BY_KEY[selectedSkill] ? (
                <>將施展禁咒 <span style={{ color: "#b18cd4" }}>{MYTHOS_ZH_BY_KEY[selectedSkill]}</span>（消耗 1d4 理智＋{MYTHOS_MP_COST} 魔力，失敗亦然）——</>
              ) : (
                <>將以 <span className="text-gold">{SKILL_ZH[selectedSkill] ?? selectedSkill}</span> 進行檢定 ——</>
              )}
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
                    className="px-6 py-2.5 rounded-lg font-serif transition-all hover:brightness-110 inline-flex items-center gap-1"
                    style={{ background: "linear-gradient(180deg,#c9a96e,#a8884f)", color: "#0c0a07" }}
                  >
                    選擇調查員以繼續 <ArrowRight size={14} strokeWidth={2} />
                  </button>
                );
              }
              return <span className="text-zinc-600">{allHaveChars ? "等待主持人開始..." : "等待所有玩家選擇調查員..."}</span>;
            })()}
          </div>
        )}

        {/* Mobile-only: a solid edge-to-edge bottom bar — three main buttons,
            each opening its own info panel as a bottom-sheet popup. Negative
            margins cancel the shell's padding so it reaches the screen edges.
            Hidden on desktop (the panels live in the right column there). */}
        <div className="flex lg:hidden -mx-3 -mb-3 shrink-0" style={{ borderTop: "1px solid rgba(201,169,110,0.22)" }}>
          {([
            { key: "location", icon: MapIcon, label: "地點" },
            { key: "item", icon: Backpack, label: "物品" },
            { key: "team", icon: Users, label: "隊伍" },
          ] as const).map((b, idx) => {
            const active = activePanel === b.key;
            const Icon = b.icon;
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => setActivePanel((p) => (p === b.key ? null : b.key))}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] transition-colors active:brightness-125"
                style={{
                  borderLeft: idx > 0 ? "1px solid rgba(46,36,22,0.9)" : "none",
                  background: active ? "rgba(201,169,110,0.16)" : "rgba(16,13,9,0.95)",
                  color: active ? "#e4d8be" : "#c9a96e",
                  boxShadow: active ? "inset 0 2px 0 #c9a96e" : "none",
                }}
              >
                <Icon size={18} strokeWidth={2} />
                <span className="text-[11px] tracking-wide">{b.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mobile-only: the active info panel as a bottom-sheet popup (partial
          height, dim backdrop). Desktop uses the right-hand column below. */}
      {activePanel && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setActivePanel(null)}>
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} />
          <div
            className="relative max-h-[65vh] overflow-y-auto p-4 pt-3 flex flex-col gap-3 rounded-t-2xl"
            style={{ background: "#0c0a07", borderTop: "1px solid rgba(201,169,110,0.3)", boxShadow: "0 -8px 32px rgba(0,0,0,0.6)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between shrink-0 pb-1">
              <span className="text-sm text-gold font-serif">
                {activePanel === "location" ? "地點" : activePanel === "item" ? "隊伍物品" : "隊伍狀態"}
              </span>
              <button
                type="button"
                onClick={() => setActivePanel(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-100"
                style={{ border: "1px solid #2e2416" }}
                aria-label="關閉"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            {activePanel === "location" ? locationPanel : activePanel === "item" ? itemPanel : teamPanel}
          </div>
        </div>
      )}

      {/* Sidebar — desktop right column only; mobile uses the popups above. */}
      <div className="hidden lg:flex flex-col gap-3 lg:overflow-y-auto">
        {locationPanel}
        {itemPanel}
        {teamPanel}
      </div>
    </div>
    </>
  );
}

// ─── Ending Screen ────────────────────────────────────────────────────────────

const ENDING_META: Record<string, { icon: LucideIcon; badge: string; accent: string; glow: string }> = {
  // Canonical ending types (lib/game/endings.ts).
  victory: { icon: Sparkles, badge: "勝利結局", accent: "#c9a96e", glow: "rgba(201,169,110,0.45)" },
  neutral: { icon: TrendingUp, badge: "中立結局", accent: "#fdba74", glow: "rgba(253,186,116,0.40)" },
  failure: { icon: X, badge: "失敗",     accent: "#fca5a5", glow: "rgba(252,165,165,0.40)" },
  // Legacy values kept for rooms completed before the type rename.
  best:    { icon: Sparkles, badge: "最佳結局", accent: "#c9a96e", glow: "rgba(201,169,110,0.45)" },
  normal:  { icon: CircleCheck, badge: "勝利",     accent: "#6ee7b7", glow: "rgba(110,231,183,0.40)" },
  bad:     { icon: TrendingUp, badge: "苦甜結局", accent: "#fdba74", glow: "rgba(253,186,116,0.40)" },
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
  const canGrow = endingAllowsGrowth(room.ending_type);
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
          {hasEnding ? <meta.icon size={28} strokeWidth={2} /> : <Swords size={28} strokeWidth={2} />}
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
          <TrendingUp size={16} strokeWidth={2} />角色成長 — 對本局成功使用過的技能進行成長檢定
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
            <span className="font-bold tracking-wider inline-flex items-center gap-1"><Dices size={13} strokeWidth={2} />{STAT_ZH[roll.stat_used ?? ""] ?? roll.stat_used?.toUpperCase()}</span>
            <span className="opacity-90">
              d100 = <b>{roll.d100_roll}</b> vs {roll.target}%
            </span>
            <span className="font-bold inline-flex items-center gap-1"><ArrowRight size={12} strokeWidth={2} />{style?.label ?? roll.outcome}</span>
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
            <span className="font-bold tracking-wider inline-flex items-center gap-1"><Swords size={13} strokeWidth={2} />攻擊 <ArrowRight size={12} strokeWidth={2} />{roll.attack.target_name}</span>
            {!roll.attack.hit ? (
              <span className="font-bold">落空</span>
            ) : roll.attack.crit ? (
              <span className="font-bold">重擊命中（無法閃避）</span>
            ) : roll.attack.dodge_roll != null ? (
              <span className="opacity-90 inline-flex items-center gap-1">
                閃避 d100 = <b>{roll.attack.dodge_roll}</b> vs {roll.attack.dodge_target}% <ArrowRight size={11} strokeWidth={2} />{roll.attack.dodged ? "閃過" : "未閃過"}
              </span>
            ) : null}
          </div>
          {roll.attack.damage > 0 && (
            <div className="mt-1 font-semibold">
              {roll.attack.skill_label}傷害 −{roll.attack.damage} HP
              {roll.attack.target_hp_after != null && !roll.attack.is_npc && `（剩餘 ${roll.attack.target_hp_after}）`}
              {roll.attack.target_died && <span className="ml-1 inline-flex items-center gap-1"><Skull size={12} strokeWidth={2} />倒下</span>}
            </div>
          )}
        </div>
      )}

      {/* SAN check box — separate roll for facing horror */}
      {sc && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${sc.success ? "text-teal-200 border-teal-800 bg-teal-950/30" : "text-rose-300 border-rose-700 bg-rose-950/40"}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold uppercase tracking-wider inline-flex items-center gap-1"><Brain size={13} strokeWidth={2} />理智檢定</span>
            <span className="opacity-80">{sc.severity_label}</span>
            <span className="opacity-90">d100 = <b>{sc.roll}</b> vs 意志 {sc.pow}</span>
            <span className="font-bold inline-flex items-center gap-1"><ArrowRight size={12} strokeWidth={2} />{sc.success ? "撐住" : "失守"}</span>
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
