-- Starter investigator for new accounts (lib/cards/starter.ts).
-- RUN MANUALLY in the Supabase SQL editor.
--
-- A new sign-up could previously land on an empty roster: the daily draw is
-- capped at 3 per UTC day, so if that call failed or they had already drawn,
-- there was nothing to play with. Every new account now receives one free
-- average card.
--
-- This column is the exactly-once guard. It is NOT merely "does the user own a
-- card?" — that would re-grant a starter every time someone deletes their whole
-- roster. It records that the grant HAPPENED, independently of what the user
-- later does with the card.

alter table public.users
  add column if not exists starter_card_granted_at timestamptz;

-- EXISTING accounts are marked as already-granted, so this only ever affects
-- genuinely new sign-ups. (Remove this UPDATE if you actually want to
-- back-grant a starter card to everyone who already registered.)
update public.users
   set starter_card_granted_at = now()
 where starter_card_granted_at is null;

-- Atomic claim used by /api/characters/starter. Returns TRUE to exactly ONE
-- caller per user, even if several requests race (double-click, two tabs, the
-- login page and the auth callback firing together). The caller inserts the
-- card only when it wins. SECURITY DEFINER so it works with RLS enabled, and
-- it can only ever touch the row for the id it is given.
create or replace function public.claim_starter_card(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean;
begin
  update public.users
     set starter_card_granted_at = now()
   where id = p_user
     and starter_card_granted_at is null
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_starter_card(uuid) from public;
grant execute on function public.claim_starter_card(uuid) to authenticated, service_role;
