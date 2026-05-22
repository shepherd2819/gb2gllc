import { supabaseAdmin } from "@/lib/supabase";
import { notFound } from "next/navigation";
import { SubmissionActions } from "./SubmissionActions";

type Params = { params: Promise<{ id: string }> };

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="sub-field">
      <span className="sub-label">{label}</span>
      <span className="sub-value">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="admin-card sub-section">
      <h2 className="admin-card-title">{title}</h2>
      {children}
    </div>
  );
}

export default async function SubmissionDetailPage({ params }: Params) {
  const { id } = await params;

  const { data: session } = await supabaseAdmin
    .from("intake_sessions")
    .select("*, intake_files(name, size, storage_path)")
    .eq("id", id)
    .single();

  if (!session) notFound();

  // Check if already a client
  const state = session.state as Record<string, Record<string, unknown>>;
  const contact = (state.contact ?? {}) as Record<string, string>;
  const about = (state.about ?? {}) as Record<string, string>;
  const goals = (state.goals ?? {}) as { selected?: string[] };
  const software = (state.software ?? {}) as { selected?: string[]; other?: string };
  const tasks = (state.tasks as unknown as { name?: string; frequency?: string; desc?: string }[]) ?? [];
  const sops = (state.sops ?? {}) as { text?: string; links?: string };
  const access = (state.access ?? {}) as Record<string, { connected?: boolean; access?: string }>;
  const schedule = (state.schedule ?? {}) as { slot?: string };

  const { data: existingClient } = await supabaseAdmin
    .from("clients")
    .select("id, name")
    .eq("email", contact.email ?? "")
    .single();

  const slotLabel = schedule.slot
    ? new Date(parseInt(schedule.slot)).toLocaleString("en-US", {
        weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    : null;

  const notionUrl = session.notion_page_id
    ? `https://notion.so/${session.notion_page_id.replace(/-/g, "")}`
    : null;

  return (
    <>
      <div className="admin-page-header">
        <div>
          <a href="/submissions" className="back-link">← All submissions</a>
          <h1>{contact.company || contact.name || "Unknown submission"}</h1>
          <span className="client-email">{contact.email || session.id}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <span className={`alr-badge ${session.notion_page_id ? "ok" : "warn"}`}>
            {session.notion_page_id ? "In Notion" : "Not synced"}
          </span>
          {session.submitted_at && (
            <span className="at-date">
              {new Date(session.submitted_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </span>
          )}
          {existingClient && (
            <a href={`/clients/${existingClient.id}`} className="at-link">
              Already a client: {existingClient.name || contact.email} →
            </a>
          )}
        </div>
      </div>

      <SubmissionActions sessionId={session.id} notionUrl={notionUrl} />

      <div className="admin-two-col" style={{ marginTop: 16 }}>
        <div className="admin-col-stack">

          <Section title="Contact">
            <Field label="Name" value={contact.name} />
            <Field label="Email" value={contact.email} />
            <Field label="Company" value={contact.company} />
            <Field label="Website" value={contact.website} />
          </Section>

          <Section title="About their business">
            <Field label="Role" value={about.role} />
            <Field label="Team size" value={about.teamSize} />
            <Field label="Industry" value={about.industry} />
            <Field label="Urgency" value={about.urgency} />
            {(goals.selected ?? []).length > 0 && (
              <div className="sub-field">
                <span className="sub-label">Goals</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {(goals.selected ?? []).map(g => (
                    <span key={g} className="prod-chip herald">{g}</span>
                  ))}
                </div>
              </div>
            )}
          </Section>

          <Section title="Top tasks to automate">
            {tasks.filter(t => t.name).length === 0
              ? <div className="admin-empty">None provided</div>
              : tasks.filter(t => t.name).map((t, i) => (
                  <div key={i} className="sub-task-row">
                    <span className="sub-task-name">{t.name}</span>
                    {t.frequency && <span className="sub-task-meta">{t.frequency}</span>}
                    {t.desc && <p className="sub-task-desc">{t.desc}</p>}
                  </div>
                ))
            }
          </Section>

          <Section title="Kickoff call">
            <Field label="Selected time" value={slotLabel ?? "Not scheduled"} />
          </Section>

        </div>

        <div className="admin-col-stack">

          <Section title="Software stack">
            {(software.selected ?? []).length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: software.other ? 10 : 0 }}>
                {(software.selected ?? []).map(s => (
                  <span key={s} className="prod-chip atrium">{s}</span>
                ))}
              </div>
            ) : <div className="admin-empty">None listed</div>}
            {software.other && <Field label="Other" value={software.other} />}
          </Section>

          <Section title="Platform access">
            {Object.keys(access).length === 0
              ? <div className="admin-empty">No platforms listed</div>
              : Object.entries(access).map(([platform, info]) => (
                  <div key={platform} className="sub-field">
                    <span className="sub-label">{platform}</span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span className={`alr-badge ${info.connected ? "ok" : "warn"}`}>
                        {info.connected ? "Connected" : "Not connected"}
                      </span>
                      {info.access && <span style={{ fontSize: 11, color: "var(--text-mute)" }}>{info.access}</span>}
                    </div>
                  </div>
                ))
            }
          </Section>

          <Section title="SOPs & Docs">
            {sops.text && (
              <div style={{ marginBottom: 12 }}>
                <div className="sub-label" style={{ marginBottom: 4 }}>Pasted text</div>
                <div className="sub-sop-text">{sops.text}</div>
              </div>
            )}
            {sops.links && <Field label="Links" value={sops.links} />}
            {(session.intake_files as { name: string; size: number; storage_path: string }[] ?? []).length > 0 ? (
              <div style={{ marginTop: sops.text || sops.links ? 12 : 0 }}>
                <div className="sub-label" style={{ marginBottom: 6 }}>Uploaded files</div>
                {(session.intake_files as { name: string; size: number; storage_path: string }[]).map((f, i) => (
                  <div key={i} className="sub-file-row">
                    <span>{f.name}</span>
                    <span className="at-date">{(f.size / 1024).toFixed(0)} KB</span>
                  </div>
                ))}
              </div>
            ) : (
              !sops.text && !sops.links && <div className="admin-empty">No SOPs or docs provided</div>
            )}
          </Section>

        </div>
      </div>
    </>
  );
}
