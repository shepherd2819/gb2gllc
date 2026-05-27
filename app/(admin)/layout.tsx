import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { AdminThemeToggle } from "./AdminThemeToggle";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/admin");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>GB2G · Admin</title>
        <link rel="icon" href="/favicon-512.png" type="image/png" />
        <link rel="apple-touch-icon" href="/favicon-512.png" />
        <meta name="theme-color" content="#F7F5F0" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/admin/admin.css" />
        <script src="/admin/theme-init.js" />
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
            <a href="/submissions">Submissions</a>
            <a href="/billing">Billing</a>
            <a href="/agents/iris">Iris</a>
            <a href="/agents/avery">Avery</a>
            <a href="/agents/june">June</a>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <AdminThemeToggle />
            <a href="/auth/signout" className="admin-signout">Sign out</a>
          </div>
        </nav>
        <main className="admin-main">{children}</main>
      </body>
    </html>
  );
}
