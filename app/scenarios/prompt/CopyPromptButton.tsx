"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

/** Copy-to-clipboard with a short confirmation state. Falls back to selecting
 *  the text when the Clipboard API is unavailable (http, old browsers). */
export function CopyPromptButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — let the user copy manually.
      window.prompt("複製下面的 Prompt：", text);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 px-3 py-1.5 rounded-lg text-xs transition-all hover:brightness-110 inline-flex items-center gap-1.5"
      style={
        copied
          ? { background: "rgba(6,78,59,0.4)", border: "1px solid rgba(16,94,66,0.7)", color: "#6ee7b7" }
          : { background: "rgba(201,169,110,0.14)", border: "1px solid rgba(201,169,110,0.45)", color: "#c9a96e" }
      }
    >
      {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={2} />}
      {copied ? "已複製" : "複製 Prompt"}
    </button>
  );
}
