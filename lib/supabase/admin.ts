import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the SERVICE ROLE key. This BYPASSES Row
 * Level Security, so it must never be imported into client components or any
 * code path reachable from the browser. It exists solely for trusted backend
 * jobs (e.g. the daily-scenario cron) that have no logged-in user but still
 * need to write rows owned by the system account.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (NOT prefixed with NEXT_PUBLIC_).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Service-role client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server environment."
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
