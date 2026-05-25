import { renderLegalPage } from "@/lib/legal-page";

const CONTENT = /* html */ `
<p>These terms govern your use of services provided by GloryBe2God LLC ("<strong>GB2G</strong>," "we," "us"), a United States limited liability company. By using our services, you agree to these terms.</p>

<h2>What we offer</h2>
<ul>
  <li><strong>Herald</strong> — conversational AI for client websites</li>
  <li><strong>Atrium</strong> — website design and build services</li>
  <li><strong>Steward</strong> — AI agents (such as Mark and Maya) operating on platforms you connect</li>
  <li>The GB2G client portal at <code>home.gb2gllc.com</code> and related tools</li>
</ul>

<h2>Your account</h2>
<ul>
  <li>You must be at least 18 years old to use our services</li>
  <li>You are responsible for keeping your sign-in credentials secure</li>
  <li>You are responsible for what is done under your account, including by teammates you invite</li>
</ul>

<h2>Payment</h2>
<ul>
  <li>Subscription products are billed monthly or annually as agreed</li>
  <li>Project-based work (Atrium) is billed per the statement of work or invoice</li>
  <li>Invoices are due within 14 days of issue</li>
  <li>Late payments may result in service suspension</li>
  <li>Monthly subscriptions are not refundable for the current period; annual subscriptions are refundable on a pro-rata basis for unused months if you cancel for reasons that are not your fault</li>
  <li>All amounts are in US Dollars unless otherwise stated</li>
</ul>

<h2>Acceptable use</h2>
<p>You may not use our services to:</p>
<ul>
  <li>Violate any law</li>
  <li>Send spam or harass anyone</li>
  <li>Infringe intellectual-property rights</li>
  <li>Distribute malware</li>
  <li>Reverse engineer our systems</li>
  <li>Impersonate any person or entity</li>
  <li>Bypass rate limits or security controls</li>
</ul>

<h2>Your content</h2>
<ul>
  <li>You own your data, configurations, and AI conversation transcripts</li>
  <li>You grant us a limited, non-exclusive license to process that data to provide our services</li>
  <li>We will return or export your data on reasonable request</li>
  <li>We will delete your data within 30 days of account closure, as described in our <a href="/privacy">Privacy Policy</a></li>
</ul>

<h2>Our intellectual property</h2>
<ul>
  <li>Our software, brand, designs, and documentation remain ours</li>
  <li>For Atrium projects, deliverables become yours per the statement of work (typically on final payment)</li>
</ul>

<h2>Third-party services</h2>
<p>Our products integrate with third-party services (Slack, Meta, chatbot.com, ATTOM, RentCast, and others). You are responsible for your relationship with those services and their own terms. Our service may be affected by their availability.</p>

<h2>AI output disclaimer</h2>
<ul>
  <li>AI agents we provide draft responses based on configuration you (or our client) supplied</li>
  <li>AI output may contain errors. We are not liable for damages caused by AI-generated content</li>
  <li>You are responsible for reviewing escalations and any material decisions</li>
  <li>AI agents do not replace professional advice (legal, medical, financial, real-estate, or otherwise)</li>
</ul>

<h2>Service availability</h2>
<p>We aim for high uptime but make no specific uptime guarantee unless stated in your individual contract. We may perform scheduled maintenance with reasonable notice.</p>

<h2>Termination</h2>
<ul>
  <li>You may cancel at any time by emailing <a href="mailto:hello@gb2gllc.com">hello@gb2gllc.com</a> or via your portal Account page</li>
  <li>We may suspend or terminate accounts for material breach of these terms, on reasonable notice when feasible</li>
  <li>On termination, we will provide a data export on reasonable request</li>
</ul>

<h2>Limitation of liability</h2>
<p>To the maximum extent permitted by law, our total liability for any claim related to our services is capped at the amount you paid us in the 12 months preceding the claim. We are not liable for indirect, incidental, consequential, or punitive damages.</p>

<h2>Indemnification</h2>
<p>You agree to indemnify and hold GB2G harmless from claims arising out of your misuse of the services or your violation of these terms.</p>

<h2>Governing law</h2>
<p>These terms are governed by the laws of the United States and the state in which GloryBe2God LLC is registered, without regard to conflict-of-laws principles. Any disputes will be resolved in the state or federal courts located in that state.</p>

<h2>Changes</h2>
<p>We may update these terms. Material changes will be emailed to active clients with at least 30 days' notice and posted here with a new effective date.</p>

<h2>Contact</h2>
<p>
  GloryBe2God LLC<br />
  <a href="mailto:hello@gb2gllc.com">hello@gb2gllc.com</a>
</p>
`;

export async function GET() {
  const html = renderLegalPage({
    title: "Terms of Service",
    effective: "May 25, 2026",
    contentHtml: CONTENT,
  });
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
