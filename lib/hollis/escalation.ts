import type { SlackBlock } from "@/lib/slack";
import type { EscalationInput, EscalationType } from "./types";

const LABEL: Record<EscalationType, string> = {
  reschedule: "🔁 Reschedule request",
  new_order: "🆕 New order request",
  cancel: "❌ Cancellation request",
};

export function escalationText(input: EscalationInput): string {
  const ref = input.order?.trackingCode ? ` (${input.order.trackingCode})` : "";
  return `${LABEL[input.type]}${ref} via Hollis`;
}

export function buildEscalationBlocks(input: EscalationInput): SlackBlock[] {
  const lines: string[] = [];
  if (input.callerNumber) lines.push(`*Caller:* ${input.callerNumber}`);
  lines.push(`*Verified:* ${input.verified ? "yes" : "NO — unverified"}`);
  if (input.order) {
    lines.push(`*Order:* ${input.order.trackingCode} — ${input.order.status}`);
    lines.push(`*Property:* ${input.order.addressText}`);
    if (input.order.arrivalWindowStart) lines.push(`*Current window:* ${input.order.arrivalWindowStart}`);
    if (input.order.photographerName) lines.push(`*Photographer:* ${input.order.photographerName}`);
  }
  for (const [k, v] of Object.entries(input.fields)) lines.push(`*${k}:* ${String(v)}`);
  for (const [k, v] of Object.entries(input.staffContext ?? {})) lines.push(`_${k}: ${String(v)} (staff context)_`);

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: LABEL[input.type] } as any },
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } as any },
  ];
  const ctxBits: string[] = [];
  if (input.order?.orderId) ctxBits.push(`<https://admin.spiro.media/orders/${input.order.orderId}|Open in Spiro admin>`);
  if (input.retellCallId) ctxBits.push(`call \`${input.retellCallId}\``);
  if (ctxBits.length) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: ctxBits.join("  ·  ") }] } as any);
  return blocks;
}
