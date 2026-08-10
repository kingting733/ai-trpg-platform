import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * SECURITY PHASE 2 (docs/design/security-hardening-pass.md): character
 * creation moved server-side. The old client-side `characters` INSERT copied
 * card stats in the browser — a modified client could forge hp/skills/
 * cthulhu_knowledge/mythos_skills into a room. Here EVERY field derives from
 * the card row the server reads itself; the client only names WHICH card.
 * After the phase-2 migration drops the client INSERT policy, this route is
 * the only way into `characters`.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { cardId } = (await req.json()) as { cardId?: string };
  if (!cardId) return NextResponse.json({ error: "缺少調查員卡。" }, { status: 400 });

  // Must be a player in this room, without a character already.
  const { data: rp } = await supabase
    .from("room_players")
    .select("user_id, character_id")
    .eq("room_id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!rp) return NextResponse.json({ error: "你不在此房間中。" }, { status: 403 });
  if (rp.character_id) return NextResponse.json({ error: "你已選擇了調查員。" }, { status: 409 });

  // The card must be the user's own; every stat comes from THIS row.
  const { data: card } = await supabase
    .from("character_cards")
    .select("*")
    .eq("id", cardId)
    .eq("user_id", user.id)
    .single();
  if (!card) return NextResponse.json({ error: "找不到你的調查員卡。" }, { status: 404 });

  // A card on an active interlude mission can't enter a room. (The DB trigger
  // reject_busy_card enforces this too — this check just gives a clean error.)
  const { data: busy } = await supabase
    .from("card_missions")
    .select("id")
    .eq("card_id", card.id)
    .is("claimed_at", null)
    .maybeSingle();
  if (busy) return NextResponse.json({ error: "此調查員正在執行幕間任務，無法進入故事。" }, { status: 409 });

  const admin = createAdminClient();
  const { data: newChar, error: insertErr } = await admin
    .from("characters")
    .insert({
      user_id: user.id, room_id: params.id, source_card_id: card.id,
      name: card.name, hp: card.hp, san: card.san, mp: card.mp,
      str: card.str, con: card.con, siz: card.siz, dex: card.dex,
      app: card.app, int: card.int, pow: card.pow, edu: card.edu,
      luck: card.luck, skills: card.skills ?? {}, occupation: card.occupation ?? null,
      cthulhu_knowledge: card.cthulhu_knowledge ?? 0, mythos_skills: card.mythos_skills ?? [],
      // Snapshot like every other stat: re-equipping on the card mid-session
      // must not retroactively change a run already under way.
      equipped_item: card.equipped_item ?? null,
    })
    .select("id")
    .single();
  if (insertErr || !newChar) {
    return NextResponse.json({ error: insertErr?.message ?? "選擇調查員失敗。" }, { status: 500 });
  }

  const { error: rpErr } = await admin
    .from("room_players")
    .update({ character_id: newChar.id })
    .eq("room_id", params.id)
    .eq("user_id", user.id);
  if (rpErr) return NextResponse.json({ error: rpErr.message }, { status: 500 });

  return NextResponse.json({ characterId: newChar.id });
}
