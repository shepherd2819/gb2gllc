import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { classifyAndDraft, MODEL_NAME } from "@/lib/wren/classify";
import { findClientForSender } from "@/lib/wren/anchor";

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
  if (!msg.body_text) return NextResponse.json({ error: "body purged" }, { status: 410 });

  const { data: settings } = await supabaseAdmin
    .from("wren_settings")
    .select("draft_categories, voice_notes, signature")
    .eq("account_id", msg.account_id)
    .maybeSingle();

  const matched = msg.from_email ? await findClientForSender(msg.from_email).catch(() => null) : null;

  try {
    const c = await classifyAndDraft({
      from_email: msg.from_email ?? "(unknown)",
      from_name: msg.from_name,
      delivered_to: msg.delivered_to,
      subject: msg.subject ?? "",
      body_text: msg.body_text,
      voice_notes: settings?.voice_notes ?? undefined,
      signature: settings?.signature ?? undefined,
      draft_categories: settings?.draft_categories ?? ["bug", "feature_request", "account_help", "billing_question", "general"],
      matched_client: matched,
    });
    await supabaseAdmin
      .from("wren_messages")
      .update({
        category: c.category,
        priority: c.priority,
        reasoning: c.reasoning,
        suggested_action: c.suggested_action,
        draft_reply: c.draft_reply || null,
        matched_client_id: matched?.id ?? null,
        classified_at: new Date().toISOString(),
        classify_model: MODEL_NAME,
        classify_error: null,
        status: "classified",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return NextResponse.json({ ok: true, classification: c });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from("wren_messages")
      .update({ classify_error: m.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("id", id);
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
