"use client";

import type { ReactNode } from "react";
import { Brain, Flame, User, ScrollText, Compass, Package } from "lucide-react";
import { RARITY_ZH, itemFacts, type ItemDef, type ItemRarity } from "@/lib/game/items";

// 祭品詳情卡 — the one place an item is drawn in full: bracketed frame, icon
// tile, rarity chip, ornamented title rule, 主要效果 panel, 消耗 row, action row.
//
// The palette is the repo's own (gold #c9a96e on dark parchment, per-rarity
// accents from RARITY_ACCENT) rather than the neon violet of the reference
// mockup — only the LAYOUT is borrowed. Every accent is derived from one
// rarity color so a new rarity needs a single line, not a new theme.

export const RARITY_ACCENT: Record<ItemRarity, string> = {
  common: "#a1a1aa",
  rare: "#7dd3fc",
  epic: "#c4b5fd",
  legendary: "#c9a96e",
};

/** One accent color → the whole card's surfaces. Keeps rarity theming honest:
 *  no hand-picked per-rarity backgrounds that could drift apart. */
function tones(accent: string) {
  const a = (alpha: number) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
    return `rgba(${r},${g},${b},${alpha})`;
  };
  return { a, line: a(0.28), faint: a(0.14), wash: a(0.05) };
}

/** Corner brackets. Four absolutely-positioned L shapes — cheaper and crisper
 *  at any size than a border-image, and they never scale-blur. */
function Corners({ color }: { color: string }) {
  const base = "absolute w-4 h-4 pointer-events-none";
  return (
    <>
      <span className={`${base} top-1.5 left-1.5 border-t border-l rounded-tl-md`} style={{ borderColor: color }} />
      <span className={`${base} top-1.5 right-1.5 border-t border-r rounded-tr-md`} style={{ borderColor: color }} />
      <span className={`${base} bottom-1.5 left-1.5 border-b border-l rounded-bl-md`} style={{ borderColor: color }} />
      <span className={`${base} bottom-1.5 right-1.5 border-b border-r rounded-br-md`} style={{ borderColor: color }} />
    </>
  );
}

/** The watermark sigil behind the top-right corner, and the emblem beside
 *  主要效果 — the same eye so the card reads as one object. */
function Sigil({ color, size, opacity }: { color: string; size: number; opacity: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={{ opacity }} aria-hidden="true">
      <circle cx="24" cy="24" r="15" stroke={color} strokeWidth="0.8" />
      <path d="M9 24c6-7 24-7 30 0-6 7-24 7-30 0Z" stroke={color} strokeWidth="1.1" />
      <circle cx="24" cy="24" r="4" stroke={color} strokeWidth="1.1" />
      <circle cx="24" cy="24" r="1.6" fill={color} />
      {[0, 90, 180, 270].map((deg) => (
        <path key={deg} d="M24 2.5 25 8 24 9.5 23 8Z" fill={color} transform={`rotate(${deg} 24 24)`} />
      ))}
    </svg>
  );
}

function ItemGlyph({ item, color }: { item: ItemDef; color: string }) {
  const Icon =
    item.effect.type === "mythos_spell" ? ScrollText
    : item.effect.type === "interlude_growth_bonus" ? Compass
    : item.rarity === "legendary" ? Compass
    : Package;
  return <Icon size={34} strokeWidth={1.3} style={{ color }} />;
}

export interface ItemCardProps {
  item: ItemDef;
  /** false → the silhouette state (name and effects withheld). */
  owned?: boolean;
  /** Control rendered in the bottom row (a select, or a bound-state note). */
  action?: ReactNode;
  /** Label beside the action control, e.g. 選擇目標 / 裝備至. */
  actionLabel?: string;
  /** Rarity chip above the title. Off inside the collection, where the section
   *  heading already names the rarity and the chip just repeats it. */
  showRarity?: boolean;
}

