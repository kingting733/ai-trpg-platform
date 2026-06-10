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

  const prompt = `You are a TRPG story archivist writing a GM briefing for "${scenarioTitle}". Produce a SHORT structured brief in 4 lines (no headers, just the 4 lines) so the GM can instantly know the story state. ${langNote}

Format — 4 lines exactly:
SITUATION: [1 sentence — where the party is and what they are currently doing]
DISCOVERED: [key clues, items, or facts already found — list up to 4, or "none yet"]
UNRESOLVED: [the most important 1-2 threads still open — what the party hasn't found or figured out yet]
THREAT: [current danger level and any active threats — or "none yet"]

${prevNote}

${ledgerText}

${logText}

Respond with ONLY the 4 lines above, no extra text.`;

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
        max_tokens: 220,
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
