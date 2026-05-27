import { resend } from "@/lib/resend";
import { supabaseAdmin } from "@/lib/supabase";

export type SendArgs = {
  campaignId: string;
  leadId: string;
  to: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  body: string;       // plain text; we'll convert line breaks for HTML
  dailyCap: number;
};

export type SendResult =
  | { ok: true; resendId: string }
  | { ok: false; error: string; code?: "daily_cap" | "send_failed" };

// Hard rate limit: count sends from this campaign in the last 24h. If we're
// at or above the daily cap, refuse — caller can re-approve tomorrow.
export async function sendOutreachEmail(args: SendArgs): Promise<SendResult> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("avery_leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", args.campaignId)
    .eq("status", "sent")
    .gte("sent_at", since);
  if ((count ?? 0) >= args.dailyCap) {
    return {
      ok: false,
      code: "daily_cap",
      error: `Daily cap of ${args.dailyCap} reached for this campaign. Try again in 24 hours.`,
    };
  }

  const html = bodyToHtml(args.body);
  const fromAddr = `${args.fromName} <${args.fromEmail}>`;

  try {
    const res = await resend().emails.send({
      from: fromAddr,
      to: args.to,
      subject: args.subject,
      html,
      text: args.body,
      replyTo: args.fromEmail,
    });
    if (res.error) {
      return { ok: false, code: "send_failed", error: res.error.message ?? JSON.stringify(res.error) };
    }
    return { ok: true, resendId: res.data?.id ?? "" };
  } catch (err) {
    return { ok: false, code: "send_failed", error: err instanceof Error ? err.message : String(err) };
  }
}

// Wrap plain-text body in a minimal HTML email with the GB2G footer.
function bodyToHtml(body: string): string {
  const paragraphs = body.split(/\n\n+/).map((p) => `<p style="margin:0 0 14px;line-height:1.55;">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`).join("\n");
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#1C1E1B;background:#FFFFFF;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;">
        <tr><td style="padding:0 24px;font-size:15px;color:#1C1E1B;">
          ${paragraphs}
        </td></tr>
        <tr><td style="padding:24px;border-top:1px solid #E5DECF;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.06em;color:#8A8C85;">
          GloryBe2God LLC  ·  gb2gllc.com  ·  hello@gb2gllc.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
