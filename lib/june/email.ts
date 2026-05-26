import { resend, DEFAULT_FROM } from "@/lib/resend";
import type { AuditData } from "./audit";

const FROM = process.env.RESEND_FROM_JUNE ?? "June at GB2G <june@gb2gllc.com>";

export async function sendAuditEmail(opts: {
  to: string;
  audit: AuditData;
  websiteUrl: string;
  pdfBuffer: Buffer;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const filename = safeFilename(`${opts.audit.company_name} — AI Opportunity Audit.pdf`);
  const subject = `Your AI Opportunity Audit, ${opts.audit.company_name}`;

  try {
    const res = await resend().emails.send({
      from: FROM,
      to: opts.to,
      subject,
      html: html(opts.audit),
      text: textFallback(opts.audit),
      attachments: [
        {
          filename,
          content: opts.pdfBuffer,
        },
      ],
    });
    if (res.error) return { ok: false, error: res.error.message ?? JSON.stringify(res.error) };
    return { ok: true, id: res.data?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function safeFilename(name: string): string {
  return name.replace(/[\/\\?%*:|"<>]/g, "-").slice(0, 180);
}

function html(audit: AuditData): string {
  const topAgent = audit.opportunities[0]?.agent_name ?? "an AI assistant";
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#FAF6EC;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#1C1E1B;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6EC;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid rgba(28,30,27,0.06);">
          <tr>
            <td style="padding:32px 32px 8px;">
              <div style="font-size:20px;font-weight:500;letter-spacing:-0.04em;color:#1C1E1B;">
                gb<em style="font-family:'EB Garamond',Georgia,serif;font-style:italic;color:#C9A961;">2</em>g
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 8px;">
              <p style="font-size:15px;line-height:1.55;margin:0 0 14px;">Hi,</p>
              <p style="font-size:15px;line-height:1.55;margin:0 0 14px;">
                I took a look at <strong>${escape(audit.company_name)}</strong> and put together a quick read on where AI could quietly take work off your plate.
              </p>
              <p style="font-size:15px;line-height:1.55;margin:0 0 14px;">
                It's attached as a PDF — three to five concrete agent ideas, ranked by impact for what you actually do. ${topAgent} is the one I'd start with.
              </p>
              <p style="font-size:15px;line-height:1.55;margin:0 0 14px;">
                If anything in there resonates, reply to this email and we'll set up a 20-minute call. No pitch deck, no pressure.
              </p>
              <p style="font-size:15px;line-height:1.55;margin:0 0 6px;">— June</p>
              <p style="font-size:11px;line-height:1.5;color:#8A8C85;margin:0 0 4px;font-family:'JetBrains Mono',monospace;letter-spacing:0.04em;">
                June · GB2GLLC
              </p>
              <p style="font-size:11px;line-height:1.5;color:#8A8C85;margin:0;font-family:'JetBrains Mono',monospace;letter-spacing:0.04em;">
                <a href="https://gb2gllc.com" style="color:#8A8C85;text-decoration:none;">gb2gllc.com</a> · <a href="mailto:hello@gb2gllc.com" style="color:#8A8C85;text-decoration:none;">hello@gb2gllc.com</a>
              </p>
            </td>
          </tr>
          <tr><td style="height:24px;"></td></tr>
          <tr>
            <td style="padding:14px 32px 28px;border-top:1px solid rgba(28,30,27,0.06);font-family:'JetBrains Mono',monospace;font-size:10px;color:#8A8C85;letter-spacing:0.06em;">
              "Work as for the Lord" · Col. 3:23
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function textFallback(audit: AuditData): string {
  return `Hi,

I took a look at ${audit.company_name} and put together a quick read on where AI could quietly take work off your plate.

It's attached as a PDF — three to five concrete agent ideas, ranked by impact for what you actually do.

If anything resonates, reply to this email and we'll set up a 20-minute call. No pitch deck, no pressure.

— June
GB2GLLC · gb2gllc.com · hello@gb2gllc.com
`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
