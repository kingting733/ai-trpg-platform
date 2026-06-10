/**
 * Cheap single-call summary — compresses older story log entries into 2 sentences.
 * Called at round boundaries so the per-turn user message stays constant-size
 * regardless of how long the game has been running.
 */

export interface LedgerEntry {
  turn: number;
  /** clue | npc_met | item | death | san_break | objective | event */
  type: string;
  character: string;
  fact: string;
}

export async function refreshStorySummary(
  currentSummary: string | null,
  ledger: LedgerEntry[],
  recentLog: string[],
  scenarioTitle: string,
  language: string | null | undefined,
): Promise<string> {
  const provider = process.env.AI_PROVIDER ?? "deepseek";
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return currentSummary ?? "";

  const langNote = language && language !== "auto"
    ? `Reply in the same language as the scenario (${language}).`
    : "Reply in the same language as the log entries.";

  const ledgerText = ledger.length
    ? `KEY FACTS LEDGER:\n${ledger.map((e) => `[Turn ${e.turn}] ${e.character}: ${e.fact}`).join("\n")}`
    : "KEY FACTS LEDGER: (none yet)";

  const logText = recentLog.length
    ? `RECENT LOG:\n${recentLog.join("\n")}`
    : "";

  const prevNote = currentSummary
    ? `PREVIOUS SUMMARY (build on this, don't repeat it verbatim):\n${currentSummary}`
    : "";

  const prompt = `You are a TRPG story archivist. Write a 2-sentence story arc summary of what has happened so far in "${scenarioTitle}". Focus on what the players discovered, who they met, and what changed — not individual dice rolls. Be concise. ${langNote}

${prevNote}

${ledgerText}

${logText}

Respond with ONLY the 2-sentence summary, nothing else.`;

  try {
    const baseOverride = process.env.AI_BASE_URL?.trim().replace(/\/+$/, "");
    const defaultBase = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com";
    const baseUrl = baseOverride ?? defaultBase;
    // Use AI_CLASSIFY_MODEL (fast non-thinking model) for this cheap summarisation
    // call so it doesn't block behind a reasoning model's thinking time.
    const model = process.env.AI_CLASSIFY_MODEL ?? process.env.AI_MODEL ?? "deepseek-v4-flash";
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 120,
        temperature: 0.3,
      }),
    });
    if (!res.ok) return currentSummary ?? "";
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? currentSummary ?? "";
  } catch {
    return currentSummary ?? "";
  }
}
