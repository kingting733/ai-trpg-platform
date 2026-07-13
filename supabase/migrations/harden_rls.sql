-- === Security hardening: server-only writes for state/economy tables ===
-- Executes docs/design/security-hardening-pass.md. Before this, every owner
-- INSERT/UPDATE policy meant a player's browser could write those rows directly
-- (bypassing the API routes' server logic) — forge points/items/missions/growth,
-- and — worst — edit their own in-room HP/SAN/skills mid-scenario (the
-- `characters` UPDATE policy had USING but NO WITH CHECK, so it never
-- constrained the new values).
--
-- After this migration the affected writes happen ONLY through the API routes
-- using the service-role client (which bypasses RLS); the client keeps SELECT
-- on its own rows and the two legitimate creation INSERTs (profile, in-room
-- character snapshot — see the "phase 2" note below).
--
-- ⚠ PREREQUISITE: the routes must already use createAdminClient() for these
-- writes (shipped in the same commit). Run this AFTER deploying that code, or
-- the writes will fail until it deploys.
--
-- RUN THIS MANUALLY in the Supabase SQL editor.

-- ── Meta economy: server-only INSERT/UPDATE (SELECT-own policies stay) ──
DROP POLICY IF EXISTS "users_update_own"         ON public.users;         -- points via adjust_points / admin only
DROP POLICY IF EXISTS "user_items_insert_own"    ON public.user_items;    -- mint via /api/pray only
DROP POLICY IF EXISTS "card_missions_insert_own" ON public.card_missions; -- /api/interlude/dispatch only
DROP POLICY IF EXISTS "card_missions_update_own" ON public.card_missions; -- claim / cancel only
DROP POLICY IF EXISTS "card_growth_insert_own"   ON public.card_growth;   -- /api/rooms/[id]/growth only

-- ── In-room character state: the critical hole ──
-- Server writes HP/SAN from resolved dice; nothing client-side updates a
-- character during play. (INSERT of the snapshot is kept — see phase 2.)
DROP POLICY IF EXISTS "Players can update own character during play" ON public.characters;

-- ── character_cards: drop ALL update-command policies by scanning pg_policies,
-- since the base-schema policy name is unknown. Rename / skill-allocation /
-- equip / growth / cleared-scenarios now go through the routes' admin client.
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'character_cards' AND cmd = 'UPDATE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.character_cards', pol.policyname);
  END LOOP;
END $$;

-- ── ROLLBACK (paste to restore, if a route write breaks) ──
-- CREATE POLICY "users_update_own" ON public.users FOR UPDATE
--   USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
-- CREATE POLICY "user_items_insert_own" ON public.user_items FOR INSERT WITH CHECK (user_id = auth.uid());
-- CREATE POLICY "card_missions_insert_own" ON public.card_missions FOR INSERT WITH CHECK (user_id = auth.uid());
-- CREATE POLICY "card_missions_update_own" ON public.card_missions FOR UPDATE USING (user_id = auth.uid());
-- CREATE POLICY "card_growth_insert_own" ON public.card_growth FOR INSERT WITH CHECK (user_id = auth.uid());
-- (characters/character_cards UPDATE policies: re-create from the base schema if needed.)

-- ── PHASE 2 (not done here — tracked in the design doc) ──
-- Creation-forge vectors still open: character_cards INSERT (a client could
-- insert a maxed card, bypassing /api/characters/open's dice + daily limit) and
-- characters INSERT (a client could insert a snapshot with forged HP/SAN,
-- bypassing the card values). Closing them requires moving card draw and the
-- in-room snapshot creation fully behind admin-only routes + dropping those
-- INSERT policies. Lower severity than the UPDATE holes closed above (forge at
-- creation only), but do before a truly open/public launch.
