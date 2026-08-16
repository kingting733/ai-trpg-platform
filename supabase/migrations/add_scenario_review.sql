-- 劇本審核佇列 — scenarios must be reviewed before they reach the public list.
--
-- BEFORE: app/scenarios/new wrote status='published' straight from a button and
-- /scenarios listed every published row, so anything a creator wrote appeared
-- to every player immediately.
--
-- AFTER:  draft → (creator submits, passes the mechanical bar) → pending
--         → (admin approves) → published
--                            ↘ (admin rejects, with a note) → draft
--
-- The mechanical bar lives in lib/game/scenario-quality.ts and is enforced by
-- /api/scenarios/[id]/submit. THIS FILE enforces the half that must not be
-- bypassable from a browser console: only an admin may set status='published'.

-- 1. Review bookkeeping.
ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS submitted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by   uuid REFERENCES auth.users(id),
  -- Shown to the creator when a submission is sent back, so a rejection is
  -- actionable rather than mysterious.
  ADD COLUMN IF NOT EXISTS review_note   text;

-- 2. Allow the new 'pending' state if a CHECK constraint pins status.
--    Written defensively: the original schema is not in this migrations folder,
--    so the constraint may or may not exist, and may be named either way.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.scenarios'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.scenarios DROP CONSTRAINT %I', con_name);
  END IF;

  ALTER TABLE public.scenarios
    ADD CONSTRAINT scenarios_status_check
    CHECK (status IN ('draft', 'pending', 'published'));
END $$;

-- 3. Only admins may publish. A trigger rather than an RLS policy because the
--    creator's existing UPDATE policy is not in this repo — a trigger enforces
--    the rule no matter what the policies allow, and covers INSERT too (a
--    creator could otherwise insert a row already marked published).
CREATE OR REPLACE FUNCTION public.enforce_scenario_publish_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published')
     AND NOT public.is_admin()
  THEN
    RAISE EXCEPTION '劇本需要通過審核才能發佈（status=pending 後由管理員核准）。';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS scenarios_publish_gate ON public.scenarios;
CREATE TRIGGER scenarios_publish_gate
  BEFORE INSERT OR UPDATE ON public.scenarios
  FOR EACH ROW EXECUTE FUNCTION public.enforce_scenario_publish_gate();

-- 4. Creators must be able to see their own pending/rejected rows. Additive —
--    it does not touch whatever SELECT policy already exists for published.
DROP POLICY IF EXISTS "Creators can view their own scenarios" ON public.scenarios;
CREATE POLICY "Creators can view their own scenarios" ON public.scenarios
  FOR SELECT USING (creator_id = auth.uid());

-- 5. The review queue is read by exactly one query; keep it cheap.
CREATE INDEX IF NOT EXISTS idx_scenarios_pending
  ON public.scenarios (submitted_at DESC)
  WHERE status = 'pending';

-- NOTE — EXISTING ROWS ARE LEFT ALONE. Anything already 'published' stays
-- published; this gate applies to new transitions only. To send the current
-- library back through review, run separately and deliberately:
--   UPDATE public.scenarios SET status = 'draft' WHERE status = 'published';