export function ItemCard({ item, owned = true, action, actionLabel, showRarity = true }: ItemCardProps) {
  const accent = RARITY_ACCENT[item.rarity];
  const { a, line, faint, wash } = tones(accent);
  const facts = owned ? itemFacts(item) : null;

  return (
    <div
      className="relative rounded-2xl p-4 sm:p-5 overflow-hidden"
      style={{
        background: "linear-gradient(160deg, rgba(24,20,15,0.92), rgba(13,11,8,0.96))",
        border: `1px solid ${owned ? line : "#1f1a12"}`,
        opacity: owned ? 1 : 0.55,
      }}
    >
      <Corners color={owned ? faint : "#241e15"} />

      {/* Watermark — decorative only, and it must never eat clicks. */}
      <div className="absolute -top-3 -right-3 pointer-events-none">
        <Sigil color={accent} size={112} opacity={owned ? 0.09 : 0.04} />
      </div>

      {/* ── Header: glyph · rarity chip · title · rule · flavor ── */}
      <div className="relative flex items-start gap-4">
        <div
          className="w-[72px] h-[72px] sm:w-20 sm:h-20 rounded-xl shrink-0 flex items-center justify-center"
          style={{ background: "rgba(8,7,5,0.85)", border: `1px solid ${owned ? line : "#241e15"}`, boxShadow: `inset 0 0 24px ${wash}` }}
        >
          <ItemGlyph item={item} color={owned ? accent : "#3f3f46"} />
        </div>

        <div className="min-w-0 flex-1 pt-0.5">
          {showRarity && (
            <span
              className="inline-block text-[10px] px-2 py-0.5 rounded tracking-[0.15em]"
              style={{ border: `1px solid ${owned ? a(0.45) : "#2a2418"}`, color: owned ? accent : "#52525b", background: "rgba(0,0,0,0.3)" }}
            >
              {RARITY_ZH[item.rarity]}
            </span>
          )}

          <h3
            className={`font-serif text-xl sm:text-2xl truncate ${showRarity ? "mt-1.5" : ""}`}
            style={{ color: owned ? "#e4d8be" : "#52525b", letterSpacing: "0.04em" }}
            title={owned ? item.name : undefined}
          >
            {owned ? item.name : "？？？"}
          </h3>

          <div className="flex items-center gap-2 my-2" aria-hidden="true">
            <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, transparent, ${a(0.4)})` }} />
            <span className="rotate-45 w-1.5 h-1.5 shrink-0" style={{ background: owned ? a(0.65) : "#2a2418" }} />
            <span className="h-px flex-1" style={{ background: `linear-gradient(270deg, transparent, ${a(0.4)})` }} />
          </div>

          <p className="text-xs sm:text-[13px] italic leading-relaxed" style={{ color: owned ? "#8a8070" : "#3f3f46" }}>
            {owned ? item.flavor : "尚未從煙霧中歸來。"}
          </p>
        </div>
      </div>

      {facts && (
        <>
          {/* ── 主要效果 ── */}
          <div className="relative mt-4 rounded-xl flex" style={{ border: `1px solid ${faint}`, background: "rgba(0,0,0,0.22)" }}>
            <div className="hidden sm:flex w-[104px] shrink-0 items-center justify-center" style={{ borderRight: `1px solid ${faint}`, background: wash }}>
              <Sigil color={accent} size={56} opacity={0.55} />
            </div>
            <div className="p-3.5 min-w-0 flex-1">
              <p className="text-[11px] tracking-[0.15em] mb-1.5 flex items-center gap-1.5" style={{ color: accent }}>
                <span className="rotate-45 w-1.5 h-1.5 inline-block" style={{ background: accent }} />
                主要效果
              </p>
              <p className="text-[13px] leading-relaxed" style={{ color: "#cbb890" }}>{facts.effect}</p>
              {facts.lines.map((l) => (
                <p key={l} className="text-[11px] leading-relaxed mt-1" style={{ color: "#8a8070" }}>{l}</p>
              ))}
            </div>
          </div>

          {/* ── 消耗 — only for items that cost something per use ── */}
          {facts.cost && (
            <div className="mt-2.5 rounded-xl flex items-stretch" style={{ border: `1px solid ${faint}`, background: "rgba(0,0,0,0.22)" }}>
              <div className="px-3 flex items-center shrink-0" style={{ borderRight: `1px solid ${faint}`, background: wash }}>
                <span className="text-[11px] tracking-[0.15em]" style={{ color: accent }}>消耗</span>
              </div>
              <div className="px-3.5 py-2.5 flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "#cbb890" }}>
                  <Brain size={15} strokeWidth={1.6} style={{ color: "#8fa6c4" }} />
                  {facts.cost.san} 理智
                </span>
                <span className="text-zinc-600 text-xs">＋</span>
                <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "#cbb890" }}>
                  <Flame size={15} strokeWidth={1.6} style={{ color: accent }} />
                  {facts.cost.mp} 魔力
                </span>
                {facts.targeting && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ color: "#8a8070", border: `1px solid ${faint}` }}>
                    {facts.targeting}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── Action row ── */}
          {action && (
            <div className="mt-2.5 rounded-xl flex items-stretch" style={{ border: `1px solid ${faint}`, background: "rgba(0,0,0,0.22)" }}>
              {actionLabel && (
                <div className="px-3 hidden sm:flex items-center gap-1.5 shrink-0" style={{ borderRight: `1px solid ${faint}`, background: wash }}>
                  <User size={13} strokeWidth={1.6} style={{ color: accent }} />
                  <span className="text-[11px] tracking-[0.1em] whitespace-nowrap" style={{ color: accent }}>{actionLabel}</span>
                </div>
              )}
              <div className="px-2.5 py-2 flex-1 min-w-0">{action}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
