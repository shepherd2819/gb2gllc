import { NextRequest, NextResponse } from "next/server";
import { sendDigestForAllActiveClients } from "@/lib/herald-digest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await sendDigestForAllActiveClients();
  const summary = results.reduce(
    (acc, r) => ({ ...acc, [r.status]: acc[r.status] + 1 }),
    { sent: 0, failed: 0, skipped: 0 } as Record<string, number>
  );

  return NextResponse.json({ ok: true, summary, results });
}
