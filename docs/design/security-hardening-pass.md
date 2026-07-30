# Security Hardening Pass

Status: **Phase 1 EXECUTED** (2026-07-13) — code shipped + `harden_rls.sql`
written. **Phase 2 EXECUTED in code** (2026-07-18) — character creation moved
server-side (`/api/rooms/[id]/select-card` + `/api/rooms/[id]/create-character`
derive every stat server-side; the client only names the card / the name), and
`harden_rls_phase2.sql` drops all client INSERT policies on `characters` plus
any INSERT/UPDATE on `character_cards`. **Run `harden_rls_phase2.sql` AFTER the
code deploy** — running it first breaks character creation. Motivating urgency:
with Mythos v1, the old client-side insert could forge `cthulhu_knowledge` /
`mythos_skills` (free spells at 70% cast rate), not just hp/skills.

## RULE: hardened table ⇒ service-role write

Once a table's client INSERT/UPDATE/DELETE policies are dropped, **every** route
that writes it must use `createAdminClient()`. Missing one does not fail at
build or typecheck — it fails at runtime with
`new row violates row-level security policy for table "<t>"`, and only on the
code path a user happens to hit. This bit us once: `/api/characters/open`
(the daily card draw) and `/api/characters/[id]` (delete) were still on the
user client after phase 2 dropped `character_cards` INSERT/UPDATE.

Audit command — run after ANY hardening change, expect no `admin:NO`:

```bash
for t in character_cards characters user_items card_missions card_growth users; do
  echo "### $t"
  for f in $(grep -rl "from(\"$t\")" app --include="*.ts"); do
    w=$(grep -A3 "from(\"$t\")" $f | grep -oE "\.(insert|update|delete)\(" | sort -u | tr '\n' ' ')
    [ -z "$w" ] && continue
    a=$(grep -c "createAdminClient" $f)
    printf "   %-46s writes:%-24s admin:%s\n" "$f" "$w" "$([ $a -gt 0 ] && echo yes || echo NO)"
  done
done
```

Note `users` keeps `users_insert_own` (signup bootstrap in
`/auth/callback`) — only `users_update_own` was dropped, so points can move
solely via `adjust_points`/service-role.

## Deploy order (IMPORTANT)
1. `SUPABASE_SERVICE_ROLE_KEY` must be set in Vercel (it already is — the daily
   cron `lib/server/daily-runner.ts` uses it). The hardened routes now REQUIRE
   it: `createAdminClient()` throws without it and those routes would 500.
2. Deploy the code (routes use the admin client for the sensitive writes).
3. THEN run `supabase/migrations/harden_rls.sql` in the SQL editor to drop the
   owner write policies. (Running it before the code deploys would break those
   writes until the deploy lands.)
4. Run the 7-case exploit-denial test plan below.

Original framing (kept for context): safe to defer while only friends play
(cheating in a co-op story hurts nobody); mandatory the moment a stranger can
register.

## The core problem

Every API route talks to Supabase as the **logged-in user's** client (anon key
+ their session). So **Row Level Security is the only thing standing between a
player's browser devtools and the database.** Wherever a policy grants the owner
`INSERT`/`UPDATE`, the player can make that write directly — bypassing all the
server logic in the routes. The routes *compute* correct values; RLS currently
lets the client *ignore the routes and write whatever it wants*.

