import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { sendGmailDraft, refreshGoogleToken } from "@/lib/gmail";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data: msg, error } = await supabaseAdmin
    .from("wren_messages")
    .select("*, account:wren_inbox_accounts(*)")
    .eq("id", id)
    .single();
  if (error || !msg) return NextResponse.json({ error: error?.message ?? "not found" }, { status: 404 });
  if (!msg.gmail_draft_id) return NextResponse.json({ error: "no draft to send" }, { status: 400 });

  // Refresh token if needed.
  const acct = msg.account;
  let accessToken: string = acct.access_token;
  const expiresAt = new Date(acct.token_expires_at).getTime();
  if (Date.now() >= expiresAt - 60_000) {
    try {
      const r = await refreshGoogleToken(acct.refresh_token);
      accessToken = r.access_token;
      await supabaseAdmin
        .from("wren_inbox_accounts")
        .update({
          access_token: r.access_token,
          token_expires_at: new Date(Date.now() + r.expires_in * 1000).toISOString(),
          ...(r.refresh_token ? { refresh_token: r.refresh_token } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", acct.id);
    } catch (err) {
      return NextResponse.json({ error: `token refresh failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }
  }

  try {
    const sent = await sendGmailDraft(accessToken, msg.gmail_draft_id);
    await supabaseAdmin
      .from("wren_messages")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return NextResponse.json({ ok: true, messageId: sent.messageId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
