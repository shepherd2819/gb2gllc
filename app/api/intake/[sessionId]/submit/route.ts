import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createIntakePage } from "@/lib/notion";

type Params = { params: Promise<{ sessionId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { sessionId } = await params;

  const { data: session, error: sessionErr } = await supabaseAdmin
    .from("intake_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (sessionErr || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.submitted_at) {
    // Idempotent — already submitted
    return NextResponse.json({ ok: true, notionPageId: session.notion_page_id, alreadySubmitted: true });
  }

  const state = session.state as Record<string, unknown>;

  // Create Notion page
  let notionPageId: string | null = null;
  let notionError: string | null = null;
  try {
    notionPageId = await createIntakePage(sessionId, state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Notion page creation failed:", msg);
    notionError = msg;
  }

  // Mark submitted in DB
  await supabaseAdmin
    .from("intake_sessions")
    .update({
      submitted_at: new Date().toISOString(),
      notion_page_id: notionPageId,
    })
    .eq("id", sessionId);

  // TODO (P1): Send confirmation email via Resend
  // TODO (P1): Post summary to #intake Slack channel

  return NextResponse.json({
    ok: true,
    notionPageId,
    notionError,
    submittedAt: new Date().toISOString(),
  });
}
