-- === Atomic points mutation ===
-- Every points change (interlude claim credit, Old God prayer charge, future
-- sinks) was a read-modify-write in the API route: read points → check → write
-- read_value ± delta. Two concurrent requests both read the old value and the
-- second clobbers the first — e.g. two simultaneous prayers each pass the
-- "points >= 300" check on the same balance and both succeed for one charge.
--
-- adjust_points does the check-and-change in ONE statement so it's race-proof,
-- and is SECURITY DEFINER so it can be the ONLY path that writes users.points
-- (a later migration can drop the owner UPDATE policy and route all points
-- through here — closing the "client sets points=99999" hole).
--
-- Returns the NEW balance, or NULL when the guard fails (insufficient points).
--
-- RUN THIS MANUALLY in the Supabase SQL editor.

CREATE OR REPLACE FUNCTION public.adjust_points(
  p_user  UUID,
  p_delta INTEGER,
  p_min   INTEGER DEFAULT 0   -- required minimum BEFORE the change (e.g. cost)
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_points INTEGER;
BEGIN
  UPDATE public.users
     SET points = points + p_delta
   WHERE id = p_user
     AND points >= p_min
     AND points + p_delta >= 0     -- never let a balance go negative
  RETURNING points INTO new_points;
  RETURN new_points;               -- NULL if no row matched (guard failed)
END;
$$;

-- Callable by logged-in users (the function itself scopes to p_user, and the
-- API routes only ever pass the authenticated user's id).
GRANT EXECUTE ON FUNCTION public.adjust_points(UUID, INTEGER, INTEGER) TO authenticated;
