import { postSlackMessage, type SlackBlock } from "@/lib/slack";
import type { EscalationInput, EscalationType } from "./types";

const LABEL: Record<EscalationType, string> = {
  reschedule: "🔁 Reschedule request",
  new_order: "🆕 New order request",
  cancel: "❌ Cancellation request",
};

// Neutralize Slack mrkdwn injection from caller-supplied text: escape the three
// Slack mrkdwn metacharacters and collapse newlines (which could fabricate fake fields).
export function safeText(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

export function escalationText(input: EscalationInput): string {
  const ref = input.order?.trackingCode ? ` (${safeText(input.order.trackingCode)})` : "";
  return `${LABEL[input.type]}${ref} via Hollis`;
}

export function buildEscalationBlocks(input: EscalationInput): SlackBlock[] {
  const lines: string[] = [];
  if (input.callerNumber) lines.push(`*Caller:* ${safeText(input.callerNumber)}`);
  lines.push(`*Verified:* ${input.verified ? "yes" : "NO — unverified"}`);
  if (input.order) {
    lines.push(`*Order:* ${safeText(input.order.trackingCode)} — ${safeText(input.order.status)}`);
    lines.push(`*Property:* ${safeText(input.order.addressText)}`);
    if (input.order.arrivalWindowStart) lines.push(`*Current window:* ${safeText(input.order.arrivalWindowStart)}`);
    if (input.order.photographerName) lines.push(`*Photographer:* ${safeText(input.order.photographerName)}`);
  }
  for (const [k, v] of Object.entries(input.fields)) lines.push(`*${safeText(k)}:* ${safeText(v)}`);
  for (const [k, v] of Object.entries(input.staffContext ?? {})) lines.push(`_${safeText(k)}: ${safeText(v)} (staff context)_`);

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: LABEL[input.type] } as any },
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } as any },
  ];
  const ctxBits: string[] = [];
  if (input.order?.orderId) ctxBits.push(`<https://admin.spiro.media/orders/${safeText(input.order.orderId)}|Open in Spiro admin>`);
  if (input.retellCallId) ctxBits.push(`call \`${safeText(input.retellCallId)}\``);
  if (ctxBits.length) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: ctxBits.join("  ·  ") }] } as any);
  return blocks;
}

export type EscalationDeps = {
  insertRow: (row: Record<string, unknown>) => Promise<string>;
  updateRow: (id: string, patch: Record<string, unknown>) => Promise<void>;
  getSlackToken: (clientId: string) => Promise<string | null>;
  postSlack: (o: { botToken: string; channel: string; text: string; blocks: SlackBlock[] }) => Promise<{ ok: boolean; ts?: string }>;
  sendStaffEmail: (o: { to: string; subject: string; text: string }) => Promise<void>;
};

async function defaultInsertRow(row: Record<string, unknown>): Promise<string> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin.from("hollis_escalations").insert(row).select("id").single();
  return data!.id as string;
}
async function defaultUpdateRow(id: string, patch: Record<string, unknown>): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  await supabaseAdmin.from("hollis_escalations").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}
async function defaultGetSlackToken(clientId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin.from("steward_platform_tokens").select("token_data").eq("client_id", clientId).eq("platform", "slack").maybeSingle();
  return (data?.token_data as any)?.access_token ?? null;
}
async function defaultPostSlack(o: { botToken: string; channel: string; text: string; blocks: SlackBlock[] }) {
  const res = await postSlackMessage(o);
  return { ok: !!(res as any)?.ok, ts: (res as any)?.ts as string | undefined };
}
async function defaultSendStaffEmail(o: { to: string; subject: string; text: string }): Promise<void> {
  const { resend, DEFAULT_FROM } = await import("@/lib/resend");
  await resend().emails.send({ from: DEFAULT_FROM, to: o.to, subject: o.subject, text: o.text });
}

export async function postEscalation(
  input: EscalationInput,
  overrides: Partial<EscalationDeps> = {},
): Promise<{ ok: boolean; slackTs?: string; fallback?: "email" }> {
  const d: EscalationDeps = {
    insertRow: defaultInsertRow, updateRow: defaultUpdateRow, getSlackToken: defaultGetSlackToken,
    postSlack: defaultPostSlack, sendStaffEmail: defaultSendStaffEmail, ...overrides,
  };

  const escId = await d.insertRow({
    client_id: input.clientId, line_id: input.lineId, call_id: input.callId ?? null, retell_call_id: input.retellCallId ?? null,
    type: input.type, spiro_order_id: input.order?.orderId ?? null, tracking_code: input.order?.trackingCode ?? null,
    verified: input.verified, caller_number: input.callerNumber ?? null, spiro_agent_id: input.agentId ?? null,
    payload: input.fields, slack_channel: input.slackChannel, status: "open",
  });

  const token = input.slackChannel ? await d.getSlackToken(input.clientId) : null;
  if (token && input.slackChannel) {
    try {
      const res = await d.postSlack({ botToken: token, channel: input.slackChannel, text: escalationText(input), blocks: buildEscalationBlocks(input) });
      if (res.ok) { await d.updateRow(escId, { slack_ts: res.ts ?? null }); return { ok: true, slackTs: res.ts }; }
      throw new Error("slack not ok");
    } catch {
      /* fall through to email */
    }
  }

  await d.updateRow(escId, { status: "failed", delivery_fallback: "email" });
  if (input.staffEmail) {
    await d.sendStaffEmail({ to: input.staffEmail, subject: escalationText(input), text: JSON.stringify(input.fields, null, 2) });
  }
  return { ok: false, fallback: "email" };
}

export function buildSummaryText(summary: { caller?: string; outcome: string; asks: string[] }): string {
  const who = summary.caller ? `📞 ${safeText(summary.caller)}` : "📞 caller";
  const asks = summary.asks.length ? summary.asks.join("; ") : "no action";
  return `${who} — ${summary.outcome} — ${asks}`;
}

export async function postCallSummary(
  args: { clientId: string; channel: string | null; summary: { caller?: string; outcome: string; asks: string[] } },
  overrides: Partial<Pick<EscalationDeps, "getSlackToken" | "postSlack">> = {},
): Promise<void> {
  if (!args.channel) return;
  const getSlackToken = overrides.getSlackToken ?? defaultGetSlackToken;
  const postSlack = overrides.postSlack ?? defaultPostSlack;
  const token = await getSlackToken(args.clientId);
  if (!token) return;
  const text = buildSummaryText(args.summary);
  await postSlack({ botToken: token, channel: args.channel, text, blocks: [{ type: "section", text: { type: "mrkdwn", text } as any }] });
}
