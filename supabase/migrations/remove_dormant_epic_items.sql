-- Remove the three dormant 禁物 placeholders (血痕解讀 / 門縫窺視 / 聞兆).
--
-- They were collectible but had no effect, and are now gone from ITEM_POOL in
-- lib/game/items.ts. Rows left behind would be orphans: itemById() returns null
-- for them, so 祭品閣 (which iterates ITEM_POOL) would not list them, an
-- equipped card would read 「裝備：未知物品」, and /api/items/equip would reject
-- the id with 「未知的物品。」 — the player could neither see nor unequip it.
--
-- Order matters: unequip first, then delete ownership.

UPDATE public.character_cards
   SET equipped_item = NULL
 WHERE equipped_item IN ('blood_reading', 'door_crack_peek', 'omen_smelling');

DELETE FROM public.user_items
 WHERE item_id IN ('blood_reading', 'door_crack_peek', 'omen_smelling');

-- NOTE: this does NOT refund the 300 調查點 spent on any prayer that produced
-- one of these. If refunds are wanted, that is a separate deliberate credit —
-- the grants are not individually recoverable from user_items once deleted, so
-- decide BEFORE running this.
