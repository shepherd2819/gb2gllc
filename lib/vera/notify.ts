import { resend, DEFAULT_FROM } from "@/lib/resend";

const FROM = process.env.VERA_RESEND_FROM ?? DEFAULT_FROM;

export type EmailDoc = { subject: string; html: string; text: string };

type CommonArgs = {
  clientName: string;
  clientCompany: string;
  productLabel: string;
  amountFormatted: string;
  cadenceLabel: string;
  signingUrl: string;
  notionUrl?: string;
  signerName?: string;
};

export function buildForSignatureEmail(a: CommonArgs): EmailDoc {
  const subject = `Your GB2GLLC ${a.productLabel} contract is ready to sign`;
  const html = `
    <p>Hi ${escapeHtml(a.clientName)},</p>
    <p>Your services agreement for <strong>${escapeHtml(a.productLabel)}</strong> at ${escapeHtml(a.amountFormatted)} ${escapeHtml(a.cadenceLabel)} is ready.</p>
    <p>Read it and sign here:</p>
    <p><a href="${a.signingUrl}">${a.signingUrl}</a></p>
    <p>This link is good for 14 days. Reply to this email with any questions.</p>
    <p>— John McCully<br/>Oberon Analytics LLC d/b/a GB2GLLC</p>`;
  const text = [
    `Hi ${a.clientName},`,
    ``,
    `Your services agreement for ${a.productLabel} at ${a.amountFormatted} ${a.cadenceLabel} is ready.`,
    ``,
    `Read it and sign here:`,
    a.signingUrl,
    ``,
    `This link is good for 14 days. Reply with any questions.`,
    ``,
    `— John McCully`,
    `Oberon Analytics LLC d/b/a GB2GLLC`,
  ].join("\n");
  return { subject, html, text };
}

export function buildReminderEmail(a: CommonArgs): EmailDoc {
  const subject = `Reminder: your GB2GLLC ${a.productLabel} contract`;
  const html = `
    <p>Hi ${escapeHtml(a.clientName)},</p>
    <p>Just a friendly nudge — your contract is still waiting for your signature.</p>
    <p><a href="${a.signingUrl}">${a.signingUrl}</a></p>
    <p>If you'd rather skip, no worries — let me know.</p>
    <p>— John</p>`;
  const text = [
    `Hi ${a.clientName},`,
    ``,
    `Just a friendly nudge — your contract is still waiting for your signature.`,
    ``,
    a.signingUrl,
    ``,
    `If you'd rather skip, no worries — let me know.`,
    ``,
    `— John`,
  ].join("\n");
  return { subject, html, text };
}

export function buildSignedClientEmail(a: CommonArgs): EmailDoc {
  const subject = `Thanks for signing — your GB2GLLC contract`;
  const html = `
    <p>Hi ${escapeHtml(a.clientName)},</p>
    <p>Your signed contract is attached for your records.</p>
    <p>We're all set to start. I'll be in touch shortly.</p>
    <p>— John McCully<br/>Oberon Analytics LLC d/b/a GB2GLLC</p>`;
  const text = [
    `Hi ${a.clientName},`,
    ``,
    `Your signed contract is attached for your records.`,
    ``,
    `We're all set to start. I'll be in touch shortly.`,
    ``,
    `— John McCully`,
    `Oberon Analytics LLC d/b/a GB2GLLC`,
  ].join("\n");
  return { subject, html, text };
}

export function buildSignedAdminEmail(a: CommonArgs): EmailDoc {
  const subject = `[Vera] ${a.clientCompany} signed the ${a.productLabel} contract`;
  const html = `
    <p><strong>${escapeHtml(a.signerName ?? "—")}</strong> signed the <strong>${escapeHtml(a.productLabel)}</strong> contract on behalf of <strong>${escapeHtml(a.clientCompany)}</strong>.</p>
    <p>Amount: ${escapeHtml(a.amountFormatted)} ${escapeHtml(a.cadenceLabel)}</p>
    ${a.notionUrl ? `<p><a href="${a.notionUrl}">Notion record</a></p>` : ""}
    <p>PDF attached.</p>`;
  const text = `${a.signerName ?? "—"} signed the ${a.productLabel} contract on behalf of ${a.clientCompany}.\nAmount: ${a.amountFormatted} ${a.cadenceLabel}.${a.notionUrl ? `\nNotion: ${a.notionUrl}` : ""}\nPDF attached.`;
  return { subject, html, text };
}

export function buildSignedSlackBlocks(a: CommonArgs) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `✅ *${a.signerName ?? "Someone"}* signed the *${a.productLabel}* contract on behalf of *${a.clientCompany}*.`,
      },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `Amount: ${a.amountFormatted} ${a.cadenceLabel}` },
      ],
    },
  ];
}

// Actual senders below — small wrappers that call build* and dispatch.

export async function sendForSignature(toEmail: string, args: CommonArgs): Promise<void> {
  const doc = buildForSignatureEmail(args);
  await resend().emails.send({ from: FROM, to: toEmail, subject: doc.subject, html: doc.html, text: doc.text });
}

export async function sendReminder(toEmail: string, args: CommonArgs): Promise<void> {
  const doc = buildReminderEmail(args);
  await resend().emails.send({ from: FROM, to: toEmail, subject: doc.subject, html: doc.html, text: doc.text });
}

export async function sendSignedToClient(toEmail: string, args: CommonArgs, pdf: Buffer): Promise<void> {
  const doc = buildSignedClientEmail(args);
  await resend().emails.send({
    from: FROM, to: toEmail, subject: doc.subject, html: doc.html, text: doc.text,
    attachments: [{ filename: "GB2GLLC-Services-Agreement.pdf", content: pdf }],
  });
}

export async function sendSignedToAdmin(args: CommonArgs, pdf: Buffer): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";
  const doc = buildSignedAdminEmail(args);
  await resend().emails.send({
    from: FROM, to: adminEmail, subject: doc.subject, html: doc.html, text: doc.text,
    attachments: [{ filename: "GB2GLLC-Services-Agreement.pdf", content: pdf }],
  });
}

export async function pingSlackOnSign(args: CommonArgs): Promise<void> {
  const token = process.env.SLACK_ADMIN_BOT_TOKEN;
  const channel = process.env.VERA_SLACK_CHANNEL ?? process.env.SUPPORT_SLACK_CHANNEL;
  if (!token || !channel) {
    console.warn("[vera/notify] SLACK_ADMIN_BOT_TOKEN or VERA_SLACK_CHANNEL not set — skipping Slack ping");
    return;
  }
  const blocks = buildSignedSlackBlocks(args);
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel, blocks, text: `${args.signerName ?? "Someone"} signed the ${args.productLabel} contract` }),
  });
  if (!res.ok) console.warn("[vera/notify] Slack postMessage failed:", await res.text());
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}
