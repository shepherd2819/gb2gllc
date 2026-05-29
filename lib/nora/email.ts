import { resend } from "@/lib/resend";

const FROM_NAME = "Nora at GB2G";
const FROM_EMAIL = process.env.NORA_FROM_EMAIL ?? "hello@gb2gllc.com";

// ─── Alert email (Nora → founder) ────────────────────────────────────────
// One per actionable event: "Payment failed: $X from customer Y. View it."
export type AlertEmailArgs = {
  to: string;
  subject: string;
  summary: string;             // one-line headline
  detail: string;              // 1-2 paragraphs
  link_label?: string;
  link_url?: string;
  severity: "critical" | "warn" | "info";
};

export async function sendAlertEmail(args: AlertEmailArgs): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const html = renderAlertHtml(args);
  try {
    const r = await resend().emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: args.to,
      subject: args.subject,
      html,
      text: `${args.summary}\n\n${args.detail}${args.link_url ? `\n\n${args.link_label ?? "Open"}: ${args.link_url}` : ""}`,
    });
    if (r.error) return { ok: false, error: r.error.message ?? JSON.stringify(r.error) };
    return { ok: true, id: r.data?.id ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Dunning email (Nora → customer, on admin click) ────────────────────
export async function sendDunningEmail(args: { to: string; subject: string; body: string; replyTo?: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const html = plainBodyToHtml(args.body);
  try {
    const r = await resend().emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: args.to,
      subject: args.subject,
      html,
      text: args.body,
      replyTo: args.replyTo ?? FROM_EMAIL,
    });
    if (r.error) return { ok: false, error: r.error.message ?? JSON.stringify(r.error) };
    return { ok: true, id: r.data?.id ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Digest email (the weekly markdown digest) ──────────────────────────
export async function sendDigestEmail(args: { to: string; subject: string; markdown: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const html = renderDigestHtml(args.markdown);
  try {
    const r = await resend().emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: args.to,
      subject: args.subject,
      html,
      text: args.markdown,
    });
    if (r.error) return { ok: false, error: r.error.message ?? JSON.stringify(r.error) };
    return { ok: true, id: r.data?.id ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── HTML rendering ─────────────────────────────────────────────────────
const SEVERITY_COLORS: Record<string, string> = {
  critical: "#be5050",
  warn: "#b07a3a",
  info: "#5a7a8a",
};

function renderAlertHtml(args: AlertEmailArgs): string {
  const color = SEVERITY_COLORS[args.severity] ?? SEVERITY_COLORS.info;
  return `<!doctype html>
<html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#1C1E1B;background:#F7F5F0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:6px;overflow:hidden;border-top:3px solid ${color};">
        <tr><td style="padding:28px 28px 8px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.08em;color:${color};text-transform:uppercase;margin-bottom:14px;">Nora · ${args.severity}</div>
          <div style="font-size:16px;font-weight:600;margin-bottom:10px;line-height:1.3;">${escapeHtml(args.summary)}</div>
          <div style="font-size:14px;line-height:1.55;color:#3a3c39;">${escapeHtml(args.detail).replace(/\n/g, "<br/>")}</div>
          ${args.link_url ? `<div style="margin-top:18px;"><a href="${escapeHtml(args.link_url)}" style="display:inline-block;padding:10px 18px;background:#1C1E1B;color:#fff;text-decoration:none;font-size:13px;font-weight:500;">${escapeHtml(args.link_label ?? "Open")}</a></div>` : ""}
        </td></tr>
        <tr><td style="padding:20px 28px;border-top:1px solid #E5DECF;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.06em;color:#8A8C85;">
          GloryBe2God LLC  ·  gb2gllc.com  ·  reply to silence Nora for this category
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function renderDigestHtml(markdown: string): string {
  const body = mdToHtml(markdown);
  return `<!doctype html>
<html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#1C1E1B;background:#F7F5F0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FFFFFF;border-radius:6px;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.08em;color:#8A8C85;text-transform:uppercase;margin-bottom:18px;">Nora · weekly cash digest</div>
          ${body}
        </td></tr>
        <tr><td style="padding:24px 32px;border-top:1px solid #E5DECF;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.06em;color:#8A8C85;">
          GloryBe2God LLC  ·  gb2gllc.com  ·  hello@gb2gllc.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function plainBodyToHtml(body: string): string {
  const paragraphs = body.split(/\n\n+/).map((p) => `<p style="margin:0 0 14px;line-height:1.55;">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`).join("\n");
  return `<!doctype html>
<html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#1C1E1B;background:#FFFFFF;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;">
        <tr><td style="padding:0 24px;font-size:15px;color:#1C1E1B;">${paragraphs}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function mdToHtml(md: string): string {
  let s = escapeHtml(md);
  s = s.replace(/^### (.+)$/gm, '<h3 style="margin:18px 0 6px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#555;">$1</h3>');
  s = s.replace(/^## (.+)$/gm,  '<h2 style="margin:22px 0 8px;font-size:16px;font-weight:600;color:#1C1E1B;">$1</h2>');
  s = s.replace(/^# (.+)$/gm,   '<h1 style="margin:0 0 14px;font-size:20px;font-weight:600;color:#1C1E1B;">$1</h1>');
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#2C5A7A;text-decoration:none;border-bottom:1px solid rgba(44,90,122,0.3);">$1</a>');
  s = s.replace(/(^|\n)((?:[-*] .+\n?)+)/g, (_m, pre, block) => {
    const items = block.trim().split("\n").map((ln: string) => ln.replace(/^[-*] /, "").trim()).map((it: string) => `<li style="margin:3px 0;">${it}</li>`).join("");
    return `${pre}<ul style="margin:6px 0 12px;padding-left:22px;">${items}</ul>`;
  });
  s = s.split(/\n{2,}/).map((blk) => {
    const trimmed = blk.trim();
    if (!trimmed) return "";
    if (/^<(h\d|ul|ol|pre)/.test(trimmed)) return trimmed;
    return `<p style="margin:0 0 10px;line-height:1.55;">${trimmed.replace(/\n/g, "<br/>")}</p>`;
  }).join("\n");
  return s;
}

function escapeHtml(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
