import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { coerceSeedConfig } from "@/lib/ai/daily-scenario";

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

// Read the current seed config.
export async function GET() {
  const { error, supabase } = await requireAdmin();
  if (error) return error;

  const { data } = await supabase!.from("daily_seed_config").select("config").eq("id", 1).maybeSingle();
  return NextResponse.json({ config: coerceSeedConfig(data?.config) });
}

// Save the seed config (full replace). Values are coerced/validated server-side.
export async function PATCH(request: Request) {
  const { error, supabase } = await requireAdmin();
  if (error) return error;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const config = coerceSeedConfig(body?.config ?? body);
  const { error: upErr } = await supabase!
    .from("daily_seed_config")
    .update({ config, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ config });
}
