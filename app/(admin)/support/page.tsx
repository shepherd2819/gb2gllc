import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

export default async function SupportListPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/support");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { all } = await searchParams;
  const showAll = all === "1";

  let q = supabaseAdmin
    .from("tickets")
    .select("id, subject, status, created_at, client:clients(name, company)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (!showAll) q = q.in("status", ["open", "in_progress", "awaiting_review"]);
  const { data: tickets } = await q;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Support tickets</h1>
        <p className="page-sub">Submitted via the portal · {showAll ? "all" : "open only"}</p>
      </div>
      <div style={{ marginBottom: 12 }}>
        <a className="admin-btn" href={showAll ? "/support" : "/support?all=1"}>
          {showAll ? "Show open only" : "Show all"}
        </a>
      </div>
      {(tickets ?? []).length === 0 ? (
        <p className="muted">No tickets to show.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Client</th><th>Subject</th><th>Status</th><th>Created</th><th /></tr>
            </thead>
            <tbody>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {tickets!.map((t: any) => (
                <tr key={t.id}>
                  <td>{t.client?.name ?? "—"}{t.client?.company ? ` · ${t.client.company}` : ""}</td>
                  <td><a href={`/support/${t.id}`}>{t.subject}</a></td>
                  <td><span className={`badge ${t.status}`}>{t.status.replace("_", " ")}</span></td>
                  <td>{new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                  <td><a href={`/support/${t.id}`}>Open →</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
