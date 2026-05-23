import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function AdminMarkPage() {
  const [{ data: lookups }, { data: tokens }, { data: clients }] = await Promise.all([
    supabaseAdmin
      .from("mark_lookups")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    supabaseAdmin
      .from("steward_platform_tokens")
      .select("client_id, token_data")
      .eq("platform", "slack"),
    supabaseAdmin.from("clients").select("id, name, company, email"),
  ]);

  const clientById = new Map((clients ?? []).map((c) => [c.id, c]));
  const teamToClient = new Map(
    (tokens ?? []).map((t) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const td = t.token_data as any;
      return [td?.team_id as string, t.client_id as string];
    })
  );

  const total = (lookups ?? []).length;
  const found = (lookups ?? []).filter((l) => l.status === "found").length;
  const errors = (lookups ?? []).filter((l) => l.status === "error").length;
  const notFound = (lookups ?? []).filter((l) => l.status === "not_found").length;
  const unmapped = (lookups ?? []).filter((l) => !l.client_id).length;

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1>🏠 Mark · Lookups</h1>
          <span className="client-email">Last 100 /sqft invocations across all clients</span>
        </div>
      </div>

      <div className="admin-stat-row">
        <div className="admin-stat"><div className="asn">{total}</div><div className="asl">Total</div></div>
        <div className="admin-stat"><div className="asn" style={{ color: "var(--sage)" }}>{found}</div><div className="asl">Found</div></div>
        <div className="admin-stat"><div className="asn" style={{ color: "var(--gold, #C9A961)" }}>{notFound}</div><div className="asl">Not found</div></div>
        <div className="admin-stat"><div className="asn" style={{ color: "var(--red)" }}>{errors}</div><div className="asl">Errors</div></div>
        {unmapped > 0 && (
          <div className="admin-stat" style={{ borderColor: "var(--red)" }}>
            <div className="asn" style={{ color: "var(--red)" }}>{unmapped}</div>
            <div className="asl">Unmapped (no client)</div>
          </div>
        )}
      </div>

      {(lookups ?? []).length === 0 ? (
        <div className="admin-card" style={{ marginTop: 24 }}>
          <div className="admin-empty" style={{ padding: 24 }}>
            No /sqft lookups yet. If you just ran one and it&apos;s not here, check Vercel logs for{" "}
            <code style={{ fontFamily: "var(--mono)" }}>[slack /sqft]</code> — likely a signature-verification failure
            (wrong SLACK_SIGNING_SECRET).
          </div>
        </div>
      ) : (
        <div className="admin-card" style={{ marginTop: 24, padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg-mute, rgba(28,30,27,0.04))", textAlign: "left" }}>
                <th style={{ padding: "10px 12px", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Time</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Client</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Address</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Result</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Status / Error</th>
              </tr>
            </thead>
            <tbody>
              {(lookups ?? []).map((l) => {
                const client = l.client_id ? clientById.get(l.client_id) : null;
                const teamMapped = l.slack_team_id ? teamToClient.has(l.slack_team_id) : false;
                return (
                  <tr key={l.id} style={{ borderTop: "1px solid rgba(28,30,27,0.06)" }}>
                    <td style={{ padding: "10px 12px", fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mute)", whiteSpace: "nowrap" }}>
                      {new Date(l.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {client ? (
                        <a href={`/clients/${client.id}`} className="at-link">{client.company || client.name || client.email || client.id.slice(0, 8)}</a>
                      ) : (
                        <span style={{ color: "var(--red)", fontFamily: "var(--mono)", fontSize: 11 }}>
                          unmapped team {l.slack_team_id?.slice(0, 8)}{teamMapped ? "" : " (no token)"}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{l.input_address}</div>
                      {l.normalized && l.normalized !== l.input_address && (
                        <div style={{ fontSize: 11, color: "var(--text-mute)", fontFamily: "var(--mono)", marginTop: 2 }}>→ {l.normalized}</div>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px", fontSize: 12 }}>
                      {l.status === "found" ? (
                        <>
                          <strong>{l.sqft?.toLocaleString() ?? "—"} sqft</strong>
                          <div style={{ fontSize: 11, color: "var(--text-mute)" }}>
                            {l.beds != null && `${l.beds} bd · `}
                            {l.baths != null && `${l.baths} ba · `}
                            {l.year_built && `built ${l.year_built}`}
                          </div>
                        </>
                      ) : (
                        <span style={{ color: "var(--text-mute)" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span
                        className={`status-chip ${l.status === "found" ? "active" : "paused"}`}
                        style={{ color: l.status === "found" ? "var(--sage)" : l.status === "error" ? "var(--red)" : "var(--gold, #C9A961)" }}
                      >
                        {l.status}
                      </span>
                      {l.error && (
                        <div style={{ fontSize: 11, color: "var(--red)", fontFamily: "var(--mono)", marginTop: 4, maxWidth: 340 }}>
                          {l.error}
                        </div>
                      )}
                    </td>
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
