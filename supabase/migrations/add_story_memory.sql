-- Rolling summary: 2-sentence arc of everything older than the last few turns.
-- Regenerated every round boundary — cheap, stays stable while recent turns are fresh.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS story_summary TEXT DEFAULT NULL;

-- Structured ledger: key facts that must never be forgotten regardless of summary.
-- Each entry: { turn: number, type: string, character: string, fact: string }
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS story_ledger JSONB DEFAULT '[]'::jsonb;
