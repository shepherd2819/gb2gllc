import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Nullify body_text/body_html and stamp body_purged_at for messages
// older than 30 days where body_purged_at IS NULL. Headers + classification
// stay forever so the dashboard stays searchable.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabaseAdmin
    .from("wren_messages")
    .update({
      body_text: null,
      body_html: null,
      body_purged_at: new Date().toISOString(),
    }, { count: "exact" })
    .is("body_purged_at", null)
    .lt("received_at", cutoff);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, purged: count ?? 0 });
}
