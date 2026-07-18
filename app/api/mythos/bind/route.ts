import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { itemById } from "@/lib/game/items";
import { mythosSpellByKey } from "@/lib/game/mythos";

/**
 * 銘刻 — bind an owned Mythos tome's spell to ONE of the player's cards.
 * IRREVERSIBLE by design (docs/design/mythos-skills-v1.md): there is no
 * unbind route, and since the gacha never duplicates, one tome = one spell =
 * at most one card per account. The spell dies with the card.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { itemId, cardId } = (await req.json()) as { itemId?: string; cardId?: string };
  const item = itemId ? itemById(itemId) : null;
  const spell = item?.effect.type === "mythos_spell" ? mythosSpellByKey(item.effect.spell) : null;
  if (!item || !spell) return NextResponse.json({ error: "此物並非可銘刻的禁咒書頁。" }, { status: 400 });
  if (!cardId) return NextResponse.json({ error: "缺少調查員。" }, { status: 400 });

  const { data: ownedRow } = await supabase
    .from("user_items").select("id").eq("user_id", user.id).eq("item_id", item.id).maybeSingle();
  if (!ownedRow) return NextResponse.json({ error: "你未擁有此書頁。" }, { status: 403 });

  // One tome teaches once: no card of this user may already carry the spell.
  const { data: myCards } = await supabase
    .from("character_cards").select("id, user_id, name, mythos_skills").eq("user_id", user.id);
  const already = (myCards ?? []).find(
    (c: any) => Array.isArray(c.mythos_skills) && c.mythos_skills.includes(spell.key)
  );
  if (already) {
    return NextResponse.json(
      { error: `「${spell.zh}」已銘刻於 ${already.name}，禁咒無法轉移。` },
      { status: 409 }
    );
  }
  const card: any = (myCards ?? []).find((c: any) => c.id === cardId);
  if (!card) return NextResponse.json({ error: "找不到你的調查員。" }, { status: 404 });

  // Service-role write (character_cards has no client UPDATE policy after
  // hardening); ownership established above. The user_id guard makes the
  // append race-safe enough — worst case a double-submit appends twice, so
  // dedup on write.
  const next = Array.from(new Set([...(card.mythos_skills ?? []), spell.key]));
  const { error } = await createAdminClient()
    .from("character_cards")
    .update({ mythos_skills: next })
    .eq("id", card.id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, spell: { key: spell.key, zh: spell.zh }, cardName: card.name });
}
