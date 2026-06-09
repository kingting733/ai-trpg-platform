import { NextResponse } from "next/server";
import { runDailyGeneration } from "@/lib/server/daily-runner";

export const runtime = "nodejs";
export const maxDuration = 120;
// Never cache — this must actually run each time the scheduler hits it.
export const dynamic = "force-dynamic";

/**
 * Daily scenario generator, invoked by Vercel Cron (see vercel.json).
 * Protected by CRON_SECRET: the scheduler must send
 *   Authorization: Bearer <CRON_SECRET>
 * Vercel Cron sends this header automatically when CRON_SECRET is set in the
 * project env. Generates ONE draft scenario per day for admin approval.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runDailyGeneration();
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[cron/daily-scenario] failed:", e?.message ?? e);
    return NextResponse.json({ status: "error", message: e?.message ?? "generation failed" }, { status: 500 });
  }
}
