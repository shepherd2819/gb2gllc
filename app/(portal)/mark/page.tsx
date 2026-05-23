import { withAuth } from "@workos-inc/authkit-nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { redirect } from "next/navigation";

export default async function MarkPage() {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/mark");

  const { data: client } = await supabaseAdmin
    .from("clients").select("id, name, company").eq("workos_user_id", user.id).single();
  if (!client) redirect("/auth/no-account");

  // Only show this page if the client actually has Mark assigned
  const { data: hasMark } = await supabaseAdmin
    .from("client_steward_assignments")
    .select("id")
    .eq("client_id", client.id)
    .eq("preset_id", "mark_sqft")
    .eq("active", true)
    .maybeSingle();

  if (!hasMark) redirect("/dashboard");

  const { data: lookups } = await supabaseAdmin
    .from("mark_lookups")
    .select("*")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const { data: token } = await supabaseAdmin
    .from("steward_platform_tokens")
    .select("token_data")
    .eq("client_id", client.id)
    .eq("platform", "slack")
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slackInstalled = !!(token?.token_data as any)?.access_token;

  const found = (lookups ?? []).filter((l) => l.status === "found").length;
  const total = (lookups ?? []).length;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">🏠 Mark</h1>
        <p className="page-sub">Real-estate square-footage lookup agent. Lives in Slack.</p>
      </div>

      {!slackInstalled ? (
        <div className="conn-cta" style={{ marginTop: 0 }}>
          <p>Mark needs to be installed in your Slack workspace before he can look up properties.</p>
          <a href="/api/slack/install" className="btn-portal-ghost">Install Mark in Slack →</a>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card stat-hero">
              <div className="stat-num">{total}</div>
              <div className="stat-label">lookups</div>
              <div className="stat-sub">{found} found · {total - found} not found</div>
            </div>
            <div className="stat-card">
              <div className="stat-num" style={{ fontSize: 18, lineHeight: 1.3, fontFamily: "var(--mono, monospace)" }}>/sqft</div>
              <div className="stat-label">slash command</div>
              <div className="stat-sub">Run in any channel Mark&apos;s invited to</div>
            </div>
          </div>

          <section style={{ marginTop: 24 }}>
            <h2 className="section-title">Recent lookups</h2>
            {(lookups ?? []).length === 0 ? (
              <p className="empty-state">
                No lookups yet. In Slack, try <code style={{ fontFamily: "var(--mono, monospace)" }}>/sqft 4529 Winona Ct, Denver CO 80212</code>
              </p>
            ) : (
              <div className="connection-list">
                {(lookups ?? []).map((l) => (
                  <div key={l.id} className={`connection-row ${l.status === "found" ? "granted" : "pending"}`}>
                    <div className="connection-name" style={{ fontFamily: "var(--mono, monospace)", fontSize: 13 }}>
                      {l.normalized || l.input_address}
                    </div>
                    <div className="connection-status">
                      {l.status === "found" ? (
                        <>
                          {l.sqft && <span className="conn-method">{l.sqft.toLocaleString()} sqft</span>}
                          {l.beds != null && <span className="conn-method">{l.beds} bd</span>}
                          {l.baths != null && <span className="conn-method">{l.baths} ba</span>}
                          {l.year_built && <span className="conn-method">built {l.year_built}</span>}
                        </>
                      ) : (
                        <span className={`conn-badge ${l.status === "not_found" ? "pending" : "pending"}`}>
                          {l.status === "not_found" ? "Not found" : "Error"}
                        </span>
                      )}
                    </div>
                    <div className="conn-notes" style={{ fontFamily: "var(--mono, monospace)", fontSize: 11 }}>
                      {new Date(l.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      {l.error && ` · ${l.error}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
