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

  // If June wants to start the audit, kick it off async — UI will open the SSE stream
  let auditing = false;
  if (turn.action.kind === "start_audit") {
    if (rateLimited) {
      return NextResponse.json({
        reply: turn.reply,
        rate_limited: true,
        auditing: false,
        state: "blocked",
      });
    }
    auditing = true;
    await updateAttempt(attempt.id, {
      status: "auditing",
      website_url: turn.action.website_url,
    });
    after(runAuditInBackground(attempt.id, turn.action.website_url));
  }

  // If June wants to send the email, kick it off async — UI will poll /api/june/state
  let emailing = false;
  if (turn.action.kind === "send_email") {
    if (rateLimited) {
      return NextResponse.json({
        reply: turn.reply,
        rate_limited: true,
        emailing: false,
        state: "blocked",
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

async function runAuditInBackground(attemptId: string, websiteUrl: string) {
  try {
    const scrape = await scrapeWebsite(websiteUrl);
    if (!scrape.ok) {
      await updateAttempt(attemptId, { status: "errored", error: scrape.reason });
      return;
    }
    await updateAttempt(attemptId, { scraped_text: scrape.text });
    const audit = await generateAudit(scrape);
    await updateAttempt(attemptId, {
      audit_data: audit,
      status: "audit_ready",
      pdf_generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[june audit] background error", err);
    await updateAttempt(attemptId, {
      status: "errored",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

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
      .select("audit_data, website_url")
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
    await updateAttempt(attemptId, {
      status: "emailed",
      email_sent_at: new Date().toISOString(),
      resend_id: result.id ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  } catch (err) {
    console.error("[june send] background error", err);
    await updateAttempt(attemptId, {
      status: "errored",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
