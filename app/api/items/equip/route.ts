import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { itemById } from "@/lib/game/items";

/**
 * Equip an owned item to one of the player's cards (one slot per card), or
 * unequip (cardId null). An item can be worn by at most one card at a time —
 * equipping it elsewhere moves it. Mid-mission swaps can't affect an in-flight
 * mission (the dispatch snapshot has the item id already).
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { itemId, cardId } = (await req.json()) as { itemId?: string; cardId?: string | null };
  const item = itemId ? itemById(itemId) : null;
  if (!item) return NextResponse.json({ error: "未知的物品。" }, { status: 400 });

  const { data: ownedRow } = await supabase
    .from("user_items").select("id").eq("user_id", user.id).eq("item_id", item.id).maybeSingle();
  if (!ownedRow) return NextResponse.json({ error: "你未擁有此物品。" }, { status: 403 });

  // Take the item off whichever of the user's cards currently wears it.
  await supabase
    .from("character_cards")
    .update({ equipped_item: null })
    .eq("user_id", user.id)
    .eq("equipped_item", item.id);

  if (cardId) {
    const { data: card } = await supabase
      .from("character_cards").select("id, user_id").eq("id", cardId).single();
    if (!card || card.user_id !== user.id) {
      return NextResponse.json({ error: "找不到你的調查員。" }, { status: 404 });
    }
    const { error } = await supabase
      .from("character_cards")
      .update({ equipped_item: item.id })
      .eq("id", card.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
