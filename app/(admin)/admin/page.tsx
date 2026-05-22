import { supabaseAdmin } from "@/lib/supabase";

export default async function AdminOverviewPage() {
  const [
    { count: totalClients },
    { count: activeClients },
    { data: recentLogs },
    { data: recentIntakes },
  ] = await Promise.all([
    supabaseAdmin.from("clients").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("clients").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabaseAdmin.from("client_logs").select("*").order("created_at", { ascending: false }).limit(10),
    supabaseAdmin.from("intake_sessions").select("id, state, submitted_at, notion_page_id").order("submitted_at", { ascending: false }).limit(5),
  ]);

  return (
    <>
      <div className="admin-page-header">
        <h1>Overview</h1>
      </div>

      <div className="admin-stat-row">
        <div className="admin-stat"><div className="asn">{totalClients ?? 0}</div><div className="asl">Total clients</div></div>
        <div className="admin-stat"><div className="asn">{activeClients ?? 0}</div><div className="asl">Active</div></div>
        <div className="admin-stat"><div className="asn">{(totalClients ?? 0) - (activeClients ?? 0)}</div><div className="asl">Paused / disabled</div></div>
      </div>

      <div className="admin-two-col">
        <div>
          <h2 className="admin-section-title">Recent intake submissions</h2>
          <div className="admin-list">
            {(recentIntakes ?? []).length === 0 && <div className="admin-empty">No submissions yet</div>}
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
                      {s.notion_page_id ? "In Notion" : "No Notion page"}
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
          <h2 className="admin-section-title">Recent system logs</h2>
          <div className="admin-list log-list">
            {(recentLogs ?? []).length === 0 && <div className="admin-empty">No logs yet</div>}
            {(recentLogs ?? []).map((l) => (
              <div key={l.id} className={`log-row level-${l.level}`}>
                <span className={`log-level ${l.level}`}>{l.level}</span>
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
