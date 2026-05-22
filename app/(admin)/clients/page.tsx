import { supabaseAdmin } from "@/lib/supabase";

export default async function ClientsPage() {
  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id, name, email, company, status, created_at, client_products(product, active)")
    .order("created_at", { ascending: false });

  return (
    <>
      <div className="admin-page-header">
        <h1>Clients</h1>
        <span className="admin-count">{clients?.length ?? 0} total</span>
      </div>

      <div className="admin-table">
        <div className="at-head">
          <span>Company</span>
          <span>Email</span>
          <span>Products</span>
          <span>Status</span>
          <span>Since</span>
          <span></span>
        </div>
        {(clients ?? []).map((c) => {
          const prods = (c.client_products as {product:string; active:boolean}[]) ?? [];
          const activeProds = prods.filter(p => p.active).map(p => p.product);
          return (
            <div key={c.id} className={`at-row status-${c.status ?? "active"}`}>
              <span className="at-company">{c.company || "—"}</span>
              <span className="at-email">{c.email}</span>
              <span className="at-products">
                {activeProds.length === 0
                  ? <span className="prod-none">none</span>
                  : activeProds.map(p => <span key={p} className={`prod-chip ${p}`}>{p}</span>)
                }
              </span>
              <span><span className={`status-chip ${c.status ?? "active"}`}>{c.status ?? "active"}</span></span>
              <span className="at-date">{new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}</span>
              <span><a href={`/clients/${c.id}`} className="at-link">Manage →</a></span>
            </div>
          );
        })}
      </div>
    </>
  );
}
