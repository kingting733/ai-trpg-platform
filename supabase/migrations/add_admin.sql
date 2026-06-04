-- ============================================================
-- ADMIN CAPABILITIES
-- ------------------------------------------------------------
-- Adds an is_admin() helper and additive RLS policies that let users whose
-- role = 'admin' (in public.users) view ALL scenarios and delete any scenario
-- or room. These are PERMISSIVE policies — they are OR'd with the existing
-- creator-only policies, so normal users are completely unaffected.
--
-- To make yourself an admin, run (replacing the email):
--   UPDATE public.users SET role = 'admin' WHERE email = 'you@example.com';
-- ============================================================

-- SECURITY DEFINER so the role lookup is not itself blocked by RLS, and stable
-- so the planner can cache it within a statement.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Admins can see every scenario (drafts included) regardless of creator.
DROP POLICY IF EXISTS "Admins can view all scenarios" ON public.scenarios;
CREATE POLICY "Admins can view all scenarios" ON public.scenarios
  FOR SELECT USING (public.is_admin());

-- Admins can delete any scenario.
DROP POLICY IF EXISTS "Admins can delete any scenario" ON public.scenarios;
CREATE POLICY "Admins can delete any scenario" ON public.scenarios
  FOR DELETE USING (public.is_admin());

-- Admins can delete any room (used to clean up stuck/abandoned games, and is
-- required before deleting a scenario because rooms.scenario_id has no cascade).
-- Deleting a room cascades to room_players, characters, turns, actions, story_logs.
DROP POLICY IF EXISTS "Admins can delete any room" ON public.rooms;
CREATE POLICY "Admins can delete any room" ON public.rooms
  FOR DELETE USING (public.is_admin());
