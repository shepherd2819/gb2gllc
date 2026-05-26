import { supabaseAdmin } from "@/lib/supabase";
import { JuneResetControls } from "./JuneResetControls";

export const dynamic = "force-dynamic";

export default async function AdminJunePage() {
  const { data: attempts } = await supabaseAdmin
    .from("june_demo_attempts")
    .select("id, ip, status, website_url, email, email_sent_at, created_at, updated_at, error, audit_data")
    .order("updated_at", { ascending: false })
    .limit(100);

  const rows = attempts ?? [];
  const totals = {
    total: rows.length,
    chatting: rows.filter((r) => r.status === "chatting").length,
    auditing: rows.filter((r) => r.status === "auditing").length,
    emailed: rows.filter((r) => r.status === "emailed").length,
    errored: rows.filter((r) => r.status === "errored").length,
  };

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1>👩 June · Demo attempts</h1>
          <span className="client-email">Last 100 visitors who used the homepage demo</span>
        </div>
        <JuneResetControls />
      </div>

      <div className="admin-stat-row">
        <div className="admin-stat"><div className="asn">{totals.total}</div><div className="asl">Total</div></div>
        <div className="admin-stat"><div className="asn" style={{ color: "var(--sage)" }}>{totals.emailed}</div><div className="asl">Emailed</div></div>
        <div className="admin-stat"><div className="asn" style={{ color: "var(--gold, #C9A961)" }}>{totals.auditing}</div><div className="asl">Auditing</div></div>
        <div className="admin-stat"><div className="asn">{totals.chatting}</div><div className="asl">Just chatting</div></div>
        <div className="admin-stat"><div className="asn" style={{ color: "var(--red)" }}>{totals.errored}</div><div className="asl">Errored</div></div>
      </div>

      {rows.length === 0 ? (
        <div className="admin-card" style={{ marginTop: 24 }}>
          <div className="admin-empty" style={{ padding: 24 }}>
            No June attempts yet. Try the demo on gb2gllc.com to populate this view.
          </div>
        </div>
      ) : (
        <div className="admin-card" style={{ marginTop: 24, padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg-mute, rgba(28,30,27,0.04))", textAlign: "left" }}>
                {["Updated", "IP", "Status", "Website", "Email", "Reset"].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid rgba(28,30,27,0.06)" }}>
                  <td style={{ padding: "10px 12px", fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mute)", whiteSpace: "nowrap" }}>
                    {new Date(r.updated_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </td>
                  <td style={{ padding: "10px 12px", fontFamily: "var(--mono)", fontSize: 11 }}>{r.ip}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span className={`status-chip ${r.status === "emailed" ? "active" : "paused"}`} style={{
                      color: r.status === "emailed" ? "var(--sage)" :
                             r.status === "errored" ? "var(--red)" :
                             r.status === "auditing" ? "var(--gold, #C9A961)" : "var(--text-mute)"
                    }}>
                      {r.status}
                    </span>
                    {r.error && (
                      <div style={{ fontSize: 11, color: "var(--red)", fontFamily: "var(--mono)", marginTop: 4, maxWidth: 280 }}>
                        {r.error}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px", fontFamily: "var(--mono)", fontSize: 11, maxWidth: 240, wordBreak: "break-all" }}>
                    {r.website_url ?? <span style={{ color: "var(--text-mute)" }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 12px", fontFamily: "var(--mono)", fontSize: 11 }}>
                    {r.email ?? <span style={{ color: "var(--text-mute)" }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <JuneResetControls attemptId={r.id} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
