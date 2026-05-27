import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { refreshGoogleToken, updateGmailDraft, createGmailDraft } from "@/lib/iris/google";

// PATCH /api/admin/iris/messages/[id]
// Update the draft body / subject. If a Gmail draft already exists, sync it
// over there too so the user sees the same text in Gmail. If no draft exists
// yet (was a "no draft warranted" category) and the admin writes one, create
// one in Gmail.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const draft_reply: string | undefined = typeof body.draft_reply === "string" ? body.draft_reply : undefined;
  const subject:     string | undefined = typeof body.subject     === "string" ? body.subject     : undefined;
  const status:      string | undefined = typeof body.status      === "string" ? body.status      : undefined;

  const { data: msg, error: mErr } = await supabaseAdmin
    .from("iris_messages")
    .select("id, account_id, gmail_thread_id, gmail_draft_id, from_email, delivered_to, subject")
    .eq("id", id)
    .single();
  if (mErr || !msg) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Optionally sync the draft over to Gmail.
  if (draft_reply !== undefined) {
    const { data: acct } = await supabaseAdmin
      .from("iris_inbox_accounts")
      .select("access_token, refresh_token, token_expires_at, email_address")
      .eq("id", msg.account_id)
      .single();
    if (acct && msg.from_email) {
      let accessToken = acct.access_token;
      if (new Date(acct.token_expires_at).getTime() < Date.now() + 60_000) {
        try {
          const refreshed = await refreshGoogleToken(acct.refresh_token);
          accessToken = refreshed.access_token;
          await supabaseAdmin
            .from("iris_inbox_accounts")
            .update({
              access_token: refreshed.access_token,
              token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
            })
            .eq("id", msg.account_id);
        } catch (err) {
          return NextResponse.json({ error: `token refresh: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
        }
      }

      const draftArgs = {
        threadId: msg.gmail_thread_id,
        to: msg.from_email,
        from: msg.delivered_to || acct.email_address,
        subject: subject || msg.subject || "(no subject)",
        body: draft_reply,
      };

      try {
        if (msg.gmail_draft_id && draft_reply.trim()) {
          await updateGmailDraft(accessToken, msg.gmail_draft_id, draftArgs);
        } else if (draft_reply.trim()) {
          const d = await createGmailDraft(accessToken, draftArgs);
          await supabaseAdmin.from("iris_messages").update({ gmail_draft_id: d.id }).eq("id", id);
        }
      } catch (err) {
        return NextResponse.json({ error: `gmail draft: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
      }
    }
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (draft_reply !== undefined) update.draft_reply = draft_reply || null;
  if (status === "archived") { update.status = "archived"; update.archived_at = new Date().toISOString(); }
  if (status === "flagged")  update.status = "flagged";
  if (status === "classified") update.status = "classified";

  const { error } = await supabaseAdmin.from("iris_messages").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
