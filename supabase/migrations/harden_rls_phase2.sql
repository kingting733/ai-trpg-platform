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

-- 1) characters: drop ALL client INSERT policies (server routes own creation).
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'characters' and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.characters', pol.policyname);
    raise notice 'dropped characters INSERT policy: %', pol.policyname;
  end loop;
end $$;

-- 2) character_cards: defensively drop any client INSERT/UPDATE policies
--    (creation is /api/characters/open; every update path is service-role).
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

-- Verify: expect NO rows for (characters,INSERT) or (character_cards,INSERT/UPDATE);
-- SELECT policies must remain untouched.
select tablename, policyname, cmd from pg_policies
where schemaname = 'public'
  and tablename in ('characters', 'character_cards')
order by tablename, cmd;

-- Rollback (only if the routes are broken and you must restore the old flow):
-- create policy "Players can create own character" on public.characters
--   for insert with check (auth.uid() = user_id);
