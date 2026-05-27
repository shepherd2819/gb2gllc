import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { enrichLead } from "@/lib/avery/scrape-lead";
import { draftOutreachEmail } from "@/lib/avery/draft";
import { sendOutreachEmail } from "@/lib/avery/send";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

// PATCH /api/admin/avery/leads/[id]
//   body:
//     { action: 'research' }                   → scrape website, store enrichment
//     { action: 'draft' }                      → generate email via Claude
//     { action: 'approve_and_send' }           → send via Resend (subject to daily cap)
//     { action: 'reject', reason?: string }    → mark rejected
//     { edited_subject?, edited_body? }        → save edits
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json();

  const { data: lead } = await supabaseAdmin
    .from("avery_leads")
    .select("*, avery_campaigns!inner(briefing_text, briefing_pdf, sender_email, sender_name, daily_send_cap, status)")
    .eq("id", id)
    .single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaign = (lead as any).avery_campaigns;

  // Save edits
  if (typeof body.edited_subject === "string" || typeof body.edited_body === "string") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (typeof body.edited_subject === "string") patch.edited_subject = body.edited_subject;
    if (typeof body.edited_body === "string")    patch.edited_body    = body.edited_body;
    const { error } = await supabaseAdmin.from("avery_leads").update(patch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Reject
  if (body.action === "reject") {
    const { error } = await supabaseAdmin
      .from("avery_leads")
      .update({
        status: "rejected",
        rejected_reason: typeof body.reason === "string" ? body.reason : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Research — scrape the lead's website + find contact form URL
  if (body.action === "research") {
    if (!lead.website) {
      await supabaseAdmin.from("avery_leads").update({
        status: "skipped",
        rejected_reason: "no website to scrape",
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      return NextResponse.json({ error: "Lead has no website" }, { status: 400 });
    }
    const enrichment = await enrichLead(lead.website);
    const patch = enrichment
      ? { enrichment, enriched_at: new Date().toISOString(), status: "researched" as const }
      : { enrichment: { error: "scrape_failed" }, enriched_at: new Date().toISOString(), status: "researched" as const };
    const { error } = await supabaseAdmin.from("avery_leads").update({
      ...patch,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, enrichment });
  }

  // Draft — generate the personalized email via Claude
  if (body.action === "draft") {
    const draft = await draftOutreachEmail({
      lead: { name: lead.name, email: lead.email, company: lead.company, website: lead.website, notes: lead.notes },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      enrichment: (lead.enrichment as any) ?? null,
      briefing: { briefing_text: campaign.briefing_text, briefing_pdf: campaign.briefing_pdf },
      senderName: campaign.sender_name,
    });
    if (!draft.ok) return NextResponse.json({ error: draft.error }, { status: 500 });

    const { error } = await supabaseAdmin.from("avery_leads").update({
      draft_subject: draft.subject,
      draft_body: draft.body,
      draft_model: draft.model,
      draft_tokens: draft.tokens,
      drafted_at: new Date().toISOString(),
      status: "drafted",
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, subject: draft.subject, body: draft.body });
  }

  // Approve + send
  if (body.action === "approve_and_send") {
    if (!lead.email) return NextResponse.json({ error: "Lead has no email — can't send" }, { status: 400 });
    if (lead.status !== "drafted" && lead.status !== "approved") {
      return NextResponse.json({ error: `Cannot send a lead in '${lead.status}' state` }, { status: 400 });
    }
    if (campaign.status !== "active") {
      return NextResponse.json({ error: `Campaign is ${campaign.status}, can't send` }, { status: 400 });
    }

    const subject = (lead.edited_subject ?? lead.draft_subject ?? "").trim();
    const bodyText = (lead.edited_body ?? lead.draft_body ?? "").trim();
    if (!subject || !bodyText) return NextResponse.json({ error: "Missing subject or body" }, { status: 400 });

    const send = await sendOutreachEmail({
      campaignId: lead.campaign_id,
      leadId: lead.id,
      to: lead.email,
      fromEmail: campaign.sender_email,
      fromName: campaign.sender_name,
      subject,
      body: bodyText,
      dailyCap: campaign.daily_send_cap,
    });

    if (!send.ok) {
      if (send.code === "daily_cap") {
        return NextResponse.json({ error: send.error, code: send.code }, { status: 429 });
      }
      await supabaseAdmin.from("avery_leads").update({
        status: "failed",
        send_error: send.error,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      return NextResponse.json({ error: send.error }, { status: 500 });
    }

    await supabaseAdmin.from("avery_leads").update({
      status: "sent",
      sent_at: new Date().toISOString(),
      resend_id: send.resendId,
      approved_by: guard.user.email,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const { error } = await supabaseAdmin.from("avery_leads").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
