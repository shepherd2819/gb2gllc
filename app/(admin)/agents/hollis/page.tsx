import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

type CallRow = {
  id: string;
  outcome: string;
  duration_ms: number | null;
  caller_number: string | null;
  created_at: string;
  clients: { name: string | null; company: string | null } | null;
};

export default async function HollisIndexPage() {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/agents/hollis");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const [{ data: calls }, { count: lineCount }] = await Promise.all([
    supabaseAdmin
      .from("hollis_calls")
      .select("id, outcome, duration_ms, caller_number, created_at, clients(name, company)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabaseAdmin.from("hollis_lines").select("id", { count: "exact", head: true }).neq("status", "released"),
  ]);

  const all = (calls ?? []) as unknown as CallRow[];
  const followups = all.filter((c) => ["booking_request", "message", "transfer"].includes(c.outcome)).length;
  const durations = all.map((c) => c.duration_ms ?? 0).filter((d) => d > 0).sort((a, b) => a - b);
  const p50 = durations.length ? durations[Math.floor(durations.length / 2)] : 0;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Hollis · AI phone receptionist</h1>
        <p className="page-sub">Inbound calls across all client lines — booked appointments, leads, messages, and transfers.</p>
      </div>

      <div style={{ marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
        <span><strong>{lineCount ?? 0}</strong> active lines</span>
        <span><strong>{all.length}</strong> recent calls</span>
        <span><strong>{followups}</strong> need follow-up</span>
        <span>median <strong>{p50 ? `${Math.round(p50 / 1000)}s` : "—"}</strong></span>
      </div>

      {all.length === 0 ? (
        <p className="muted">No calls yet. Provision a line from a client&apos;s detail page.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Caller</th>
                <th>Outcome</th>
                <th>Duration</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {all.map((c) => (
                <tr key={c.id}>
                  <td>{c.clients?.company || c.clients?.name || "—"}</td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{c.caller_number ?? "unknown"}</td>
                  <td>{c.outcome.replace(/_/g, " ")}</td>
                  <td>{c.duration_ms ? `${Math.round(c.duration_ms / 1000)}s` : "—"}</td>
                  <td>{new Date(c.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td><a href={`/agents/hollis/${c.id}`}>Open →</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
