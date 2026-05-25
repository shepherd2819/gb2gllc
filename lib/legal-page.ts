// Shared HTML shell for /privacy, /terms, /data-deletion. Matches the
// homepage (public/workbench.html) typography + colors so the legal pages
// feel like part of the site, not a tacked-on doc.

export function renderLegalPage(opts: {
  title: string;
  effective: string;
  contentHtml: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts.title)} · GB2GLLC</title>
<link rel="icon" href="/favicon-512.png" type="image/png" />
<link rel="apple-touch-icon" href="/favicon-512.png" />
<meta name="theme-color" content="#FAF6EC" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  :root {
    --parchment: #FAF6EC;
    --parchment-2: #F4EEE2;
    --ink: #1C1E1B;
    --ink-soft: #4A4D47;
    --ink-mute: #8A8C85;
    --rule: rgba(28,30,27,0.10);
    --gold: #C9A961;
    --sans: "Inter", ui-sans-serif, system-ui, sans-serif;
    --serif: "EB Garamond", Georgia, serif;
    --mono: "JetBrains Mono", ui-monospace, monospace;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--parchment);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 15px;
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--ink); text-decoration: underline; text-decoration-color: var(--rule); text-underline-offset: 3px; }
  a:hover { text-decoration-color: var(--ink); }

  .legal-nav {
    display: flex; align-items: center; justify-content: space-between;
    padding: 24px max(24px, 6vw); border-bottom: 1px solid var(--rule);
  }
  .legal-nav .mark { font-size: 20px; font-weight: 500; letter-spacing: -0.04em; color: var(--ink); text-decoration: none; }
  .legal-nav .mark em { font-family: var(--serif); font-style: italic; color: var(--gold); }
  .legal-nav .back { font-family: var(--mono); font-size: 12px; color: var(--ink-mute); text-decoration: none; }
  .legal-nav .back:hover { color: var(--ink); }

  .legal-wrap {
    max-width: 720px;
    margin: 0 auto;
    padding: 48px max(24px, 6vw) 96px;
  }
  .legal-eyebrow {
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--ink-mute); margin-bottom: 12px;
  }
  h1 {
    font-family: var(--serif); font-weight: 400; font-size: 44px;
    line-height: 1.1; letter-spacing: -0.02em;
    margin: 0 0 8px;
  }
  .legal-effective { color: var(--ink-mute); font-size: 13px; font-family: var(--mono); margin: 0 0 40px; }

  .legal-content h2 {
    font-family: var(--serif); font-weight: 500; font-size: 22px;
    margin: 36px 0 10px;
  }
  .legal-content h3 {
    font-size: 14px; font-family: var(--mono); letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--ink-soft);
    margin: 22px 0 6px;
  }
  .legal-content p { margin: 0 0 14px; }
  .legal-content ul { margin: 0 0 14px; padding-left: 22px; }
  .legal-content li { margin: 4px 0; }
  .legal-content strong { font-weight: 500; color: var(--ink); }
  .legal-content code {
    font-family: var(--mono); font-size: 13px;
    background: var(--parchment-2); padding: 1px 6px; border-radius: 4px;
  }

  .legal-footer {
    border-top: 1px solid var(--rule);
    padding: 28px max(24px, 6vw);
    display: flex; flex-wrap: wrap; gap: 16px 24px; justify-content: space-between;
    font-family: var(--mono); font-size: 11px; color: var(--ink-mute);
  }
  .legal-footer a { color: var(--ink-mute); text-decoration: none; }
  .legal-footer a:hover { color: var(--ink); }

  @media (max-width: 600px) {
    h1 { font-size: 32px; }
  }
</style>
</head>
<body>
  <nav class="legal-nav">
    <a href="/" class="mark">gb<em>2</em>g</a>
    <a href="/" class="back">← back to home</a>
  </nav>

  <main class="legal-wrap">
    <div class="legal-eyebrow">${escapeHtml(opts.title)}</div>
    <h1>${escapeHtml(opts.title)}</h1>
    <p class="legal-effective">Effective ${escapeHtml(opts.effective)}</p>
    <div class="legal-content">
      ${opts.contentHtml}
    </div>
  </main>

  <footer class="legal-footer">
    <span>© GloryBe2God LLC</span>
    <span style="display: flex; gap: 16px;">
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/data-deletion">Data deletion</a>
      <a href="mailto:hello@gb2gllc.com">hello@gb2gllc.com</a>
    </span>
  </footer>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
