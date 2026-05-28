import { NextRequest, NextResponse } from "next/server";
import { pollAllActiveAccounts } from "@/lib/wren/poll";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await pollAllActiveAccounts();
  const summary = results.reduce(
    (acc, r) => ({
      accounts: acc.accounts + 1,
      fetched: acc.fetched + r.fetched,
      classified: acc.classified + r.classified,
      drafted: acc.drafted + r.drafted,
      skipped: acc.skipped + r.skipped,
      errors: acc.errors + r.errors.length,
    }),
    { accounts: 0, fetched: 0, classified: 0, drafted: 0, skipped: 0, errors: 0 }
  );

  return NextResponse.json({ ok: true, summary, results });
}
