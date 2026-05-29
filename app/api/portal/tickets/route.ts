import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { postSlackMessage } from "@/lib/slack";
import { portalTicketNotificationBlocks } from "@/lib/slack-builders";
import { logEvent } from "@/lib/logger";
import { enqueueFromTicket } from "@/lib/devagent/platform/trigger";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";
const SUPPORT_SLACK_CHANNEL = process.env.SUPPORT_SLACK_CHANNEL ?? "";
const SLACK_ADMIN_BOT_TOKEN = process.env.SLACK_ADMIN_BOT_TOKEN ?? "";

export async function POST(req: NextRequest) {
  const { clientId, subject, body, category } = await req.json();

  if (!clientId || !subject || !body) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const safeSubject = String(subject).slice(0, 200);
  const safeBody = String(body).slice(0, 5000);
  const safeCategory = typeof category === "string" && category.length > 0
    ? String(category).slice(0, 80)
    : null;

  const { data: ticket, error } = await supabaseAdmin
    .from("tickets")
    .insert({ client_id: clientId, subject: safeSubject, body: safeBody, category: safeCategory })
    .select("id")
    .single<{ id: string }>();

  if (error || !ticket) {
    return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
  }

  // Fire-and-forget after the response: Slack notification + Ada auto-trigger.
  after(async () => {
    // 1. Slack — existing behavior unchanged.
    try {
      if (!SUPPORT_SLACK_CHANNEL || !SLACK_ADMIN_BOT_TOKEN) {
        await logEvent({
          category: "system",
          level: "warn",
          message: "Portal ticket created but Slack notification skipped (env unset)",
          clientId,
          metadata: { ticketId: ticket.id },
        });
      } else {
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

    // 2. Ada auto-trigger — best-effort.
    try {
      const triggered = await enqueueFromTicket({
        id: ticket.id,
        client_id: clientId,
        category: safeCategory,
        subject: safeSubject,
        body: safeBody,
      });
      if (triggered) {
        await logEvent({
          category: "system",
          level: "info",
          message: "Ada auto-trigger dispatched",
          clientId,
          metadata: { ticketId: ticket.id, category: safeCategory },
        });
      }
    } catch (err) {
      await logEvent({
        category: "system",
        level: "error",
        message: `Ada auto-trigger failed: ${err instanceof Error ? err.message : String(err)}`,
        clientId,
        metadata: { ticketId: ticket.id },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
