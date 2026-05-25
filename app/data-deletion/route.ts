import { renderLegalPage } from "@/lib/legal-page";

const CONTENT = /* html */ `
<p>GloryBe2God LLC ("<strong>GB2G</strong>") respects your right to delete personal information we hold about you. This page explains how to make a request and what happens after.</p>

<h2>How to request deletion</h2>
<p>Email <a href="mailto:hello@gb2gllc.com">hello@gb2gllc.com</a> from the email address associated with your account or interaction. Include:</p>
<ul>
  <li>The subject line: <code>Data Deletion Request</code></li>
  <li>The email or account name to delete</li>
  <li>(Optional) The specific data you want removed, if not your entire account</li>
</ul>

<h2>What happens next</h2>
<p>Within <strong>30 days</strong> we will:</p>
<ul>
  <li>Verify the request comes from you (we may ask for confirmation)</li>
  <li>Delete your personal information from our active systems</li>
  <li>Confirm completion via email</li>
</ul>

<h2>What gets deleted</h2>
<ul>
  <li>Your client portal account and any teammate access tied to it</li>
  <li>AI conversation transcripts you participated in (Herald, Maya, Mark)</li>
  <li>Intake form submissions</li>
  <li>Support tickets</li>
  <li>Configuration data you provided</li>
</ul>

<h2>What we retain, and why</h2>
<p>Some data must be retained for legal or operational reasons:</p>
<ul>
  <li><strong>Financial records</strong> (invoices, payments) — retained 7 years per IRS requirements</li>
  <li><strong>Encrypted database backups</strong> — purged on a 30-day rolling basis</li>
  <li><strong>Aggregated, de-identified analytics</strong> — retained indefinitely</li>
</ul>

<h2>For Facebook or Instagram users who messaged a business that uses Maya</h2>
<p>If you've sent a DM or commented on a Facebook Page or Instagram Business account that uses our Maya agent:</p>
<ul>
  <li>Email <a href="mailto:hello@gb2gllc.com">hello@gb2gllc.com</a> from the same email you would use to contact that business</li>
  <li>Mention the name of the business or page you messaged</li>
  <li>We will delete your DM and comment data from our database within 30 days</li>
</ul>
<p>Note: this does not delete the message from Facebook or Instagram themselves. To do that, you'll need to contact the page directly or use Meta's own deletion tools in your account settings.</p>

<h2>Questions</h2>
<p>Reply to your deletion request email or send a new one to <a href="mailto:hello@gb2gllc.com">hello@gb2gllc.com</a>. We're happy to help.</p>
`;

export async function GET() {
  const html = renderLegalPage({
    title: "Data Deletion",
    effective: "May 25, 2026",
    contentHtml: CONTENT,
  });
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
