import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

export default async function WrenAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ wren_install?: string }>;
}) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/agents/wren");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { wren_install } = await searchParams;
  const { data: accounts } = await supabaseAdmin
    .from("wren_inbox_accounts")
    .select("id, email_address, status, last_polled_at, last_poll_error, created_at")
    .order("created_at", { ascending: false });

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Wren · Support inbox triage</h1>
        <p className="page-sub">Connects to a Gmail mailbox (e.g. support@), classifies new mail, drafts replies for your approval.</p>
      </div>

      {wren_install === "connected" && <div className="admin-flash success">Mailbox connected.</div>}
      {wren_install && wren_install !== "connected" && <div className="admin-flash error">Install failed: {wren_install}</div>}

      <div style={{ marginBottom: 16 }}>
        <a className="admin-btn primary" href="/api/wren/oauth/start">Connect mailbox</a>
      </div>

      {(accounts ?? []).length === 0 ? (
        <p className="muted">No mailboxes connected yet.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Mailbox</th><th>Status</th><th>Last polled</th><th>Last error</th><th /></tr>
            </thead>
            <tbody>
              {accounts!.map((a) => (
                <tr key={a.id}>
                  <td><a href={`/agents/wren/${a.id}`}>{a.email_address}</a></td>
                  <td><span className={`badge ${a.status}`}>{a.status}</span></td>
                  <td>{a.last_polled_at ? new Date(a.last_polled_at).toLocaleString() : "—"}</td>
                  <td className="muted">{a.last_poll_error ?? "—"}</td>
                  <td><a href={`/agents/wren/${a.id}`}>Open →</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
