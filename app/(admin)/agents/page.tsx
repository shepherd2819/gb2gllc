import Link from "next/link";
import { GROUPED_AGENTS } from "./agents-manifest";

export const dynamic = "force-dynamic";

export default function AgentsOverviewPage() {
  return (
    <>
      <div className="admin-page-header" style={{ marginBottom: 28 }}>
        <div>
          <h1 style={{ margin: 0 }}>Agents</h1>
          <span className="client-email">
            Internal + client-facing agents. Live status in the left rail.
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gap: 24 }}>
        {GROUPED_AGENTS.map((group) => (
          <section key={group.group}>
            <h2 style={{ margin: "0 0 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-mute)", fontWeight: 500, fontFamily: "var(--mono)" }}>
              {group.label}
            </h2>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
              {group.agents.map((a) => (
                <Link
                  key={a.slug}
                  href={`/agents/${a.slug}`}
                  className="admin-card"
                  style={{ padding: 18, display: "block", textDecoration: "none", color: "var(--text)", transition: "transform .12s, border-color .12s" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, background: "var(--bg-3)", fontFamily: "var(--mono)", fontSize: 18, color: "var(--text-soft)" }}>
                      {a.glyph}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{a.name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-soft)", marginTop: 2 }}>{a.tagline}</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
