import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * SECURITY PHASE 2: legacy custom-character creation (no card), server-side.
 * The client sends ONLY name + background; the default statline is fixed HERE
 * so a modified client can no longer submit arbitrary stats.
 */
const DEFAULT_STATS = {
  str: 50, con: 50, siz: 65, dex: 50, app: 50,
  int: 65, pow: 50, edu: 65, luck: 50,
  hp: 11,  // floor((50+65)/10)
  san: 50, // = pow
  mp: 10,  // floor(50/5)
  skills: {},
} as const;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, background } = (await req.json()) as { name?: string; background?: string };
  const charName = (name ?? "").trim().slice(0, 30);
  if (!charName) return NextResponse.json({ error: "請輸入角色名字。" }, { status: 400 });

  const { data: rp } = await supabase
    .from("room_players")
    .select("user_id, character_id")
    .eq("room_id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!rp) return NextResponse.json({ error: "你不在此房間中。" }, { status: 403 });
  if (rp.character_id) return NextResponse.json({ error: "你已建立了角色。" }, { status: 409 });

  const admin = createAdminClient();
  const { data: newChar, error: insertErr } = await admin
    .from("characters")
    .insert({
      user_id: user.id,
      room_id: params.id,
      name: charName,
      background: (background ?? "").trim().slice(0, 500) || null,
      ...DEFAULT_STATS,
    })
    .select("id")
    .single();
  if (insertErr || !newChar) {
    return NextResponse.json({ error: insertErr?.message ?? "建立角色失敗。" }, { status: 500 });
  }

  const { error: rpErr } = await admin
    .from("room_players")
    .update({ character_id: newChar.id })
    .eq("room_id", params.id)
    .eq("user_id", user.id);
  if (rpErr) return NextResponse.json({ error: rpErr.message }, { status: 500 });

  return NextResponse.json({ characterId: newChar.id });
}
