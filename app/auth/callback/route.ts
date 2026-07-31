import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = createClient();
    const { data } = await supabase.auth.exchangeCodeForSession(code);

    // Ensure public.users profile exists after email confirmation.
    // The DB trigger creates it on auth.users INSERT, but this is a
    // belt-and-suspenders fallback for any accounts that predate the trigger.
    if (data.user) {
      const { data: profile } = await supabase
        .from("users")
        .select("id")
        .eq("id", data.user.id)
        .maybeSingle();

      if (!profile) {
        const fallbackUsername =
          (data.user.user_metadata?.username as string | undefined) ??
          (data.user.email?.split("@")[0] ?? "adventurer").slice(0, 24) +
            "_" + data.user.id.slice(0, 4);
        await supabase.from("users").insert({
          id: data.user.id,
          email: data.user.email ?? "",
          username: fallbackUsername,
        });
      }

      // Grant the free starter investigator so a brand-new account never lands
      // on an empty roster. Atomic + idempotent (claim_starter_card), so the
      // duplicate calls from the login page / roster page are harmless.
      const { data: won } = await supabase.rpc("claim_starter_card", { p_user: data.user.id });
      if (won === true) {
        const { buildStarterCard } = await import("@/lib/cards/starter");
        const { createAdminClient } = await import("@/lib/supabase/admin");
        const admin = createAdminClient();
        const { error: cardErr } = await admin
          .from("character_cards")
          .insert({ user_id: data.user.id, ...buildStarterCard() });
        if (cardErr) {
          // Release the claim so it can be retried elsewhere.
          await admin.from("users").update({ starter_card_granted_at: null }).eq("id", data.user.id);
          console.error("[starter] callback grant failed, claim released:", cardErr.message);
        }
      }
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
