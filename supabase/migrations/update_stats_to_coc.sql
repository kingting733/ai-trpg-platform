-- Migration: Replace old D&D-style stats with CoC-style stats (×5 scale)
--
-- character_cards: str/con/siz/dex/app/int/pow/edu/luck  (replaces str/agi/int/cha/luck/speed/san)
-- characters:      same stat set, plus skills JSONB
--
-- RUN ONCE against your Supabase project.
-- CAUTION: drops old columns — existing card/character rows will lose their old stats.

-- ── character_cards ──────────────────────────────────────────────────────────

ALTER TABLE public.character_cards
  ADD COLUMN IF NOT EXISTS con  INTEGER,
  ADD COLUMN IF NOT EXISTS siz  INTEGER,
  ADD COLUMN IF NOT EXISTS dex  INTEGER,
  ADD COLUMN IF NOT EXISTS app  INTEGER,
  ADD COLUMN IF NOT EXISTS pow  INTEGER,
  ADD COLUMN IF NOT EXISTS edu  INTEGER,
  ADD COLUMN IF NOT EXISTS mp   INTEGER,
  ADD COLUMN IF NOT EXISTS skills JSONB;

-- Back-fill nulls with sensible defaults so the NOT NULL constraint can be added.
UPDATE public.character_cards SET
  con  = COALESCE(con,  50),
  siz  = COALESCE(siz,  65),
  dex  = COALESCE(dex,  str), -- dex replaces agi/speed; use str as proxy if missing
  app  = COALESCE(app,  50),
  pow  = COALESCE(pow,  san),
  edu  = COALESCE(edu,  65),
  mp   = COALESCE(mp,   FLOOR(COALESCE(san, 50) / 5))
WHERE con IS NULL;

-- Enforce NOT NULL now that defaults are set.
ALTER TABLE public.character_cards
  ALTER COLUMN con  SET NOT NULL,
  ALTER COLUMN siz  SET NOT NULL,
  ALTER COLUMN dex  SET NOT NULL,
  ALTER COLUMN app  SET NOT NULL,
  ALTER COLUMN pow  SET NOT NULL,
  ALTER COLUMN edu  SET NOT NULL,
  ALTER COLUMN mp   SET NOT NULL;

-- Remove old columns that no longer exist in the schema.
ALTER TABLE public.character_cards
  DROP COLUMN IF EXISTS agi,
  DROP COLUMN IF EXISTS cha,
  DROP COLUMN IF EXISTS speed;

-- ── characters ────────────────────────────────────────────────────────────────

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS con  INTEGER,
  ADD COLUMN IF NOT EXISTS siz  INTEGER,
  ADD COLUMN IF NOT EXISTS dex  INTEGER,
  ADD COLUMN IF NOT EXISTS app  INTEGER,
  ADD COLUMN IF NOT EXISTS pow  INTEGER,
  ADD COLUMN IF NOT EXISTS edu  INTEGER,
  ADD COLUMN IF NOT EXISTS mp   INTEGER,
  ADD COLUMN IF NOT EXISTS skills JSONB;

UPDATE public.characters SET
  con  = COALESCE(con,  50),
  siz  = COALESCE(siz,  65),
  dex  = COALESCE(dex,  COALESCE(speed, str, 50)),
  app  = COALESCE(app,  COALESCE(cha,   50)),
  pow  = COALESCE(pow,  COALESCE(san,   50)),
  edu  = COALESCE(edu,  65),
  mp   = COALESCE(mp,   FLOOR(COALESCE(san, 50) / 5))
WHERE con IS NULL;

ALTER TABLE public.characters
  ALTER COLUMN con  SET NOT NULL,
  ALTER COLUMN siz  SET NOT NULL,
  ALTER COLUMN dex  SET NOT NULL,
  ALTER COLUMN app  SET NOT NULL,
  ALTER COLUMN pow  SET NOT NULL,
  ALTER COLUMN edu  SET NOT NULL,
  ALTER COLUMN mp   SET NOT NULL;

ALTER TABLE public.characters
  DROP COLUMN IF EXISTS agi,
  DROP COLUMN IF EXISTS cha,
  DROP COLUMN IF EXISTS speed;
