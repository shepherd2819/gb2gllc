// Delivers a booking request / lead / message to the client business.
// EMAIL is the guaranteed channel (always sent); CRM is an optional outbound
// webhook (generic — works with Zapier/Make and most CRM inbound hooks). There
// is no live calendar in v1: Hollis captures and delivers; the business confirms.
//
// build* functions are pure (unit-tested). deliver* wrappers dispatch and never
// throw to the caller — a delivery failure must not break the post-call flow.

import { createHmac } from "node:crypto";
import { resend, DEFAULT_FROM } from "@/lib/resend";
import type { HollisLine } from "./types";

const FROM = process.env.HOLLIS_RESEND_FROM ?? DEFAULT_FROM;

export type DeliveryKind = "booking_request" | "qualified_lead" | "message";

export type DeliveryRecord = {
  kind: DeliveryKind;
  businessName: string;
  caller: { name?: string; phone?: string; email?: string };
  fields: Record<string, string | number | boolean | null>;
  callId: string;
  callerNumber?: string;
};

export type EmailDoc = { subject: string; html: string; text: string };

const KIND_LABEL: Record<DeliveryKind, string> = {
  booking_request: "New booking request",
  qualified_lead: "New lead",
  message: "New message",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function humanize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildDeliveryEmail(rec: DeliveryRecord): EmailDoc {
  const label = KIND_LABEL[rec.kind];
  const subject = `${label} — ${rec.businessName}`;

  const callerLines: [string, string][] = [];
  if (rec.caller.name) callerLines.push(["Name", rec.caller.name]);
  if (rec.caller.phone) callerLines.push(["Phone", rec.caller.phone]);
  if (rec.caller.email) callerLines.push(["Email", rec.caller.email]);
  if (rec.callerNumber) callerLines.push(["Calling from", rec.callerNumber]);

  const fieldRows = Object.entries(rec.fields)
    .filter(([, v]) => v !== null && v !== "")
    .map(([k, v]) => [humanize(k), String(v)] as [string, string]);

  const allRows = [...callerLines, ...fieldRows];

  const html = `
    <p>Hollis took a <strong>${escapeHtml(label.toLowerCase())}</strong> for <strong>${escapeHtml(rec.businessName)}</strong>.</p>
    <table cellpadding="6" style="border-collapse:collapse;font-size:14px">
      ${allRows.map(([k, v]) => `<tr><td style="color:#777">${escapeHtml(k)}</td><td><strong>${escapeHtml(v)}</strong></td></tr>`).join("")}
    </table>
    <p style="color:#999;font-size:12px">Call ${escapeHtml(rec.callId)} · delivered by Hollis</p>`;

  const text = [
    `${label} for ${rec.businessName}`,
    ``,
    ...allRows.map(([k, v]) => `${k}: ${v}`),
    ``,
    `Call ${rec.callId} — delivered by Hollis`,
  ].join("\n");

  return { subject, html, text };
}

export function buildCrmPayload(rec: DeliveryRecord): Record<string, string | number | boolean | null> {
  return {
    kind: rec.kind,
    call_id: rec.callId,
    caller_name: rec.caller.name ?? null,
    caller_phone: rec.caller.phone ?? null,
    caller_email: rec.caller.email ?? null,
    caller_number: rec.callerNumber ?? null,
    ...rec.fields,
  };
}

// Always email; push to CRM when configured; never throw.
export async function deliverToBusiness(
  line: Pick<HollisLine, "booking_email" | "booking_mode" | "crm_config">,
  rec: DeliveryRecord,
  fallbackEmail?: string | null,
): Promise<void> {
  const to = line.booking_email ?? fallbackEmail;
  if (to) {
    try {
      const doc = buildDeliveryEmail(rec);
      await resend().emails.send({ from: FROM, to, subject: doc.subject, html: doc.html, text: doc.text });
    } catch (err) {
      console.error("[hollis/delivery] email failed:", err instanceof Error ? err.message : err);
    }
  } else {
    console.warn("[hollis/delivery] no booking_email or fallback — skipped email", { callId: rec.callId });
  }

  if (line.booking_mode === "crm" || line.booking_mode === "both") {
    const webhookUrl = (line.crm_config as { webhook_url?: string })?.webhook_url;
    if (webhookUrl) {
      try {
        const payload = JSON.stringify(buildCrmPayload(rec));
        const secret = process.env.HOLLIS_CRM_WEBHOOK_SECRET;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (secret) headers["X-Hollis-Signature"] = createHmac("sha256", secret).update(payload).digest("hex");
        await fetch(webhookUrl, { method: "POST", headers, body: payload });
      } catch (err) {
        console.error("[hollis/delivery] CRM webhook failed:", err instanceof Error ? err.message : err);
      }
    }
  }
}
