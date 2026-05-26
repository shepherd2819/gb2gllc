import { supabaseAdmin } from "@/lib/supabase";

export default async function SubmissionsPage() {
  // Only show actually-submitted intakes here. The intake_sessions table also
  // holds in-progress + abandoned rows (every /intake page-load creates one
  // so the multi-step form has somewhere to save state); those are noise on
  // this view.
  const { data: sessions } = await supabaseAdmin
    .from("intake_sessions")
    .select("id, state, submitted_at, notion_page_id, source")
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false });

  return (
    <>
      <div className="admin-page-header">
        <h1>Submissions</h1>
        <span className="admin-count">{sessions?.length ?? 0} total</span>
      </div>

      <div className="admin-table">
        <div className="at-head" style={{ gridTemplateColumns: "1.5fr 2fr 1fr 0.8fr 0.8fr 100px" }}>
          <span>Company / Name</span>
          <span>Email</span>
          <span>Source</span>
          <span>Notion</span>
          <span>Submitted</span>
          <span></span>
        </div>

        {(sessions ?? []).length === 0 && (
          <div style={{ padding: "24px 16px", color: "var(--text-mute)", fontSize: 13 }}>No submissions yet.</div>
        )}

        {(sessions ?? []).map((s) => {
          const contact = (s.state as Record<string, Record<string, string>>)?.contact ?? {};
          const displayName = contact.company || contact.name || "—";
          return (
            <div key={s.id} className="at-row" style={{ gridTemplateColumns: "1.5fr 2fr 1fr 0.8fr 0.8fr 100px" }}>
              <span className="at-company">{displayName}</span>
              <span className="at-email">{contact.email || "—"}</span>
              <span className="at-email">{s.source || "web"}</span>
              <span>
                <span className={`alr-badge ${s.notion_page_id ? "ok" : "warn"}`}>
                  {s.notion_page_id ? "Synced" : "Pending"}
                </span>
              </span>
              <span className="at-date">
                {s.submitted_at
                  ? new Date(s.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })
                  : "—"}
              </span>
              <span>
                <a href={`/submissions/${s.id}`} className="at-link">View →</a>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
