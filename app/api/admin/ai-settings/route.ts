import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  coerceThinkingConfig,
  invalidateThinkingCache,
  isMissingTableError,
  getThinkingStatus,
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
  // getThinkingStatus() also reports whether the table exists at all, so the
  // UI can warn about a missing migration instead of silently showing all-off.
  const { config, available, reason } = await getThinkingStatus();
  return NextResponse.json({ thinking: config, missing: !available, reason });
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
  if (upErr) {
    // "Could not find the table 'public.ai_settings' in the schema cache" is
    // not an outage — it means the migration has not been run. Say that,
    // instead of leaking a raw PostgREST message the admin can't act on.
    if (isMissingTableError(upErr)) {
      return NextResponse.json(
        {
          error:
            "尚未建立 ai_settings 資料表，無法儲存。請先在 Supabase SQL Editor 執行 " +
            "supabase/migrations/add_ai_settings.sql，然後重新整理此頁。" +
            "（在此之前所有 AI 呼叫都會以「關閉推理」執行，功能不受影響。）",
          missing: true,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Clears THIS instance's cache only — other warm serverless instances keep
  // their copy until the TTL lapses, which is why the UI advertises a delay.
  invalidateThinkingCache();
  return NextResponse.json({ thinking });
}
