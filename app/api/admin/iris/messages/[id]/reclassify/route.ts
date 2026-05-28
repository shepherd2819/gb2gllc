import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { classifyAndDraft, MODEL_NAME } from "@/lib/iris/classify";
import { refreshGoogleToken, getOrCreateLabel, addLabelToMessage, createGmailDraft, updateGmailDraft } from "@/lib/gmail";

export const maxDuration = 60;

// POST /api/admin/iris/messages/[id]/reclassify
// Re-run the Haiku classifier on this message (e.g. after the admin updated
// voice notes) and re-sync labels + draft.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  const { data: msg, error: mErr } = await supabaseAdmin
    .from("iris_messages")
    .select("id, account_id, gmail_message_id, gmail_thread_id, gmail_draft_id, from_email, from_name, delivered_to, subject, body_text")
    .eq("id", id)
    .single();
  if (mErr || !msg) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!msg.body_text) return NextResponse.json({ error: "body purged or missing — cannot reclassify" }, { status: 400 });

  const { data: settings } = await supabaseAdmin
    .from("iris_settings")
    .select("draft_categories, voice_notes, signature")
    .eq("account_id", msg.account_id)
    .maybeSingle();

  const classification = await classifyAndDraft({
    from_email: msg.from_email ?? "(unknown)",
    from_name: msg.from_name ?? null,
    delivered_to: msg.delivered_to ?? null,
    subject: msg.subject ?? "",
    body_text: msg.body_text ?? "",
    voice_notes: settings?.voice_notes ?? undefined,
    signature: settings?.signature ?? undefined,
    draft_categories: settings?.draft_categories ?? ["lead", "support", "internal"],
  });

  // Sync label + draft over to Gmail
  const { data: acct } = await supabaseAdmin
    .from("iris_inbox_accounts")
    .select("access_token, refresh_token, token_expires_at, email_address")
    .eq("id", msg.account_id)
    .single();

  let labelId: string | null = null;
  let draftId: string | null = msg.gmail_draft_id as string | null;

  if (acct) {
    let accessToken = acct.access_token;
    if (new Date(acct.token_expires_at).getTime() < Date.now() + 60_000) {
      try {
        const r = await refreshGoogleToken(acct.refresh_token);
        accessToken = r.access_token;
        await supabaseAdmin
          .from("iris_inbox_accounts")
          .update({
            access_token: r.access_token,
            token_expires_at: new Date(Date.now() + r.expires_in * 1000).toISOString(),
          })
          .eq("id", msg.account_id);
      } catch { /* fall through; label/draft sync best-effort */ }
    }

    try {
      labelId = await getOrCreateLabel(accessToken, `Iris/${classification.category}`);
      await addLabelToMessage(accessToken, msg.gmail_message_id, labelId);
    } catch { /* best-effort */ }

    if (classification.draft_reply && msg.from_email) {
      const draftArgs = {
        threadId: msg.gmail_thread_id,
        to: msg.from_email,
        from: msg.delivered_to || acct.email_address,
        subject: msg.subject || "(no subject)",
        body: classification.draft_reply,
      };
      try {
        if (draftId) await updateGmailDraft(accessToken, draftId, draftArgs);
        else { const d = await createGmailDraft(accessToken, draftArgs); draftId = d.id; }
      } catch { /* best-effort */ }
    }
  }

  const { error } = await supabaseAdmin
    .from("iris_messages")
    .update({
      category: classification.category,
      priority: classification.priority,
      reasoning: classification.reasoning,
      suggested_action: classification.suggested_action,
      draft_reply: classification.draft_reply || null,
      classified_at: new Date().toISOString(),
      classify_model: MODEL_NAME,
      classify_error: null,
      gmail_label_id: labelId,
      gmail_draft_id: draftId,
      status: "classified",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, classification });
}
