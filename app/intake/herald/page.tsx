import { redirect } from "next/navigation";

// Reusable public link for Herald-only signups: mints a Herald-tagged
// intake session and redirects to the session URL.
export default async function HeraldIntakePage() {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  const res = await fetch(`${base}/api/intake/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "herald-link", intendedProduct: "herald" }),
    cache: "no-store",
  });

  if (!res.ok) {
    return (
      <html lang="en">
        <body style={{ fontFamily: "sans-serif", padding: 40 }}>
          <p>Something went wrong starting your intake. Please try again.</p>
          <a href="/">← Back to home</a>
        </body>
      </html>
    );
  }

  const { sessionId } = await res.json();
  redirect(`/intake/${sessionId}`);
}
