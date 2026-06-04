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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();


-- ----------------------------------------------------------------
-- RLS policies for public.users
-- ----------------------------------------------------------------

-- Users can read any row (usernames are displayed publicly in game rooms)
DROP POLICY IF EXISTS "users_select_own" ON public.users;
CREATE POLICY "users_select_own"
  ON public.users FOR SELECT
  USING (true);

-- Users can only insert their own row (fallback for auth/callback)
DROP POLICY IF EXISTS "users_insert_own" ON public.users;
CREATE POLICY "users_insert_own"
  ON public.users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Users can only update their own row
DROP POLICY IF EXISTS "users_update_own" ON public.users;
CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
