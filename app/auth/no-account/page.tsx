export default function NoAccountPage() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>GB2G · No Access</title>
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
          .card { text-align: center; max-width: 380px; width: 100%; }
          .wordmark {
            font-size: 24px; font-weight: 500; letter-spacing: -0.04em; margin-bottom: 6px;
          }
          .wordmark em {
            font-family: "EB Garamond", Georgia, serif;
            font-style: italic; color: #C9A961;
          }
          .label {
            font-family: "JetBrains Mono", monospace; font-size: 10px;
            letter-spacing: 0.12em; text-transform: uppercase;
            color: #8A8C85; margin-bottom: 48px;
          }
          h1 {
            font-family: "EB Garamond", Georgia, serif;
            font-size: 30px; font-weight: 400; margin: 0 0 12px; color: #F4EEE2;
          }
          p { font-size: 14px; color: #8A8C85; margin: 0 0 36px; line-height: 1.6; }
          .btn {
            display: inline-block; padding: 12px 28px;
            border: 1px solid #4A4D47; border-radius: 10px;
            color: #8A8C85; font-size: 13px; text-decoration: none;
            transition: border-color 0.15s, color 0.15s;
          }
          .btn:hover { border-color: #F4EEE2; color: #F4EEE2; }
        `}</style>
      </head>
      <body>
        <div className="card">
          <div className="wordmark">gb<em>2</em>g</div>
          <div className="label">Client Portal</div>
          <h1>No portal access yet.</h1>
          <p>
            Your account isn&apos;t linked to a GB2G client profile.<br />
            If you believe this is an error, contact your GB2G account manager.
          </p>
          <a href="/auth/signout" className="btn">Sign out →</a>
        </div>
      </body>
    </html>
  );
}
