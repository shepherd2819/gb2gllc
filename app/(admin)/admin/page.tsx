import { supabaseAdmin } from "@/lib/supabase";

export default async function AdminOverviewPage() {
  const [
    { data: clients },
    { count: openTickets },
    { data: recentLogs },
    { data: recentIntakes },
  ] = await Promise.all([
    supabaseAdmin.from("clients").select("id, status, client_products(product, active)"),
    supabaseAdmin.from("tickets").select("*", { count: "exact", head: true }).eq("status", "open"),
    supabaseAdmin.from("client_logs").select("id, level, category, message, created_at, client_id").eq("level", "error").order("created_at", { ascending: false }).limit(20),
    supabaseAdmin.from("intake_sessions").select("id, state, submitted_at, notion_page_id").order("submitted_at", { ascending: false }).limit(6),
  ]);

  const allClients = clients ?? [];
  const total = allClients.length;
  const active = allClients.filter(c => (c.status ?? "active") === "active").length;

  const productCounts = { herald: 0, atrium: 0, steward: 0 };
  for (const c of allClients) {
    for (const p of (c.client_products as {product:string;active:boolean}[]) ?? []) {
      if (p.active && p.product in productCounts) productCounts[p.product as keyof typeof productCounts]++;
    }
  }

  const errors = (recentLogs ?? []).length;

  return (
    <>
      <div className="admin-page-header">
        <h1>Overview</h1>
        <span className="admin-count">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Total clients</div>
          <div className="kpi-value">{total}</div>
          <div className="kpi-sub">{active} active</div>
        </div>
        <div className={`kpi-card ${openTickets ? "warn" : ""}`}>
          <div className="kpi-label">Open tickets</div>
          <div className="kpi-value">{openTickets ?? 0}</div>
          <div className="kpi-sub">need attention</div>
        </div>
        <div className={`kpi-card ${errors > 0 ? "alert" : ""}`}>
          <div className="kpi-label">Errors (24h)</div>
          <div className="kpi-value">{errors}</div>
          <div className="kpi-sub">across all clients</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">New leads</div>
          <div className="kpi-value">{(recentIntakes ?? []).length}</div>
          <div className="kpi-sub">recent submissions</div>
        </div>
      </div>

      <div className="product-breakdown">
        {(["herald","atrium","steward"] as const).map(p => (
          <div key={p} className="pb-item">
            <span className={`pb-dot ${p}`} />
            <span className="pb-count">{productCounts[p]}</span>
            <span className="pb-name">{p}</span>
          </div>
        ))}
      </div>

      <div className="admin-two-col">
        <div>
          <h2 className="admin-section-title">Recent intake leads</h2>
          <div className="admin-list">
            {(recentIntakes ?? []).length === 0 && <div className="admin-empty" style={{ padding: "12px 16px" }}>No submissions yet</div>}
            {(recentIntakes ?? []).map((s) => {
              const contact = (s.state as Record<string, Record<string,string>>)?.contact ?? {};
              return (
                <div key={s.id} className="admin-list-row">
                  <div>
                    <div className="alr-name">{contact.company || contact.name || "Unknown"}</div>
                    <div className="alr-sub">{contact.email || s.id}</div>
                  </div>
                  <div className="alr-meta">
                    <span className={`alr-badge ${s.notion_page_id ? "ok" : "warn"}`}>
                      {s.notion_page_id ? "In Notion" : "Pending"}
                    </span>
                    <span className="alr-date">
                      {s.submitted_at ? new Date(s.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h2 className="admin-section-title">Recent errors</h2>
          <div className="admin-list log-list" style={{ borderRadius: "var(--r)", border: "1px solid var(--border)" }}>
            {(recentLogs ?? []).length === 0 && <div className="admin-empty" style={{ padding: "12px 16px" }}>No errors — all clear</div>}
            {(recentLogs ?? []).map((l) => (
              <div key={l.id} className="log-row level-error" style={{ borderBottom: "1px solid var(--border)" }}>
                <span className="log-level error">err</span>
                <span className="log-cat">{l.category}</span>
                <span className="log-msg">{l.message}</span>
                <span className="log-time">{new Date(l.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
