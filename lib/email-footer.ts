// lib/email-footer.ts
//
// Shared "Speak to Support" CTA footer for client-facing system emails.
// HTML variant goes in Resend templates (Herald digest, invites, etc.);
// plain-text variant goes in Wren's Gmail drafts. Opt-in per template —
// Avery cold outreach and Iris founder drafts deliberately don't call these.

const PORTAL_URL = () => process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com";

/** Plain-text footer for Gmail drafts. Composed at the end of the draft body. */
export function supportFooterText(): string {
  return `\n—\nNeed help? Open a ticket: ${PORTAL_URL()}/tickets`;
}

/** HTML footer block for Resend templates. Matches herald-digest aesthetic. */
export function supportFooterHtml(): string {
  const url = escapeAttr(`${PORTAL_URL()}/tickets`);
  return `
  <tr>
    <td style="padding:18px 32px 24px;border-top:1px solid rgba(28,30,27,0.06);">
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8A8C85;margin-bottom:10px;">
        Need help?
      </div>
      <a href="${url}" style="display:inline-block;padding:10px 18px;background:#7F9DB9;color:#FAF6EC;text-decoration:none;border-radius:8px;font-size:13px;font-weight:500;">
        Speak to Support →
      </a>
    </td>
  </tr>`;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
