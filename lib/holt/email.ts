import { resend } from "@/lib/resend";

const FROM_NAME = "Holt at GB2G";
const FROM_EMAIL = process.env.HOLT_FROM_EMAIL ?? "hello@gb2gllc.com";

export type HoltEmailArgs = {
  to: string;
  subject: string;
  markdownBody: string;
  sources?: { title: string; url: string }[];
};

export async function sendBriefingEmail(args: HoltEmailArgs): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const html = renderHtml(args.markdownBody, args.sources ?? []);
  try {
    const r = await resend().emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: args.to,
      subject: args.subject,
      html,
      text: args.markdownBody,
      replyTo: FROM_EMAIL,
    });
    if (r.error) return { ok: false, error: r.error.message ?? JSON.stringify(r.error) };
    return { ok: true, id: r.data?.id ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Minimal markdown → HTML for the briefing. We don't pull a full library;
// the brief uses a constrained subset: h1/h2/h3, bullets, bold, italic, links.
function mdToHtml(md: string): string {
  let s = escapeHtml(md);
  // Code spans (escape first so backticks survive)
  s = s.replace(/`([^`]+)`/g, '<code style="background:rgba(28,30,27,0.06);padding:1px 4px;border-radius:3px;font-family:monospace;font-size:13px;">$1</code>');
  // Headings
  s = s.replace(/^### (.+)$/gm, '<h3 style="margin:18px 0 6px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#555;">$1</h3>');
  s = s.replace(/^## (.+)$/gm,  '<h2 style="margin:22px 0 8px;font-size:16px;font-weight:600;color:#1C1E1B;">$1</h2>');
  s = s.replace(/^# (.+)$/gm,   '<h1 style="margin:0 0 14px;font-size:20px;font-weight:600;color:#1C1E1B;">$1</h1>');
  // Bold + italic
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#2C5A7A;text-decoration:none;border-bottom:1px solid rgba(44,90,122,0.3);">$1</a>');
  // Bullets (paragraph of -/* lines)
  s = s.replace(/(^|\n)((?:[-*] .+\n?)+)/g, (_m, pre, block) => {
    const items = block.trim().split("\n").map((ln: string) => ln.replace(/^[-*] /, "").trim()).map((it: string) => `<li style="margin:3px 0;">${it}</li>`).join("");
    return `${pre}<ul style="margin:6px 0 12px;padding-left:22px;">${items}</ul>`;
  });
  // Paragraphs (any remaining blocks separated by blank lines)
  s = s.split(/\n{2,}/).map((blk) => {
    const trimmed = blk.trim();
    if (!trimmed) return "";
    if (/^<(h\d|ul|ol|pre)/.test(trimmed)) return trimmed;
    return `<p style="margin:0 0 10px;line-height:1.55;">${trimmed.replace(/\n/g, "<br/>")}</p>`;
  }).join("\n");
  return s;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderHtml(markdownBody: string, sources: { title: string; url: string }[]): string {
  const body = mdToHtml(markdownBody);
  const sourcesBlock = sources.length
    ? `<div style="margin-top:24px;padding-top:14px;border-top:1px solid #E5DECF;font-size:12px;color:#666;">
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.06em;color:#8A8C85;text-transform:uppercase;margin-bottom:6px;">Sources</div>
        ${sources.map((s) => `<div style="margin:3px 0;"><a href="${escapeHtml(s.url)}" style="color:#2C5A7A;text-decoration:none;">${escapeHtml(s.title)}</a></div>`).join("")}
      </div>`
    : "";
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#1C1E1B;background:#F7F5F0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FFFFFF;border-radius:6px;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.08em;color:#8A8C85;text-transform:uppercase;margin-bottom:18px;">Holt · meeting prep</div>
          ${body}
          ${sourcesBlock}
        </td></tr>
        <tr><td style="padding:24px 32px;border-top:1px solid #E5DECF;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.06em;color:#8A8C85;">
          GloryBe2God LLC  ·  gb2gllc.com  ·  Reply STOP to pause briefings
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
