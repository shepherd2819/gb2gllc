import { supabaseAdmin } from "@/lib/supabase";
import { InvoiceForm } from "./InvoiceForm";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client: preselectedClient } = await searchParams;

  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id, name, email, company, stripe_customer_id, status")
    .eq("status", "active")
    .order("company");

  const { data: invoices } = await supabaseAdmin
    .from("invoices")
    .select("*, clients(name, company, email)")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <>
      <div className="admin-page-header">
        <h1>Billing</h1>
      </div>

      <div className="admin-two-col">
        <div>
          <div className="admin-card">
            <h2 className="admin-card-title">Send invoice</h2>
            <InvoiceForm clients={clients ?? []} preselectedClientId={preselectedClient} />
          </div>
        </div>

        <div>
          <h2 className="admin-section-title">Invoice history</h2>
          <div className="admin-list">
            {(invoices ?? []).length === 0 && <div className="admin-empty">No invoices yet</div>}
            {(invoices ?? []).map(inv => {
              const c = inv.clients as {name:string|null;company:string|null;email:string} | null;
              return (
                <div key={inv.id} className="invoice-row">
                  <div>
                    <div className="inv-client">{c?.company || c?.name || c?.email || "—"}</div>
                    <div className="inv-desc">{inv.description || "Invoice"}</div>
                  </div>
                  <span className="inv-amount">${(inv.amount_cents / 100).toFixed(2)}</span>
                  <span className={`inv-status ${inv.status}`}>{inv.status}</span>
                  <span className="inv-date">{new Date(inv.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
