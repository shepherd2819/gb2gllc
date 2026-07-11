import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { ToastProvider } from "@/components/ui/toast";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchAgentStatuses } from "@/lib/agent-status";
import type { PaletteClient } from "@/lib/palette-search";
import { AdminSidebar } from "./AdminSidebar";
import { CommandPalette } from "./CommandPalette";
import { ShellTransition } from "./ShellTransition";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

async function fetchOpenTicketCount(): Promise<number> {
  try {
    const { count } = await supabaseAdmin
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "in_progress", "awaiting_review"]);
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function fetchPaletteClients(): Promise<PaletteClient[]> {
  try {
    const { data } = await supabaseAdmin
      .from("clients")
      .select("id, name, company, email")
      .order("company")
      .limit(500);
    return data ?? [];
  } catch {
    return [];
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/admin");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const [statuses, ticketCount, clients] = await Promise.all([
    fetchAgentStatuses(),
    fetchOpenTicketCount(),
    fetchPaletteClients(),
  ]);

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
        <link rel="stylesheet" href="/tokens.css" />
        <link rel="stylesheet" href="/admin/admin.css" />
        <script src="/admin/theme-init.js" />
      </head>
      <body>
        <div className="shell">
          <AdminSidebar statuses={statuses} ticketCount={ticketCount} />
          <main className="shell-content">
            <div className="shell-content-inner">
              <ToastProvider>
                <ShellTransition>{children}</ShellTransition>
              </ToastProvider>
            </div>
          </main>
        </div>
        <CommandPalette clients={clients} />
      </body>
    </html>
  );
}
