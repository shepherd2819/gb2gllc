import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { after } from "next/server";
import { ToastProvider } from "@/components/ui/toast";

// Only re-write last_signed_in_at if the stored value is older than this.
// Prevents hammering the DB on every nav within the portal.
const SIGNIN_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/dashboard");

  // 1. Try owner lookup (clients.workos_user_id)
  let { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name, email, company, last_signed_in_at")
    .eq("workos_user_id", user.id)
    .single();
  let memberRowId: string | null = null;
  let memberLastSeen: string | null = null;

  // 2. Try teammate lookup (client_members.workos_user_id)
  if (!client) {
    const { data: member } = await supabaseAdmin
      .from("client_members")
      .select("id, last_signed_in_at, clients(id, name, email, company)")
      .eq("workos_user_id", user.id)
      .single();
    if (member?.clients) {
      memberRowId = member.id;
      memberLastSeen = member.last_signed_in_at;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client = member.clients as any;
    }
  }

  // 3. First sign-in fallback: backfill workos_user_id by email
  if (!client && user.email) {
    // 3a. Owner first-sign-in
    const { data: ownerByEmail } = await supabaseAdmin
      .from("clients")
      .select("id, name, email, company, last_signed_in_at, workos_user_id")
      .eq("email", user.email)
      .single();
    if (ownerByEmail && !ownerByEmail.workos_user_id) {
      await supabaseAdmin.from("clients").update({ workos_user_id: user.id }).eq("id", ownerByEmail.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client = ownerByEmail as any;
    }

    // 3b. Teammate first-sign-in
    if (!client) {
      const { data: memberByEmail } = await supabaseAdmin
        .from("client_members")
        .select("id, clients(id, name, email, company)")
        .ilike("email", user.email)
        .is("workos_user_id", null)
        .single();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (memberByEmail?.clients) {
        await supabaseAdmin
          .from("client_members")
          .update({ workos_user_id: user.id, joined_at: new Date().toISOString() })
          .eq("id", memberByEmail.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client = memberByEmail.clients as any;
      }
    }
  }

  if (!client) redirect("/auth/no-account");

  // Gate access on account status — a disabled/paused client must not reach the
  // portal (previously they could sign in regardless; a security/compliance gap).
  const { data: statusRow } = await supabaseAdmin
    .from("clients")
    .select("status")
    .eq("id", client.id)
    .maybeSingle<{ status: string | null }>();
  const suspended = statusRow?.status === "disabled" || statusRow?.status === "paused";

  // Touch last_signed_in_at (debounced, fire-and-forget via after())
  const now = new Date();
  const isOwnerVisit = !memberRowId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastSeen = isOwnerVisit ? (client as any).last_signed_in_at : memberLastSeen;
  const stale = !lastSeen || now.getTime() - new Date(lastSeen).getTime() > SIGNIN_TOUCH_INTERVAL_MS;
  if (stale) {
    const touch = async () => {
      const { error } = isOwnerVisit
        ? await supabaseAdmin.from("clients").update({ last_signed_in_at: now.toISOString() }).eq("id", client!.id)
        : await supabaseAdmin.from("client_members").update({ last_signed_in_at: now.toISOString() }).eq("id", memberRowId!);
      if (error) console.error("[portal layout] touch last_signed_in_at failed", error);
    };
    after(touch());
  }

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>GB2G · Home</title>
        <link rel="icon" href="/favicon-512.png" type="image/png" />
        <link rel="apple-touch-icon" href="/favicon-512.png" />
        <meta name="theme-color" content="#FAF6EC" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/tokens.css" />
        <link rel="stylesheet" href="/portal/portal.css" />
      </head>
      <body data-client-id={client.id}>
        <nav className="portal-nav">
          <a href="/dashboard" className="portal-mark">
            <span className="mark-word">gb<span className="mark-2">2</span>g</span>
            <span className="mark-label">Home</span>
          </a>
          <div className="portal-nav-links">
            <a href="/dashboard">Dashboard</a>
            <a href="/onboarding">Onboarding</a>
            <a href="/connections">Connections</a>
            <a href="/tickets">Support</a>
            <a href="/account">Account</a>
          </div>
          <div className="portal-nav-right">
            <span className="portal-user">{client.name || client.email}</span>
            <a href="/auth/signout" className="portal-signout">Sign out</a>
          </div>
        </nav>
        <main className="portal-main">
          {suspended ? (
            <div style={{ maxWidth: 520, margin: "80px auto", textAlign: "center", padding: "0 20px" }}>
              <h1 style={{ fontFamily: "var(--serif, 'EB Garamond', Georgia, serif)", fontWeight: 400 }}>
                Your account is {statusRow?.status === "paused" ? "paused" : "not active"}
              </h1>
              <p style={{ color: "var(--ink-soft, #4A4D47)", lineHeight: 1.6 }}>
                Please reach out to your GB2G contact to restore access. If you think this is a mistake, email{" "}
                <a href="mailto:john@gb2gllc.com">john@gb2gllc.com</a>.
              </p>
              <p style={{ marginTop: 24 }}><a href="/auth/signout" className="portal-signout">Sign out</a></p>
            </div>
          ) : (
            <ToastProvider>{children}</ToastProvider>
          )}
        </main>
      </body>
    </html>
  );
}
