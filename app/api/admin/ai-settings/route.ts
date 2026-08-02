import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  coerceThinkingConfig,
  invalidateThinkingCache,
  DEFAULT_THINKING,
} from "@/lib/ai/settings";

export const runtime = "nodejs";

async function requireAdmin() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden — admin only." }, { status: 403 }) };
  }
  return { supabase };
}

// Read the current per-call-site thinking config.
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  // Service-role: ai_settings has no client policies (server-only table).
  try {
    const { data, error: readErr } = await createAdminClient()
      .from("ai_settings").select("thinking").eq("id", 1).maybeSingle();
    if (readErr) {
      // Table not created yet — report defaults plus the reason, so the admin
      // UI can say "run the migration" instead of silently showing all-off.
      return NextResponse.json({ thinking: DEFAULT_THINKING, missing: true, reason: readErr.message });
    }
    return NextResponse.json({ thinking: coerceThinkingConfig(data?.thinking) });
  } catch (e: any) {
    return NextResponse.json({ thinking: DEFAULT_THINKING, missing: true, reason: e?.message ?? "unavailable" });
  }
}

// Save the config (full replace, coerced server-side).
export async function PATCH(request: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const thinking = coerceThinkingConfig(body?.thinking ?? body);
  const { error: upErr } = await createAdminClient()
    .from("ai_settings")
    .upsert({ id: 1, thinking, updated_at: new Date().toISOString() });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Clears THIS instance's cache only — other warm serverless instances keep
  // their copy until the TTL lapses, which is why the UI advertises a delay.
  invalidateThinkingCache();
  return NextResponse.json({ thinking });
}
