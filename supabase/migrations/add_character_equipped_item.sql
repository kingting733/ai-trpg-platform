-- === 禁物 main-game effects: carry the equipped item into the room ===
--
-- The three 禁物 (血痕解讀 / 門縫窺視 / 聞兆) used to be dormant placeholders with
-- no effect anywhere. They now grant a +10 bonus to one main-game skill check
-- (偵查 / 潛行 / 閃避), which the dice engine reads off the ACTING CHARACTER.
--
-- character_cards.equipped_item already exists, but the in-room `characters`
-- row is a SNAPSHOT of the card (stats, skills, mythos_skills are all copied at
-- select-card). The equipped item has to be snapshotted the same way, for the
-- same reason: a player must not be able to change a run in progress by
-- re-equipping the item on the card from another tab.
--
-- Safe to re-run. Existing in-progress rooms get NULL = no item = current
-- behaviour, so nothing already running changes.

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS equipped_item TEXT;

COMMENT ON COLUMN public.characters.equipped_item IS
  'items.ts item id snapshotted from character_cards.equipped_item at select-card. Read by lib/game/resolution.ts for skill_check_bonus items.';
