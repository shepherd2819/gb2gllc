import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await withAuth({ ensureSignedIn: true });
  if (!user || user.email !== ADMIN_EMAIL) redirect("/auth/signin");

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>GB2G · Admin</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <meta name="theme-color" content="#0F1110" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/admin/admin.css" />
      </head>
      <body>
        <nav className="admin-nav">
          <a href="/admin" className="admin-mark">
            gb<span className="a2">2</span>g
            <span className="admin-badge">admin</span>
          </a>
          <div className="admin-nav-links">
            <a href="/admin">Overview</a>
            <a href="/clients">Clients</a>
            <a href="/billing">Billing</a>
          </div>
          <a href="/auth/signout" className="admin-signout">Sign out</a>
        </nav>
        <main className="admin-main">{children}</main>
      </body>
    </html>
  );
}
