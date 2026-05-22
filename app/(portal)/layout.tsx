import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await withAuth();

  if (!user) redirect("/auth/signin");

  // Look up client record by WorkOS user ID
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name, email, company")
    .eq("workos_user_id", user.id)
    .single();

  if (!client) {
    // Account exists in WorkOS but not yet in our DB — edge case
    redirect("/auth/no-account");
  }

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>GB2G · Home</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <meta name="theme-color" content="#FAF6EC" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
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
          {children}
        </main>
      </body>
    </html>
  );
}
