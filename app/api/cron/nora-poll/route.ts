import { NextRequest, NextResponse } from "next/server";
import { runNoraForAllActive } from "@/lib/nora/orchestrate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runNoraForAllActive();
  return NextResponse.json({ ok: true, ...result });
}