A service-role client already exists: `lib/supabase/admin.ts → createAdminClient()`
(uses `SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS). The pass routes sensitive
writes through it and removes the owner write policies.

## Audit — confirmed attack surface

| Table | Current policy | Exploit from devtools | Impact |
|---|---|---|---|
| `users` (UPDATE own) | `add_auth_trigger.sql:52` | `update({points: 999999})` | forge currency → free gacha |
| `user_items` (INSERT own) | `add_old_god_prayer.sql:25` | `insert({item_id:"old_god_seal"})` | mint any relic incl. Legendary |
| `card_missions` (INSERT/UPDATE own) | `add_interlude_missions.sql:50-52` | insert a completed row w/ huge `points_on_success`+`outcome`, or update `success_rate:100`/`claimed_at` | **bypass the entire dispatch snapshot** → forge rewards/growth |
| `card_growth` (INSERT own) | `add_character_growth.sql:36` | insert fake growth rows | forge growth ledger / dodge once-per-scenario limit |
| **`characters` (UPDATE own, NO `WITH CHECK`)** | `add_dice_resolution.sql:12` | `update({hp:999, san:999, skills:{…}})` while room in_progress | **MAIN-GAME integrity** — set own HP/SAN/skills mid-scenario. USING gates *which* row; without WITH CHECK it does NOT constrain the *new values*. |
| `character_cards` | base schema (NOT in incremental migrations — **verify in Supabase dashboard**) | if owner UPDATE exists: rewrite own card skills/stats/`equipped_item` directly | forge card power / equip without owning |

The `characters` no-WITH-CHECK hole is arguably the most serious — it breaks
"server decides" for the actual TRPG, not just the meta layer.

## Remediation plan (one pass)

**Principle after this pass: the client may READ its own rows and INSERT only
the two legitimately-client-created rows (its profile on signup, its in-room
character snapshot on card-select, both already trigger/route guarded). Every
other mutation to state/economy tables goes through an API route using the
service-role client, and RLS DENIES direct client writes.**

### Step 1 — sensitive writes → service-role in the routes
Switch these route writes from the session client to `createAdminClient()`:
- `app/api/pray/route.ts` — `user_items` insert (keep `adjust_points`; it's already SECURITY DEFINER).
- `app/api/items/equip/route.ts` — `character_cards.equipped_item` updates.
- `app/api/interlude/dispatch/route.ts` — `card_missions` insert.
- `app/api/interlude/claim/route.ts` — `card_missions` update, `character_cards.skills` update (points already atomic via `adjust_points`).
- `app/api/interlude/cancel/route.ts` — `card_missions` update.
- `app/api/rooms/[id]/growth/route.ts` — `card_growth` insert + `character_cards.skills` update.
- `app/api/gm/respond/route.ts` — all `characters` HP/SAN/state updates (verify every write there uses admin, since these are the authoritative dice results).
Each route still does auth (`getUser()`) + ownership checks itself; the admin
client is used ONLY for the mutation after those checks pass.

### Step 2 — tighten policies (new migration `harden_rls.sql`)
```sql
-- Currency / items / missions / growth: server-only writes.
DROP POLICY IF EXISTS "users_update_own"        ON public.users;          -- points via adjust_points/admin only
DROP POLICY IF EXISTS "user_items_insert_own"   ON public.user_items;     -- mint via pray route only
DROP POLICY IF EXISTS "card_missions_insert_own" ON public.card_missions; -- dispatch route only
DROP POLICY IF EXISTS "card_missions_update_own" ON public.card_missions; -- claim/cancel route only
DROP POLICY IF EXISTS "card_growth_insert_own"  ON public.card_growth;    -- growth route only
-- SELECT-own policies stay. Admin/service-role bypasses RLS, so routes keep working.

-- characters: remove the unconstrained client UPDATE (server owns in-room state).
DROP POLICY IF EXISTS "Players can update own character during play" ON public.characters;
-- If any legitimate client-side character UPDATE remains, re-add with a strict
-- WITH CHECK that pins hp/san/skills to their old values (or move it to a route).

-- character_cards: audit in dashboard; if an owner UPDATE policy exists, drop it
-- and route rename/skill-alloc/equip through the server (rename route already exists).
```

### Step 3 — verify nothing legitimately needs the dropped policies
Client-side writes found today (audit again at execution time):
- `app/login/page.tsx:48` — `users` INSERT (profile bootstrap). The auth trigger
  already creates the row; this insert is a fallback → make it upsert-safe or
  drop it (the `users_insert_own` policy can stay; it's INSERT of own id only,
  low risk, but review).
- `app/rooms/[id]/character/page.tsx:54` & select-card — `characters` INSERT
  (guarded by the `reject_busy_card` trigger). INSERT policy stays; only UPDATE
  is removed.
Grep before executing: `\.from("…")\.(update|insert|delete)` in `app/**/*.tsx`
for any client path that breaks once a policy is dropped.

### Step 4 — env + config
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel (server-only, NOT
  `NEXT_PUBLIC_`). `createAdminClient()` throws loudly if missing.
- Never import `createAdminClient` into a client component (it would leak the
  key). It's server-route only.

## Test plan (run each as the exploit, expect denial)
1. Browser console (logged in): `supabase.from("users").update({points:99999}).eq("id", MY_ID)` → **rejected** (no policy). Then earn points via a real claim → still works (admin path).
2. `supabase.from("user_items").insert({user_id:MY_ID,item_id:"old_god_seal"})` → **rejected**. Pray route still grants → works.
3. `supabase.from("card_missions").insert({…huge points…})` → **rejected**. Dispatch/claim via routes → works.
4. `supabase.from("characters").update({hp:999}).eq(...)` mid-room → **rejected**. GM turn still updates HP → works.
5. `supabase.from("card_growth").insert({…})` → **rejected**. Real post-win growth → works.
6. Regression: full play loop (join room → turn → interlude dispatch → claim → pray → equip → mission with item) all succeed via routes.
7. Confirm `SELECT` still works everywhere the UI reads (no over-drop of SELECT policies).

## Rollback
Each dropped policy is a one-line `CREATE POLICY` to restore. Keep the original
policy SQL in the migration's comments so rollback is copy-paste.

## Out of scope for this pass (note, don't do here)
- Rate-limiting the pray/claim endpoints (abuse throttling) — separate.
- Scenario-graph client leak (#7) — accepted separately.
- Signed/'' anti-tamper on client state — RLS denial is the correct fix, not obfuscation.
