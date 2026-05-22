export default function WelcomePage() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>GB2G · Client Portal</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; height: 100%; }
          body {
            font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
            background: #1C1E1B;
            color: #F4EEE2;
            -webkit-font-smoothing: antialiased;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 24px;
          }
          .card {
            text-align: center;
            max-width: 400px;
            width: 100%;
          }
          .wordmark {
            font-size: 28px;
            font-weight: 500;
            letter-spacing: -0.04em;
            margin-bottom: 8px;
          }
          .wordmark em {
            font-family: "EB Garamond", Georgia, serif;
            font-style: italic;
            color: #C9A961;
          }
          .label {
            font-family: "JetBrains Mono", monospace;
            font-size: 10px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #8A8C85;
            margin-bottom: 48px;
          }
          h1 {
            font-family: "EB Garamond", Georgia, serif;
            font-size: 36px;
            font-weight: 400;
            line-height: 1.2;
            margin: 0 0 12px;
            color: #F4EEE2;
          }
          p {
            font-size: 14px;
            color: #8A8C85;
            margin: 0 0 40px;
            line-height: 1.6;
          }
          .btn {
            display: inline-block;
            padding: 14px 32px;
            background: #C9A961;
            color: #1C1E1B;
            font-size: 14px;
            font-weight: 500;
            border-radius: 10px;
            text-decoration: none;
            transition: opacity 0.15s;
          }
          .btn:hover { opacity: 0.85; }
          .footer {
            margin-top: 48px;
            font-family: "JetBrains Mono", monospace;
            font-size: 10px;
            color: #4A4D47;
            letter-spacing: 0.06em;
          }
        `}</style>
      </head>
      <body>
        <div className="card">
          <div className="wordmark">
            gb<em>2</em>g
          </div>
          <div className="label">Client Portal</div>

          <h1>Your AI employees<br />are ready.</h1>
          <p>Sign in to view your dashboard,<br />track your agents, and submit support requests.</p>

          <a href="/dashboard" className="btn">Sign in to your account →</a>

          <div className="footer">GloryBe2God LLC · gb2gllc.com</div>
        </div>
      </body>
    </html>
  );
}
