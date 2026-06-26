import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createIntakePage } from "@/lib/notion";
import { resend, DEFAULT_FROM } from "@/lib/resend";

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

  // Fetch uploaded files for this session
  const { data: files } = await supabaseAdmin
    .from("intake_files")
    .select("name, size, storage_path")
    .eq("session_id", sessionId);

  // Create Notion page
  let notionPageId: string | null = null;
  let notionError: string | null = null;
  try {
    notionPageId = await createIntakePage(sessionId, state, files ?? []);
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

  // Auto-create client portal account from intake contact info
  const contact = (state as Record<string, Record<string, string>>).contact ?? {};
  if (notionPageId && contact.email) {
    await supabaseAdmin.from("clients").upsert(
      {
        intake_session_id: sessionId,
        name: contact.name || null,
        email: contact.email,
        company: contact.company || null,
      },
      { onConflict: "email", ignoreDuplicates: true }
    );
  }

  // Welcome / acknowledgement email (best-effort; previously missing).
  if (contact.email) {
    after(async () => {
      try {
        const name = contact.name || "there";
        const nameHtml = name.replace(/[&<>"']/g, (c) =>
          ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
        );
        await resend().emails.send({
          from: DEFAULT_FROM,
          to: contact.email,
          subject: "We got your intake — welcome to GB2G",
          html: `<p>Hi ${nameHtml},</p><p>Thanks for sharing your details with GB2G. We've received everything and our team is reviewing it now — we'll be in touch shortly with your next steps.</p><p>— The GB2G team</p>`,
          text: `Hi ${name},\n\nThanks for sharing your details with GB2G. We've received everything and our team is reviewing it now — we'll be in touch shortly with your next steps.\n\n— The GB2G team`,
        });
      } catch (err) {
        console.error("[intake/submit] welcome email failed:", err instanceof Error ? err.message : err);
      }
    });
  }

  return NextResponse.json({
    ok: true,
    notionPageId,
    notionError,
    submittedAt: new Date().toISOString(),
  });
}
