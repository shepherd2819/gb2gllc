import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

export default async function VeraIndexPage() {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/agents/vera");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { data: contracts } = await supabaseAdmin
    .from("contracts")
    .select("id, product, amount_cents, cadence, status, sent_at, signed_at, expires_at, signer_name, clients(name, company)")
    .order("created_at", { ascending: false })
    .limit(200);

  const all = contracts ?? [];
  const counts = {
    sent:    all.filter((c) => c.status === "sent").length,
    signed:  all.filter((c) => c.status === "signed").length,
    voided:  all.filter((c) => c.status === "voided").length,
    expired: all.filter((c) => c.status === "expired").length,
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Vera · Contracts</h1>
        <p className="page-sub">Generate, send, and track GB2GLLC services agreements.</p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <span className={`badge sent`}>{counts.sent} awaiting signature</span>{" "}
        <span className={`badge signed`}>{counts.signed} signed</span>{" "}
        <span className={`badge voided`}>{counts.voided} voided</span>{" "}
        <span className={`badge expired`}>{counts.expired} expired</span>
      </div>

      {all.length === 0 ? (
        <p className="muted">No contracts yet. Generate one from a client&apos;s detail page.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Product</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Signed by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {all.map((c) => {
                const client = c.clients as unknown as { name: string | null; company: string | null };
                return (
                  <tr key={c.id}>
                    <td>{client?.company || client?.name || "—"}</td>
                    <td>{c.product}</td>
                    <td>${((c.amount_cents as number) / 100).toFixed(2)} / {c.cadence}</td>
                    <td><span className={`badge ${c.status}`}>{c.status}</span></td>
                    <td>{c.sent_at ? new Date(c.sent_at as string).toLocaleDateString() : "—"}</td>
                    <td>{c.signer_name ?? "—"}</td>
                    <td><a href={`/agents/vera/${c.id}`}>Open →</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
