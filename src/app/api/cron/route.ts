import { NextResponse } from "next/server";
import { runDaily } from "@/lib/run-daily";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // requires Vercel Pro; see README for the universe-size trade-off

/**
 * Hit twice daily by Vercel Cron (12:30 and 13:30 UTC, weekdays). runDaily() decides whether the current
 * New York time is 08:30 ± 5 min, so exactly one of the two invocations does work in both EDT and EST.
 * Manual run: GET /api/cron?force=1 with the same bearer token.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const force = new URL(req.url).searchParams.get("force") === "1";
  const outcome = await runDaily({ force });
  return NextResponse.json(outcome, { status: outcome.status === "failed" ? 500 : 200 });
}
