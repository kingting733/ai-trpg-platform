import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildStarterCard } from "@/lib/cards/starter";

/**
 * Grant this account its one free starter investigator.
 *
 * Idempotent and race-safe: claim_starter_card() flips
 * users.starter_card_granted_at from NULL in a single atomic UPDATE and
 * returns TRUE to exactly one caller. Safe to call from anywhere, any number
 * of times — the login page, the auth callback and the roster page all do.
 *
 * Deliberately NOT gated on "does the user own zero cards?": that would hand
 * out a fresh starter every time somebody cleared their roster.
 */
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Atomic claim — only the winner proceeds to insert.
  const { data: won, error: claimErr } = await supabase.rpc("claim_starter_card", {
    p_user: user.id,
  });
  if (claimErr) {
    console.error("[starter] claim_starter_card failed:", claimErr.message);
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  if (won !== true) {
    // Already granted (or another request won the race) — not an error.
    return NextResponse.json({ granted: false });
  }

  // Service-role write: character_cards has no client INSERT policy after the
  // phase-2 RLS hardening. user_id comes from the session, never the request.
  const { data: card, error } = await createAdminClient()
    .from("character_cards")
    .insert({ user_id: user.id, ...buildStarterCard() })
    .select("*")
    .single();

  if (error || !card) {
    // Release the claim so the grant can be retried — otherwise a transient
    // failure would silently cost this account its starter card forever.
    await createAdminClient()
      .from("users")
      .update({ starter_card_granted_at: null })
      .eq("id", user.id);
    console.error("[starter] insert failed, claim released:", error?.message);
    return NextResponse.json({ error: error?.message ?? "Failed to create starter card." }, { status: 500 });
  }

  return NextResponse.json({ granted: true, card });
}
