import { NextRequest, NextResponse } from "next/server";
import { runHoltForAllActive } from "@/lib/holt/orchestrate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await runHoltForAllActive();
  const summary = results.reduce(
    (acc, r) => ({
      accounts: acc.accounts + 1,
      events: acc.events + r.events_scanned,
      briefable_new: acc.briefable_new + r.briefable_new,
      prebriefs: acc.prebriefs + r.prebriefs_sent,
      digests: acc.digests + r.evening_digests_sent,
      errors: acc.errors + r.errors.length,
    }),
    { accounts: 0, events: 0, briefable_new: 0, prebriefs: 0, digests: 0, errors: 0 }
  );

  return NextResponse.json({ ok: true, summary, results });
}
