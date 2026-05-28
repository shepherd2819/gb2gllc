import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { refreshGoogleToken, updateGmailDraft, createGmailDraft } from "@/lib/gmail";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from("wren_messages")
    .select("*, matched_client:clients(id, name, company, email)")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ message: data });
}

// PATCH /api/admin/wren/messages/[id]
// Edit the draft reply (synced to Gmail draft) and/or update status
// (archived | flagged | classified). Mirrors Iris's PATCH handler.
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const draft_reply: string | undefined = typeof body.draft_reply === "string" ? body.draft_reply : undefined;
  const status: string | undefined = typeof body.status === "string" ? body.status : undefined;

  const { data: msg, error: mErr } = await supabaseAdmin
    .from("wren_messages")
    .select("id, account_id, gmail_thread_id, gmail_draft_id, from_email, delivered_to, subject")
    .eq("id", id)
    .single();
  if (mErr || !msg) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Sync the edited draft over to Gmail so the user sees the same text there.
  if (draft_reply !== undefined) {
    const { data: acct } = await supabaseAdmin
      .from("wren_inbox_accounts")
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
            .from("wren_inbox_accounts")
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
        subject: msg.subject || "(no subject)",
        body: draft_reply,
      };

      try {
        if (msg.gmail_draft_id && draft_reply.trim()) {
          await updateGmailDraft(accessToken, msg.gmail_draft_id, draftArgs);
        } else if (draft_reply.trim()) {
          const d = await createGmailDraft(accessToken, draftArgs);
          await supabaseAdmin.from("wren_messages").update({ gmail_draft_id: d.id }).eq("id", id);
        }
      } catch (err) {
        return NextResponse.json({ error: `gmail draft: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
      }
    }
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (draft_reply !== undefined) update.draft_reply = draft_reply || null;
  if (status === "archived") { update.status = "archived"; update.archived_at = new Date().toISOString(); }
  if (status === "flagged") update.status = "flagged";
  if (status === "classified") update.status = "classified";

  const { error } = await supabaseAdmin.from("wren_messages").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
