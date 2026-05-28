import type { WeeklyMetrics } from "@/lib/chatbot";
import { supportFooterHtml } from "@/lib/email-footer";

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

function fmtHour(h: number | null) {
  if (h === null) return "—";
  const period = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function heraldDigestHtml(opts: {
  clientName: string;
  company: string | null;
  agentName: string | null;
  periodStart: Date;
  periodEnd: Date;
  metrics: WeeklyMetrics;
  portalUrl: string;
}): string {
  const { clientName, company, agentName, periodStart, periodEnd, metrics, portalUrl } = opts;
  const greeting = company || clientName || "there";
  const agent = agentName?.trim() || "Herald";
  const range = `${fmtDate(periodStart)} – ${fmtDate(periodEnd)}`;
  const avg = Math.round(metrics.avg_per_day * 10) / 10;

  const topRows = metrics.top_interactions.length
    ? metrics.top_interactions
        .map(
          (i) => `
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#1C1E1B;">${escape(i.interaction)}</td>
          <td style="padding:8px 0;font-size:13px;color:#8A8C85;text-align:right;font-family:'JetBrains Mono',monospace;">${fmt(i.value)}</td>
        </tr>`
        )
        .join("")
    : `<tr><td colspan="2" style="padding:12px 0;font-size:13px;color:#8A8C85;font-style:italic;">No interaction data this week.</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Herald weekly digest</title>
</head>
<body style="margin:0;padding:0;background:#FAF6EC;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#1C1E1B;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6EC;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid rgba(28,30,27,0.06);">

          <tr>
            <td style="padding:32px 32px 8px;">
              <div style="font-size:22px;font-weight:500;letter-spacing:-0.04em;color:#1C1E1B;">
                gb<em style="font-family:'EB Garamond',Georgia,serif;font-style:italic;color:#C9A961;">2</em>g
              </div>
              <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8A8C85;margin-top:4px;">
                ${escape(agent)} · Weekly Digest
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 32px 8px;">
              <h1 style="font-family:'EB Garamond',Georgia,serif;font-size:28px;font-weight:400;line-height:1.2;color:#1C1E1B;margin:0 0 8px;">
                Your week with ${escape(agent)}.
              </h1>
              <p style="font-size:14px;color:#6B6E66;margin:0 0 4px;line-height:1.5;">
                Hi ${escape(greeting)}, here's how ${escape(agent)} performed for you ${escape(range)}.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 32px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;">
                <tr>
                  <td width="50%" style="background:#FAF6EC;border-radius:12px;padding:18px;vertical-align:top;">
                    <div style="font-family:'EB Garamond',Georgia,serif;font-size:32px;color:#1C1E1B;line-height:1;">${fmt(metrics.conversations)}</div>
                    <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8A8C85;margin-top:6px;">Conversations</div>
                  </td>
                  <td width="50%" style="background:#FAF6EC;border-radius:12px;padding:18px;vertical-align:top;">
                    <div style="font-family:'EB Garamond',Georgia,serif;font-size:32px;color:#1C1E1B;line-height:1;">${fmt(metrics.messages)}</div>
                    <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8A8C85;margin-top:6px;">Messages</div>
                  </td>
                </tr>
                <tr><td colspan="2" style="height:8px;"></td></tr>
                <tr>
                  <td width="50%" style="background:#FAF6EC;border-radius:12px;padding:18px;vertical-align:top;">
                    <div style="font-family:'EB Garamond',Georgia,serif;font-size:32px;color:#1C1E1B;line-height:1;">${avg}</div>
                    <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8A8C85;margin-top:6px;">Avg / day</div>
                  </td>
                  <td width="50%" style="background:#FAF6EC;border-radius:12px;padding:18px;vertical-align:top;">
                    <div style="font-family:'EB Garamond',Georgia,serif;font-size:32px;color:#1C1E1B;line-height:1;">${fmtHour(metrics.busiest_hour)}</div>
                    <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8A8C85;margin-top:6px;">Peak hour</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 32px 8px;">
              <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8A8C85;margin-bottom:10px;">
                Top interactions
              </div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid rgba(28,30,27,0.08);">
                ${topRows}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 32px 32px;">
              <a href="${escape(portalUrl)}" style="display:inline-block;padding:12px 22px;background:#1C1E1B;color:#FAF6EC;text-decoration:none;border-radius:10px;font-size:13px;font-weight:500;">
                Open your dashboard →
              </a>
            </td>
          </tr>

          ${supportFooterHtml()}
          <tr>
            <td style="padding:16px 32px 28px;border-top:1px solid rgba(28,30,27,0.06);">
              <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#8A8C85;letter-spacing:0.06em;">
                GloryBe2God LLC · gb2gllc.com
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function heraldDigestSubject(periodEnd: Date, agentName?: string | null) {
  const agent = agentName?.trim() || "Herald";
  return `${agent} weekly digest · week ending ${fmtDate(periodEnd)}`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
