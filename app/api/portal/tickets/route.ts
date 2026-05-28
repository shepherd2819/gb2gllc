import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { postSlackMessage } from "@/lib/slack";
import { portalTicketNotificationBlocks } from "@/lib/slack-builders";
import { logEvent } from "@/lib/logger";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";
const SUPPORT_SLACK_CHANNEL = process.env.SUPPORT_SLACK_CHANNEL ?? "";
const SLACK_ADMIN_BOT_TOKEN = process.env.SLACK_ADMIN_BOT_TOKEN ?? "";

export async function POST(req: NextRequest) {
  const { clientId, subject, body } = await req.json();

  if (!clientId || !subject || !body) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const safeSubject = String(subject).slice(0, 200);
  const safeBody = String(body).slice(0, 5000);

  const { data: ticket, error } = await supabaseAdmin
    .from("tickets")
    .insert({ client_id: clientId, subject: safeSubject, body: safeBody })
    .select("id")
    .single<{ id: string }>();

  if (error || !ticket) return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });

  // Fire-and-forget Slack notification after the response.
  after(async () => {
    try {
      if (!SUPPORT_SLACK_CHANNEL || !SLACK_ADMIN_BOT_TOKEN) {
        await logEvent({
          category: "system",
          level: "warn",
          message: "Portal ticket created but Slack notification skipped (env unset)",
          clientId,
          metadata: { ticketId: ticket.id },
        });
        return;
      }
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("name, company")
        .eq("id", clientId)
        .single<{ name: string | null; company: string | null }>();

      const blocks = portalTicketNotificationBlocks({
        client: client ?? { name: null, company: null },
        subject: safeSubject,
        body: safeBody,
        ticketId: ticket.id,
        adminUrl: ADMIN_URL,
      });

      const slackRes = await postSlackMessage({
        botToken: SLACK_ADMIN_BOT_TOKEN,
        channel: SUPPORT_SLACK_CHANNEL,
        text: `New support ticket: ${safeSubject}`,
        blocks,
      });

      if (!slackRes.ok) {
        await logEvent({
          category: "system",
          level: "error",
          message: `Slack ticket notification failed: ${slackRes.error}`,
          clientId,
          metadata: { ticketId: ticket.id },
        });
      }
    } catch (err) {
      await logEvent({
        category: "system",
        level: "error",
        message: `Slack ticket notification threw: ${err instanceof Error ? err.message : String(err)}`,
        clientId,
        metadata: { ticketId: ticket.id },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
