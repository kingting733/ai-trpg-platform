# Mythos Skills v1 — 克蘇魯神話法術（禁咒）

Status: SPEC LOCKED with the author. CoC Mythos-Magic-flavored spells that cost
SAN + MP per cast, succeed on 30% + 克蘇魯知識, never grow, and are near-
impossible to obtain. "Server decides; GM narrates" fully preserved.

## Locked decisions

| Question | Decision |
|---|---|
| Cost per cast | **1d4 SAN + 3 MP — paid even on failure** (deducted before the roll). No MP → cast is blocked entirely; low SAN → allowed (SAN is the price, MP is the fuel). |
| Success rate | **30 + 克蘇魯知識** (knowledge clamped 0–40 ⇒ ceiling 70%). d100 ≤ rate = success; ≤5 = critical success. |
| Fumble | **roll 96–100** → extreme backlash: extra **1d6 SAN** on top of the cast cost + GM directive to narrate a dire manifestation. |
| 克蘇魯知識 | **New single card stat** (`character_cards.cthulhu_knowledge`). Fixed **0 at creation, not point-buyable, not editable**. Grows ONLY from official-story ending rewards (`scenarios.mythos_reward`), granted once per card per scenario via the existing `cleared_scenarios` first-clear check in the growth route. PERMANENT on the card (cards persist across rooms and survive in-story death — only the in-room `characters` instance dies). |
| Growth | **Never.** Mythos spells live in `character_cards.mythos_skills` (text[]), a namespace SEPARATE from `skills` — the ending-growth route, interlude missions, and any future growth system that reads `skills`/`SKILL_CATALOGUE` are structurally blind to them. |
| Acquisition | (1) **Gacha, super hard**: three epic (禁物, 8% tier — the tomes are now the WHOLE epic tier since the 3 dormant 禁物 were removed ⇒ ~2.7%/pull per tome) tome items; owning a tome lets the player **bind (銘刻)** its spell to ONE card — irreversible, one tome = one spell = at most one card per account. (2) **Official stories**: scenario-granted (author-only) via ending rewards (knowledge in v1; spell grants can join `mythos_reward` later). |
| Visibility | Bound spells appear on the CARD SELECT screen (so the choice can be made on them), in the in-game 屬性面板 (with cast success rate and 克蘇魯知識), and in the room skill picker. Cards without spells show no Mythos UI at all. |
| **Bind timing (DECIDED)** | A room **snapshots** the card at 選擇調查員 time (`/api/rooms/[id]/select-card` copies stats, `cthulhu_knowledge` and `mythos_skills` into the `characters` row). `/api/mythos/bind` writes ONLY to `character_cards`, so **a spell bound during a game does not apply to that game** — it takes effect from the next adventure. This is deliberate: it matches 「選定後屬性將永久鎖定」 and keeps a running adventure from gaining power mid-flight. Because the bind is irreversible, the rule is stated at the point of no return (the 銘刻 confirm dialog) and on the tome's own card. Do NOT "fix" this by syncing bind → characters without changing the decision here first. |

## The three spells (CoC canon names)

| key | zh | tome (epic gacha item) | effect on success |
|---|---|---|---|
| `shrivelling` | 萎縮術 | 《死靈之書》斷章 | Damage: 2d6 (crit 2d6+6) to a hostile/named NPC at the actor's scene — same NPC-hp authority path as attacks; no dodge (magic). |
| `elder_sign` | 遠古印記 | 《蠕蟲之秘》抄頁 | Calm/repel: target NPC stance → neutral. **Ignores `social_immune`** — the Elder Sign works precisely on things persuasion cannot touch. |
| `contact_dead` | 死者絮語 | 《無名祭祀書》殘卷 | Reveal: server directive orders the GM to reveal ONE true piece of GM-internal knowledge relevant to the current scene (server decides THAT truth is revealed; GM chooses the words). |

Failure: costs already paid, nothing happens (GM narrates the fizzle).
Fumble: + extra 1d6 SAN + `mythos_backlash` directive (GM narrates an extreme
bad thing; mechanical damage stays SAN-only in v1 so the backlash can't
insta-kill through HP).

## Targeting (damage / calm)

Same conservative chain as attacks/pacify: exact name in action text → fuzzy
(edit distance 1) → sole living (hostile for 遠古印記) NPC at the actor's scene.
No target resolvable → the cast is refused BEFORE any cost is paid (the spell
needs a subject; never waste the player's SAN on a targetless cast).
死者絮語 needs no target.

## Data model

- `character_cards.cthulhu_knowledge int NOT NULL DEFAULT 0` (app-level cap 40)
- `character_cards.mythos_skills text[] NOT NULL DEFAULT '{}'`
- `characters` mirrors both (copied at select-card, like hp/mp/skills)
- `scenarios.mythos_reward jsonb NULL` — `{ "knowledge": N }`; granted in
  `app/api/rooms/[id]/growth/route.ts` inside the existing first-clear branch
  (win + `endingAllowsGrowth` + scenario not in `cleared_scenarios`), capped.
- Tome→spell binding recorded ONLY on the card (`mythos_skills`); the
  `user_items` row is untouched (the tome stays in the collection, its
  effectText shows where it is inscribed).

## Route flow (app/api/gm/respond)

`forcedSkill` = a mythos key (client picker) →
1. Verify the acting character owns the spell (else refuse politely).
2. 萎縮術/遠古印記: resolve target; none → refuse (no cost).
3. MP < 3 → refuse (no cost). All refusals return a SYSTEM log line +
   no GM call (the turn is NOT consumed — client shows the reason).
4. Deduct 3 MP + 1d4 SAN (admin client; SAN via the roll's san_change so the
   existing apply/ledger/dice-box machinery renders it).
5. Roll d100 vs 30+知識 → success / failure / fumble (96–100, +1d6 SAN).
6. Apply effect server-side (NPC hp / stance / reveal directive), log system
   lines, hand the GM narration directives only.

## Non-negotiable exclusions

- Interlude dispatch reads `card.skills` — mythos keys never appear there.
- Ending growth maps `roll.stat_used` (zh) through `SKILL_KEY_BY_ZH` — spell
  zh names are absent, so casts never mark growth eligibility.
- `skills` record must NEVER gain a mythos key; the two namespaces stay
  disjoint by construction.

## Out of scope (v1)

MP regen · spell learning inside a story session · spell trading · unbind ·
backlash HP damage · per-spell costs.

## TDD (repo P3 — scratchpad node suites, RED first)

- M1 `mythosSpellByKey` / `MYTHOS_SPELLS`: 3 spells, keys/zh stable, not in
  SKILL_CATALOGUE (namespace disjointness test).
- M2 `mythosSuccessRate`: 0→30, 25→55, 40→70, 55→70 (cap), −5→30 (floor).
- M3 `resolveMythosCast`: no-MP refusal (no cost); cost always 3 MP + 1d4 SAN
  (rng-injected); success/failure/fumble bands incl. crit ≤5; fumble adds 1d6
  SAN; SAN can go to 0 (clamped at −san like other rolls).
- M4 items: 3 tomes epic rarity; `computeMissionModifiers` neutral for tomes;
  `pickPrayReward` can grant them; effectText renders bind hint.
- M5 regression: existing items/skills suites still green.
