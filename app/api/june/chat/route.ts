import { NextRequest, NextResponse, after } from "next/server";
import { extractIp, getOrCreateAttempt, updateAttempt, isRateLimited } from "@/lib/june/store";
import { juneTurn } from "@/lib/june/chat";
import { scrapeWebsite } from "@/lib/june/scrape";
import { generateAudit } from "@/lib/june/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_USER_MSG_LEN = 1200;
const MAX_TURNS = 30; // hard cap so a chatty user can't run up a bill

export async function POST(req: NextRequest) {
  let body: { message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const userMessage = (body.message ?? "").trim();
  if (!userMessage) return NextResponse.json({ error: "empty message" }, { status: 400 });
  if (userMessage.length > MAX_USER_MSG_LEN) {
    return NextResponse.json({ error: "message too long" }, { status: 400 });
  }

  const ip = extractIp(req);
  const ua = req.headers.get("user-agent");

  let attempt;
  try {
    attempt = await getOrCreateAttempt(ip, ua);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  if ((attempt.conversation?.length ?? 0) >= MAX_TURNS * 2) {
    return NextResponse.json({
      reply: "I've got to step away — feel free to reach out to hello@gb2gllc.com and we'll keep talking there.",
      state: "blocked",
      auditing: false,
      rate_limited: true,
    });
  }

  const history = [...(attempt.conversation ?? []), { role: "user" as const, content: userMessage }];

  const rateLimited = isRateLimited(attempt);
  const stateForJune =
    attempt.status === "audit_ready" ? "audit_done" :
    attempt.status === "auditing"    ? "auditing"   :
    attempt.status === "emailed"     ? "emailed"    :
    "open_chat";

  let turn;
  try {
    turn = await juneTurn({
      history,
      state: stateForJune,
      isRateLimited: rateLimited,
    });
  } catch (e) {
    console.error("[june chat] turn error", e);
    return NextResponse.json({ error: "I had trouble thinking for a second — try again?" }, { status: 500 });
  }

  const newHistory = [...history, { role: "assistant" as const, content: turn.reply }];
  await updateAttempt(attempt.id, { conversation: newHistory });

  // If June wants to start the audit, kick it off async — but only if we
  // haven't already audited this visitor. Guards against Claude emitting
  // <<START_AUDIT>> a second time when it's confused (e.g. mid-audit or
  // after the audit is done and the user is providing their email).
  let auditing = false;
  if (turn.action.kind === "start_audit") {
    const auditAlreadyStartedOrDone =
      attempt.status === "auditing" ||
      attempt.status === "audit_ready" ||
      attempt.status === "emailed";
    if (rateLimited || auditAlreadyStartedOrDone) {
      return NextResponse.json({
        reply: turn.reply,
        rate_limited: rateLimited,
        auditing: false,
        state: attempt.status === "audit_ready" ? "audit_done" : turn.newState,
      });
    }
    auditing = true;
    await updateAttempt(attempt.id, {
      status: "auditing",
      website_url: turn.action.website_url,
    });
    after(runAuditInBackground(attempt.id, turn.action.website_url));
  }

  // If June wants to send the email, kick it off async — but only when the
  // audit is actually ready. Guards against early or duplicate sends.
  let emailing = false;
  if (turn.action.kind === "send_email") {
    if (rateLimited || attempt.status === "emailed") {
      return NextResponse.json({
        reply: turn.reply,
        rate_limited: true,
        emailing: false,
        state: "blocked",
      });
    }
    if (attempt.status !== "audit_ready") {
      // Audit not ready yet — June can chat with the user, but don't fire the email
      return NextResponse.json({
        reply: turn.reply,
        emailing: false,
        rate_limited: false,
        state: turn.newState,
      });
    }
    emailing = true;
    await updateAttempt(attempt.id, { email: turn.action.email });
    after(sendInBackground(attempt.id, turn.action.email));
  }

  return NextResponse.json({
    reply: turn.reply,
    auditing,
    emailing,
    rate_limited: rateLimited,
    state: turn.newState,
  });
}

const AUDIT_BRIDGE = "Okay — your audit is ready. Where should I send it? Just drop your email and it's on its way.";

async function runAuditInBackground(attemptId: string, websiteUrl: string) {
  try {
    const scrape = await scrapeWebsite(websiteUrl);
    if (!scrape.ok) {
      await updateAttempt(attemptId, { status: "errored", error: scrape.reason });
      return;
    }
    await updateAttempt(attemptId, { scraped_text: scrape.text });

    // Kick off audit + logo fetch in parallel. Logo is best-effort.
    const { fetchLogoAsDataUrl } = await import("@/lib/june/scrape");
    const [audit, logoDataUrl] = await Promise.all([
      generateAudit(scrape),
      scrape.logoUrl ? fetchLogoAsDataUrl(scrape.logoUrl) : Promise.resolve(null),
    ]);

    // Append the "ready, give me your email" bridge to the conversation history
    // so the NEXT chat turn — when the user replies with an email — sees
    // June's question in context and responds with SEND_EMAIL, not confusion.
    const { supabaseAdmin } = await import("@/lib/supabase");
    const { data: row } = await supabaseAdmin
      .from("june_demo_attempts")
      .select("conversation")
      .eq("id", attemptId)
      .single();
    const conv = Array.isArray(row?.conversation) ? row.conversation : [];
    const newHistory = [...conv, { role: "assistant", content: AUDIT_BRIDGE }];

    // Stuff the logo data URL onto the audit object so the PDF renderer can use it
    const auditWithLogo = { ...audit, _logoDataUrl: logoDataUrl };

    await updateAttempt(attemptId, {
      audit_data: auditWithLogo,
      status: "audit_ready",
      pdf_generated_at: new Date().toISOString(),
      conversation: newHistory,
    });
  } catch (err) {
    console.error("[june audit] background error", err);
    await updateAttempt(attemptId, {
      status: "errored",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const EMAIL_SENT_BRIDGE = "Sent. Check your inbox in a minute. If anything in there resonates, just reply to that email — I'll see it.";

async function sendInBackground(attemptId: string, email: string) {
  try {
    // Lazy-load PDF + email modules so the chat hot path stays slim
    const [{ renderAuditPdf }, { sendAuditEmail }, { supabaseAdmin }] = await Promise.all([
      import("@/lib/june/pdf"),
      import("@/lib/june/email"),
      import("@/lib/supabase"),
    ]);
    const { data } = await supabaseAdmin
      .from("june_demo_attempts")
      .select("audit_data, website_url, conversation")
      .eq("id", attemptId)
      .single();
    if (!data?.audit_data || !data?.website_url) {
      await updateAttempt(attemptId, { status: "errored", error: "audit not ready" });
      return;
    }
    const pdf = await renderAuditPdf(data.audit_data, data.website_url);
    const result = await sendAuditEmail({
      to: email,
      audit: data.audit_data,
      websiteUrl: data.website_url,
      pdfBuffer: pdf,
    });
    if (!result.ok) {
      await updateAttempt(attemptId, { status: "errored", error: result.error ?? "send failed" });
      return;
    }
    const conv = Array.isArray(data.conversation) ? data.conversation : [];
    const newHistory = [...conv, { role: "assistant", content: EMAIL_SENT_BRIDGE }];
    await updateAttempt(attemptId, {
      status: "emailed",
      email_sent_at: new Date().toISOString(),
      resend_id: result.id ?? null,
      conversation: newHistory,
    });
  } catch (err) {
    console.error("[june send] background error", err);
    await updateAttempt(attemptId, {
      status: "errored",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
