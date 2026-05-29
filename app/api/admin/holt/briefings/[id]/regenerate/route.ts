import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { researchAttendee, getPriorThreads } from "@/lib/holt/research";
import { writeBriefing, BRIEF_MODEL_NAME } from "@/lib/holt/brief";
import { sendBriefingEmail } from "@/lib/holt/email";

export const maxDuration = 300;

// POST /api/admin/holt/briefings/[id]/regenerate
// Force-regenerate this briefing and re-send. Useful for testing or after a
// voice-notes change.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  const { data: row } = await supabaseAdmin.from("holt_briefings").select("*").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.decision !== "briefable") return NextResponse.json({ error: `decision=${row.decision}; nothing to brief` }, { status: 400 });

  const { data: acct } = await supabaseAdmin.from("holt_accounts").select("*").eq("id", row.account_id).single();
  if (!acct) return NextResponse.json({ error: "account missing" }, { status: 404 });

  const { data: settings } = await supabaseAdmin.from("holt_settings").select("*").eq("account_id", row.account_id).maybeSingle();

  const externals: { email: string; name: string | null; company: string | null }[] = Array.isArray(row.external_attendees) ? row.external_attendees : [];
  const attendeePackets = await Promise.all(externals.map(async (a) => {
    const [research, prior_threads] = await Promise.all([
      researchAttendee({ email: a.email, name: a.name, companyHint: a.company, webSearchEnabled: settings?.enable_web_research ?? true }),
      getPriorThreads(acct.workos_user_id, a.email, 5),
    ]);
    return { research, prior_threads };
  }));

  const markdown = await writeBriefing({
    event: {
      summary: row.event_summary ?? "(no title)",
      start_at: row.event_start_at,
      end_at: row.event_end_at,
      location: row.event_location,
      description: row.event_description,
      timezone: acct.timezone,
    },
    attendees: attendeePackets,
    voice_notes: settings?.voice_notes ?? null,
    user_name: null,
  });

  const sources = attendeePackets.flatMap((p) => p.research.sources).slice(0, 10);
  const to = settings?.delivery_email || acct.email_address;
  const subject = `Holt · prep for ${row.event_summary || "your meeting"} (regenerated)`;
  const send = await sendBriefingEmail({ to, subject, markdownBody: markdown, sources });

  await supabaseAdmin.from("holt_briefings").update({
    briefing_markdown: markdown,
    research_json: { attendees: attendeePackets.map((p) => ({ email: p.research.email, research: p.research, prior_count: p.prior_threads.length })) },
    generated_at: new Date().toISOString(),
    generate_model: BRIEF_MODEL_NAME,
    generate_error: send.ok ? null : send.error.slice(0, 1000),
    prebrief_sent_at: send.ok ? new Date().toISOString() : row.prebrief_sent_at,
    resend_email_id: send.ok ? send.id : row.resend_email_id,
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  if (!send.ok) return NextResponse.json({ ok: false, error: send.error }, { status: 502 });
  return NextResponse.json({ ok: true, markdown });
}
