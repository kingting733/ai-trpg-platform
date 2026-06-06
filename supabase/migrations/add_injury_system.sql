-- === Real injury system (hybrid: GM flags, server rolls & applies) ===

-- Tracks NPCs that have entered danger — lazily created on first injury report.
-- Shape: { "<npc name>": { hp: number, max_hp: number, alive: boolean } }
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS npc_states JSONB DEFAULT '{}'::jsonb;

-- Enforces "each character may receive first aid at most once per scene".
-- Scene is approximated by round number; resets when the round advances.
-- Shape: { "round": number, "healed": ["<character name>", ...] }
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS first_aid_log JSONB DEFAULT '{"round": 0, "healed": []}'::jsonb;
