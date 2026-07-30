-- SECURITY HARDENING — PHASE 2 (INSERT-forge vectors)
-- docs/design/security-hardening-pass.md
--
-- RUN MANUALLY in the Supabase SQL editor, ONLY AFTER the code deploy that
-- adds the server routes /api/rooms/[id]/select-card and
-- /api/rooms/[id]/create-character (they perform the inserts via service
-- role). Running this before that deploy breaks character creation.
--
-- What this closes: the client-side `characters` INSERT let a modified
-- browser forge ANY stats into a room — hp/san/skills, and since Mythos v1
-- also cthulhu_knowledge and mythos_skills (free spells + 70% cast rate).
-- Card creation itself was already server-side (/api/characters/open), but
-- we defensively drop any client INSERT/UPDATE on character_cards too in
-- case the base schema declared one.

-- 1) characters: drop ALL client INSERT *and* UPDATE policies. Server routes
--    own creation; every in-game write is service-role (GM route, admin
--    client) and bypasses RLS. A surviving UPDATE policy — even one gated to
--    "room is waiting" — is a forge vector: it has no WITH CHECK, so a player
--    can set their own hp/san/skills/cthulhu_knowledge/mythos_skills in the
--    lobby and start the game with forged values.
do $$
declare pol record;
begin
  for pol in
    select policyname, cmd from pg_policies
    where schemaname = 'public' and tablename = 'characters'
      and cmd in ('INSERT', 'UPDATE')
  loop
    execute format('drop policy %I on public.characters', pol.policyname);
    raise notice 'dropped characters % policy: %', pol.cmd, pol.policyname;
  end loop;
end $$;

-- 2) character_cards: drop any client INSERT/UPDATE policies.
--    PREREQUISITE — every route that writes this table MUST already use
--    createAdminClient(), or it will start failing with
--    "new row violates row-level security policy". Verified writers:
--      /api/characters/open        INSERT (daily card draw)
--      /api/characters/[id]        DELETE
--      /api/characters/[id]/rename UPDATE
--      /api/characters/[id]/skills UPDATE
--      /api/items/equip            UPDATE
--      /api/mythos/bind            UPDATE
--      /api/interlude/claim        UPDATE
--      /api/rooms/[id]/growth      UPDATE
--    Each one authenticates via getUser() and scopes every write with
--    .eq("user_id", user.id) — that guard IS the ownership check now, because
--    RLS no longer backstops it. Do not remove it.
--    NOTE: this loop also removes DELETE-adjacent gaps only if such policies
--    exist; character_cards ends up with SELECT-only client access.
do $$
declare pol record;
begin
  for pol in
    select policyname, cmd from pg_policies
    where schemaname = 'public' and tablename = 'character_cards'
      and cmd in ('INSERT', 'UPDATE')
  loop
    execute format('drop policy %I on public.character_cards', pol.policyname);
    raise notice 'dropped character_cards % policy: %', pol.cmd, pol.policyname;
  end loop;
end $$;

-- Verify: expect NO rows for (characters,INSERT/UPDATE) or
-- (character_cards,INSERT/UPDATE); only the two SELECT policies remain.
select tablename, policyname, cmd from pg_policies
where schemaname = 'public'
  and tablename in ('characters', 'character_cards')
order by tablename, cmd;

-- Rollback (only if the routes are broken and you must restore the old flow):
-- create policy "Players can create own character" on public.characters
--   for insert with check (auth.uid() = user_id);
