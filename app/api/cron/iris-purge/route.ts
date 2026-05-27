import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Rolling 30-day purge: null out email bodies on messages older than 30 days.
// Classification metadata + subject/snippet/from/to stays for the dashboard.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("iris_messages")
    .update({
      body_text: null,
      body_html: null,
      body_purged_at: new Date().toISOString(),
    })
    .lt("received_at", cutoff)
    .is("body_purged_at", null)
    .select("id");

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, purged: data?.length ?? 0, cutoff });
}
