import { renderLegalPage } from "@/lib/legal-page";

const CONTENT = /* html */ `
<p>GloryBe2God LLC ("<strong>GB2G</strong>," "we," "us") builds AI software for businesses. This policy explains what data we collect, how we use it, and the choices you have.</p>

<h2>Who this applies to</h2>
<ul>
  <li>Visitors to <code>gb2gllc.com</code></li>
  <li>Clients using our portal at <code>home.gb2gllc.com</code></li>
  <li>People who interact with AI agents (Herald, Maya, Mark, and others) we operate on behalf of our clients</li>
  <li>Anyone who submits our intake form</li>
</ul>

<h2>What we collect</h2>

<h3>From visitors to gb2gllc.com</h3>
<ul>
  <li>Standard server logs (IP address, user agent, referrer) used for security and basic analytics</li>
  <li>We do not use cookies for advertising or cross-site tracking</li>
</ul>

<h3>From clients in our portal</h3>
<ul>
  <li>Account information: name, email, company, password (hashed by our authentication provider)</li>
  <li>Sign-in timestamps</li>
  <li>Configuration you create (agent settings, connected accounts, URLs, brand instructions)</li>
  <li>Support ticket contents</li>
</ul>

<h3>From AI agent interactions</h3>
<p>When you message an AI agent we operate on behalf of a client — for example, Herald on a website, Maya on a Facebook or Instagram page, or Mark via Slack — we receive and store:</p>
<ul>
  <li>The text of your messages</li>
  <li>Platform metadata (sender ID, page ID, timestamp)</li>
  <li>The bot's reply</li>
  <li>Property addresses sent to Mark (for square footage lookups)</li>
</ul>

<h3>From intake form submissions</h3>
<ul>
  <li>Name, company, email, phone</li>
  <li>Project goals and the answers you provide</li>
  <li>Files you upload</li>
  <li>Calendar booking information</li>
</ul>

<h2>How we use your data</h2>
<ul>
  <li>To operate the products you (or our client) signed up for</li>
  <li>To send service-related email (digests, invitations, password resets, support replies)</li>
  <li>To respond to your support requests</li>
  <li>To improve our products in aggregate only — never sold, never used to identify you to other parties</li>
  <li>To comply with legal obligations</li>
</ul>

<h2>Who we share it with</h2>
<p>We use the following third-party services to operate our products. Each receives only the data needed for its function:</p>
<ul>
  <li><strong>Supabase</strong> — Postgres database hosting (all stored data)</li>
  <li><strong>Vercel</strong> — web hosting and serverless compute</li>
  <li><strong>WorkOS</strong> — authentication (email + hashed password)</li>
  <li><strong>Anthropic</strong> — Claude AI for response generation (message text sent to AI agents)</li>
  <li><strong>chatbot.com</strong> — Herald conversational engine (Herald transcripts)</li>
  <li><strong>Resend</strong> — transactional email delivery</li>
  <li><strong>Stripe</strong> — payment processing (billing information)</li>
  <li><strong>Meta Platforms</strong> — Facebook and Instagram (for Maya agent operation)</li>
  <li><strong>ATTOM Data and RentCast</strong> — property data (addresses sent for Mark lookups)</li>
  <li><strong>Twilio</strong> — SMS delivery (for voicemail callback replies)</li>
  <li><strong>Notion</strong> — intake form archive</li>
  <li><strong>Slack</strong> — escalations (for clients who connect Slack)</li>
</ul>

<p><strong>Anthropic, chatbot.com, and the other AI providers we use do not use your data to train their models</strong> — that is part of our contractual agreement with each of them.</p>

<p><strong>We do not sell your personal information.</strong></p>

<h2>Data retention windows</h2>
<ul>
  <li><strong>Account data</strong> — kept while your account is active; deleted within 30 days of account closure</li>
  <li><strong>AI conversation transcripts</strong> (Herald, Maya, Mark) — retained for <strong>12 months</strong> from the date of the interaction, then automatically deleted</li>
  <li><strong>Property lookup logs</strong> (Mark) — retained 12 months</li>
  <li><strong>Intake submissions</strong> — retained 24 months for follow-up purposes; deleted sooner on request</li>
  <li><strong>Support tickets</strong> — retained 24 months from resolution</li>
  <li><strong>Encrypted backups</strong> — purged on a 30-day rolling basis</li>
  <li><strong>Financial records required by law</strong> (invoices, tax) — retained 7 years per IRS requirements</li>
</ul>

<h2>Your rights</h2>
<ul>
  <li><strong>Access</strong> — ask for a copy of the data we hold about you</li>
  <li><strong>Correction</strong> — update or correct it (most fields are editable in your portal Account page)</li>
  <li><strong>Deletion</strong> — see our <a href="/data-deletion">Data Deletion</a> page</li>
  <li><strong>Portability</strong> — request a machine-readable export</li>
</ul>
<p>To exercise any right, email <a href="mailto:hello@gb2gllc.com">hello@gb2gllc.com</a>. We will respond within 30 days.</p>

<h3>California residents (CCPA)</h3>
<p>If you live in California, you have additional rights under the California Consumer Privacy Act:</p>
<ul>
  <li>Right to know what categories of personal information we collect</li>
  <li>Right to delete personal information (with limited exceptions)</li>
  <li>Right to opt out of "sale" of personal information — <strong>we do not sell personal information</strong></li>
  <li>Right not to be discriminated against for exercising these rights</li>
</ul>
<p>To make a CCPA request, email <a href="mailto:hello@gb2gllc.com">hello@gb2gllc.com</a> with subject "CCPA Request."</p>

<h2>Children</h2>
<p>GB2G's services are intended for business use by adults. We do not knowingly collect data from anyone under 18. If you believe we have, please contact us and we will delete it.</p>

<h2>Security</h2>
<p>We use encryption in transit (TLS) and at rest. Passwords are hashed by our authentication provider. Database access is restricted to service-role credentials embedded in our application code. No system is completely secure, but we follow industry-standard practices.</p>

<h2>Changes to this policy</h2>
<p>We will post any changes here with a new effective date. Material changes will also be emailed to active clients.</p>

<h2>Contact</h2>
<p>
  GloryBe2God LLC<br />
  <a href="mailto:hello@gb2gllc.com">hello@gb2gllc.com</a><br />
  Mailing address available upon request.
</p>
`;

export async function GET() {
  const html = renderLegalPage({
    title: "Privacy Policy",
    effective: "May 25, 2026",
    contentHtml: CONTENT,
  });
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
