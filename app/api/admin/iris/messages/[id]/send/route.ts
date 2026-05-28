import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { refreshGoogleToken, sendGmailDraft, createGmailDraft, updateGmailDraft } from "@/lib/gmail";

// POST /api/admin/iris/messages/[id]/send
// Admin clicked "Send reply". Sync any pending draft edits to Gmail, then
// promote the draft to a real send via drafts.send.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  const { data: msg, error: mErr } = await supabaseAdmin
    .from("iris_messages")
    .select("id, account_id, gmail_thread_id, gmail_draft_id, draft_reply, subject, from_email, delivered_to")
    .eq("id", id)
    .single();
  if (mErr || !msg) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!msg.draft_reply?.trim()) return NextResponse.json({ error: "no draft to send" }, { status: 400 });
  if (!msg.from_email) return NextResponse.json({ error: "no recipient address" }, { status: 400 });

  const { data: acct } = await supabaseAdmin
    .from("iris_inbox_accounts")
    .select("access_token, refresh_token, token_expires_at, email_address")
    .eq("id", msg.account_id)
    .single();
  if (!acct) return NextResponse.json({ error: "account missing" }, { status: 404 });

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

  // Ensure the latest draft body is on the Gmail side before sending.
  const draftArgs = {
    threadId: msg.gmail_thread_id,
    to: msg.from_email,
    from: msg.delivered_to || acct.email_address,
    subject: msg.subject || "(no subject)",
    body: msg.draft_reply,
  };

  try {
    let draftId = msg.gmail_draft_id as string | null;
    if (draftId) {
      await updateGmailDraft(accessToken, draftId, draftArgs);
    } else {
      const d = await createGmailDraft(accessToken, draftArgs);
      draftId = d.id;
    }
    await sendGmailDraft(accessToken, draftId);
  } catch (err) {
    return NextResponse.json({ error: `send: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }

  await supabaseAdmin
    .from("iris_messages")
    .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
