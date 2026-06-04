-- Automatically creates a public.users profile row whenever a new auth.users
-- record is inserted (covers both email confirmation and OAuth flows).
-- Runs as SECURITY DEFINER so it bypasses RLS during the pre-session window.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _username TEXT;
BEGIN
  -- Prefer the username supplied at signup time; fall back to email prefix + id fragment.
  _username := COALESCE(
    NULLIF(TRIM((NEW.raw_user_meta_data->>'username')::TEXT), ''),
    LEFT(SPLIT_PART(NEW.email, '@', 1), 20) || '_' || LEFT(NEW.id::TEXT, 4)
  );

  INSERT INTO public.users (id, email, username)
  VALUES (NEW.id, NEW.email, _username)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Drop old trigger if it exists (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();


-- ----------------------------------------------------------------
-- RLS verification: ensure policies cover public.users
-- ----------------------------------------------------------------

-- Users can read their own row
DROP POLICY IF EXISTS "users_select_own" ON public.users;
CREATE POLICY "users_select_own"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

-- Users can update only their own row (username only — email is managed by auth)
DROP POLICY IF EXISTS "users_update_own" ON public.users;
CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- INSERT is handled by the trigger (SECURITY DEFINER), so no INSERT policy needed
-- for normal users. If you want to allow the client to insert as a fallback, add:
-- DROP POLICY IF EXISTS "users_insert_own" ON public.users;
-- CREATE POLICY "users_insert_own"
--   ON public.users FOR INSERT
--   WITH CHECK (auth.uid() = id);

-- Allow the trigger function's service role to insert (no policy needed for SECURITY DEFINER)
