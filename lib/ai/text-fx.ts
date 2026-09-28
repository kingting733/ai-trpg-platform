// Horror text effects ([[dread]] / [[eerie]] …) — WHEN they appear is decided
// by the server, not left to the GM's taste.
//
// WHY: the effects renderer (GmText in app/rooms/[id]/page.tsx) was always
// there, but the only trigger was the GM choosing to emit a marker, and every
// later prompt layer pushed it not to — the format rule says "use SPARINGLY…
// if in doubt, leave it plain. Most turns should use none", and the 網文 voice
// block injected above it is all restraint, with a worked example that has no
// markers at all. The model complied: players stopped seeing effects.
//
// Now: on any turn where the SAN system detected horror (lib/game/resolution.ts
// resolveSanCheck), the GM is told an effect is REQUIRED (buildTurnMessage),
// and ensureHorrorFx() is the safety net — if the GM still emitted none, it
// wraps the horror word that triggered the SAN check, but ONLY when that word
// literally appears in the narration. Nothing is invented.
//
// Pure: no I/O. Keep FX_TAGS in sync with FX_TAGS in app/rooms/[id]/page.tsx.

import type { SanSeverity } from "@/lib/game/resolution";

export const FX_TAGS = ["dread", "whisper", "chant", "key", "eerie"] as const;
export type FxTag = (typeof FX_TAGS)[number];
export type HorrorFx = "dread" | "eerie";

const TAG_ALT = FX_TAGS.join("|");
const FX_SPAN_RE = new RegExp(`\\[\\[(${TAG_ALT})\\]\\][\\s\\S]+?\\[\\[\\/\\1\\]\\]`, "g");
const BOLD_RE = /\*\*[\s\S]+?\*\*/g;

/** Milder, "something is wrong" horror → eerie; everything heavier → dread. */
export function horrorFxTag(severity: SanSeverity): HorrorFx {
  return severity === "obvious" ? "eerie" : "dread";
}

/** Effect tags present in the text as complete, well-formed spans. */
export function fxTagsIn(text: string): FxTag[] {
  const out: FxTag[] = [];
  for (const m of Array.from(text.matchAll(FX_SPAN_RE))) out.push(m[1] as FxTag);
  return out;
}

/** Ranges that must not be wrapped: existing effect spans and **bold** runs
 *  (the renderer matches bold first, so a marker inside it would leak raw). */
function protectedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const re of [FX_SPAN_RE, BOLD_RE]) {
    for (const m of Array.from(text.matchAll(re))) ranges.push([m.index!, m.index! + m[0].length]);
  }
  return ranges;
}

/**
 * Guarantee a horror turn carries its effect.
 * - No horror this turn, or the GM already emitted dread/eerie → unchanged.
 * - Otherwise wrap the first unprotected occurrence of the SAN trigger word
 *   (≥2 characters — a lone 「鬼」 in blood-red reads as a glitch, not a scare).
 * - Trigger absent from the narration → unchanged, reported as not added.
 */
export function ensureHorrorFx(
  narration: string,
  required: HorrorFx | null,
  trigger: string | null
): { text: string; emitted: FxTag[]; added: boolean } {
  const emitted = fxTagsIn(narration);
  if (!required || emitted.includes("dread") || emitted.includes("eerie")) {
    return { text: narration, emitted, added: false };
  }
  const word = (trigger ?? "").trim();
  if (word.length < 2) return { text: narration, emitted, added: false };

  const ranges = protectedRanges(narration);
  let from = 0;
  while (from <= narration.length) {
    const at = narration.indexOf(word, from);
    if (at === -1) break;
    const end = at + word.length;
    const inside = ranges.some(([a, b]) => at < b && end > a);
    if (!inside) {
      const text = `${narration.slice(0, at)}[[${required}]]${word}[[/${required}]]${narration.slice(end)}`;
      return { text, emitted, added: true };
    }
    from = at + 1;
  }
  return { text: narration, emitted, added: false };
}
