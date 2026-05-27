"use client";
import { useState } from "react";

type Campaign = {
  id: string;
  name: string;
  status: string;
  briefing_text: string | null;
  briefing_pdf: string | null;
  briefing_pdf_filename: string | null;
  sender_email: string;
  sender_name: string;
  daily_send_cap: number;
};

type Lead = {
  id: string;
  campaign_id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  website: string | null;
  notes: string | null;
  status: "pending" | "researched" | "drafted" | "approved" | "sent" | "rejected" | "failed" | "skipped";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enrichment: any;
  draft_subject: string | null;
  draft_body: string | null;
  edited_subject: string | null;
  edited_body: string | null;
  rejected_reason: string | null;
  send_error: string | null;
  sent_at: string | null;
  drafted_at: string | null;
  created_at: string;
};

export function AveryCampaignDetail({
  campaign,
  initialLeads,
  sentTodayCount,
}: {
  campaign: Campaign;
  initialLeads: Lead[];
  sentTodayCount: number;
}) {
  const [c, setC] = useState(campaign);
  const [cfg, setCfg] = useState({
    name: campaign.name,
    briefing_text: campaign.briefing_text ?? "",
    sender_name: campaign.sender_name,
    sender_email: campaign.sender_email,
    daily_send_cap: campaign.daily_send_cap,
    status: campaign.status,
  });
  const [leads, setLeads] = useState(initialLeads);
  const [sentToday, setSentToday] = useState(sentTodayCount);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importingPdf, setImportingPdf] = useState(false);

  const dirty =
    cfg.name !== c.name ||
    cfg.briefing_text !== (c.briefing_text ?? "") ||
    cfg.sender_name !== c.sender_name ||
    cfg.sender_email !== c.sender_email ||
    cfg.daily_send_cap !== c.daily_send_cap ||
    cfg.status !== c.status;

  function flash(text: string, tone: "ok" | "err") {
    setMsg({ text, tone });
    setTimeout(() => setMsg(null), 4000);
  }

  async function saveCampaign() {
    setSavingCampaign(true);
    const res = await fetch(`/api/admin/avery/campaigns/${c.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    setSavingCampaign(false);
    if (res.ok) {
      setC({ ...c, ...cfg });
      flash("Saved", "ok");
    } else flash("Save failed", "err");
  }
  function resetCfg() {
    setCfg({
      name: c.name,
      briefing_text: c.briefing_text ?? "",
      sender_name: c.sender_name,
      sender_email: c.sender_email,
      daily_send_cap: c.daily_send_cap,
      status: c.status,
    });
  }

  async function uploadPdf(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/admin/avery/campaigns/${c.id}/briefing-pdf`, { method: "POST", body: fd });
    const data = await res.json();
    if (res.ok) {
      setC({ ...c, briefing_pdf: "<<loaded>>", briefing_pdf_filename: data.filename });
      flash(`Extracted ${data.chars} chars from ${data.pages} pages`, "ok");
    } else flash(data.error || "PDF upload failed", "err");
  }

  async function removePdf() {
    const res = await fetch(`/api/admin/avery/campaigns/${c.id}/briefing-pdf`, { method: "DELETE" });
    if (res.ok) {
      setC({ ...c, briefing_pdf: null, briefing_pdf_filename: null });
      flash("PDF removed", "ok");
    }
  }

  async function uploadCsv() {
    if (!csvText.trim()) return;
    const res = await fetch(`/api/admin/avery/campaigns/${c.id}/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: csvText }),
    });
    const data = await res.json();
    if (res.ok) {
      flash(`Added ${data.inserted} leads`, "ok");
      window.location.reload();
    } else flash(data.error || "Upload failed", "err");
  }

  async function importLeadsPdf(file: File) {
    setImportingPdf(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`/api/admin/avery/campaigns/${c.id}/leads-pdf`, { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) {
        flash(`Imported ${data.inserted} leads from ${data.filename}`, "ok");
        setTimeout(() => window.location.reload(), 800);
      } else flash(data.error || "PDF import failed", "err");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Upload failed", "err");
    } finally {
      setImportingPdf(false);
    }
  }

  async function leadAction(leadId: string, body: object) {
    setBusyId(leadId);
    const res = await fetch(`/api/admin/avery/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusyId(null);
    return { res, data };
  }

  async function research(lead: Lead) {
    const { res, data } = await leadAction(lead.id, { action: "research" });
    if (res.ok) {
      setLeads((arr) => arr.map((l) => l.id === lead.id ? { ...l, status: "researched", enrichment: data.enrichment } : l));
    } else flash(data.error || "Research failed", "err");
  }

  async function draft(lead: Lead) {
    const { res, data } = await leadAction(lead.id, { action: "draft" });
    if (res.ok) {
      setLeads((arr) => arr.map((l) => l.id === lead.id ? { ...l, status: "drafted", draft_subject: data.subject, draft_body: data.body } : l));
    } else flash(data.error || "Draft failed", "err");
  }

  async function approveSend(lead: Lead) {
    const { res, data } = await leadAction(lead.id, { action: "approve_and_send" });
    if (res.ok) {
      setLeads((arr) => arr.map((l) => l.id === lead.id ? { ...l, status: "sent", sent_at: new Date().toISOString() } : l));
      setSentToday((n) => n + 1);
      flash("Sent", "ok");
    } else flash(data.error || "Send failed", "err");
  }

  async function rejectLead(lead: Lead) {
    if (!confirm("Reject this lead?")) return;
    const { res } = await leadAction(lead.id, { action: "reject" });
    if (res.ok) setLeads((arr) => arr.map((l) => l.id === lead.id ? { ...l, status: "rejected" } : l));
  }

  async function saveEdit(leadId: string) {
    const { res } = await leadAction(leadId, { edited_subject: editSubject, edited_body: editBody });
    if (res.ok) {
      setLeads((arr) => arr.map((l) => l.id === leadId ? { ...l, edited_subject: editSubject, edited_body: editBody } : l));
      setEditing(null);
      flash("Saved edit", "ok");
    } else flash("Save failed", "err");
  }

  const pending = leads.filter((l) => l.status === "pending");
  const researched = leads.filter((l) => l.status === "researched");
  const drafted = leads.filter((l) => l.status === "drafted" || l.status === "approved");
  const sent = leads.filter((l) => l.status === "sent");
  const other = leads.filter((l) => ["rejected", "failed", "skipped"].includes(l.status));
  const remainingToday = Math.max(0, c.daily_send_cap - sentToday);

  return (
    <>
      <div className="admin-page-header">
        <div>
          <a href="/agents/avery" className="back-link">← All campaigns</a>
          <h1>{c.name}</h1>
          <span className="client-email">From {c.sender_name} &lt;{c.sender_email}&gt;</span>
        </div>
        <span className={`status-chip large ${c.status === "active" ? "active" : "paused"}`}>{c.status}</span>
      </div>

      <div className="admin-stat-row">
        <div className="admin-stat"><div className="asn">{leads.length}</div><div className="asl">Leads total</div></div>
        <div className="admin-stat"><div className="asn" style={{ color: "var(--sage)" }}>{sent.length}</div><div className="asl">Sent</div></div>
        <div className="admin-stat"><div className="asn">{drafted.length}</div><div className="asl">Awaiting approval</div></div>
        <div className="admin-stat"><div className="asn" style={{ color: "var(--gold, #C9A961)" }}>{sentToday} / {c.daily_send_cap}</div><div className="asl">Sent today</div></div>
        <div className="admin-stat"><div className="asn">{remainingToday}</div><div className="asl">Remaining today</div></div>
      </div>

      {msg && (
        <div style={{
          padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16,
          background: msg.tone === "ok" ? "rgba(106,142,99,0.10)" : "rgba(196,82,75,0.10)",
          color: msg.tone === "ok" ? "var(--sage)" : "var(--red)",
          border: `1px solid ${msg.tone === "ok" ? "rgba(106,142,99,0.30)" : "rgba(196,82,75,0.30)"}`,
        }}>{msg.text}</div>
      )}

      <div className="admin-two-col">
        <div className="admin-col-stack">

          {/* ── Briefing card ─────────────────────────────────────────── */}
          <div className="admin-card">
            <div className="admin-card-head">
              <h2>Briefing</h2>
              {dirty && (
                <span style={{ fontSize: 11, color: "var(--gold, #C9A961)", fontFamily: "var(--mono)", letterSpacing: 0.04 }}>
                  Unsaved changes
                </span>
              )}
            </div>

            <div className="admin-input-row">
              <label>Campaign name</label>
              <input
                className="admin-input"
                style={{ marginBottom: 0 }}
                value={cfg.name}
                onChange={(e) => setCfg({ ...cfg, name: e.target.value })}
              />
            </div>

            <div className="admin-input-row" style={{ marginTop: 12 }}>
              <label>Briefing text <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(what you want Avery to pitch)</span></label>
              <textarea
                className="admin-textarea"
                rows={8}
                placeholder="e.g. We sell AI agents for small real-estate media studios. Sweet spot: 1-15 person teams running into bottlenecks on scheduling + scope creep. Mention Mark (sqft lookup) + Maya (DM responder) as concrete examples. Soft CTA: 20-min call to talk through their specific bottlenecks."
                value={cfg.briefing_text}
                onChange={(e) => setCfg({ ...cfg, briefing_text: e.target.value })}
              />
            </div>

            <div className="admin-input-row" style={{ marginTop: 12 }}>
              <label>Supporting PDF <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(optional — saves immediately)</span></label>
              {c.briefing_pdf_filename ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>📄 {c.briefing_pdf_filename}</span>
                  <button className="admin-btn-ghost admin-btn-sm" style={{ color: "var(--red)" }} onClick={removePdf}>Remove</button>
                </div>
              ) : (
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPdf(f); }}
                  style={{ fontSize: 13 }}
                />
              )}
            </div>

            <div className="admin-input-row" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div>
                <label>From name</label>
                <input
                  className="admin-input"
                  value={cfg.sender_name}
                  onChange={(e) => setCfg({ ...cfg, sender_name: e.target.value })}
                  style={{ marginBottom: 0 }}
                />
              </div>
              <div>
                <label>From email</label>
                <input
                  className="admin-input"
                  value={cfg.sender_email}
                  onChange={(e) => setCfg({ ...cfg, sender_email: e.target.value })}
                  style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }}
                />
              </div>
              <div>
                <label>Daily cap</label>
                <input
                  className="admin-input"
                  type="number"
                  min={1}
                  max={100}
                  value={cfg.daily_send_cap}
                  onChange={(e) => setCfg({ ...cfg, daily_send_cap: parseInt(e.target.value, 10) || 1 })}
                  style={{ marginBottom: 0, fontFamily: "var(--mono)" }}
                />
              </div>
            </div>

            <div className="admin-input-row" style={{ marginTop: 12 }}>
              <label>Status</label>
              <select
                className="admin-select"
                value={cfg.status}
                onChange={(e) => setCfg({ ...cfg, status: e.target.value })}
                style={{ marginBottom: 0 }}
              >
                <option value="active">Active — sends allowed</option>
                <option value="paused">Paused — drafts only, no sending</option>
                <option value="done">Done — closed out</option>
              </select>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
              <button
                className="admin-btn admin-btn-sm"
                onClick={saveCampaign}
                disabled={savingCampaign || !dirty}
                title={!dirty ? "No changes to save" : ""}
              >
                {savingCampaign ? "Saving…" : "Save changes"}
              </button>
              {dirty && !savingCampaign && (
                <button className="admin-btn-ghost admin-btn-sm" onClick={resetCfg}>
                  Discard
                </button>
              )}
            </div>
          </div>

          {/* ── Lead upload ───────────────────────────────────────────── */}
          <div className="admin-card">
            <div className="admin-card-head"><h2>Add leads</h2></div>

            {/* PDF import (Claude parses the doc into structured leads) */}
            <div style={{ padding: 14, border: "1px dashed var(--rule, rgba(28,30,27,0.18))", borderRadius: 10, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>📄 Upload a PDF list</div>
              <div style={{ fontSize: 12, color: "var(--text-mute)", marginBottom: 10 }}>
                Avery will scan the PDF, pull out every contact (name, email, company, website, notes), and add them as leads. Works on tables, paragraphs, or business-card scans. ~10-30 sec depending on length.
              </div>
              {importingPdf ? (
                <div style={{ fontSize: 12, color: "var(--gold, #C9A961)", fontFamily: "var(--mono)" }}>
                  Scanning PDF and pulling leads… (this can take up to 30s)
                </div>
              ) : (
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) importLeadsPdf(f); e.currentTarget.value = ""; }}
                  style={{ fontSize: 13 }}
                />
              )}
            </div>

            {/* CSV paste fallback */}
            {!pasteOpen ? (
              <button className="admin-btn-ghost admin-btn-sm" onClick={() => setPasteOpen(true)}>+ Paste CSV instead</button>
            ) : (
              <>
                <div className="admin-input-row" style={{ marginBottom: 8 }}>
                  <label>CSV with header row <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(name, email, company, website, notes)</span></label>
                  <textarea
                    className="admin-textarea"
                    rows={8}
                    placeholder={"name,email,company,website,notes\nSarah Chen,sarah@example.com,Acme Co,acme.com,met at conf"}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="admin-btn admin-btn-sm" onClick={uploadCsv} disabled={!csvText.trim()}>Upload</button>
                  <button className="admin-btn-ghost admin-btn-sm" onClick={() => { setPasteOpen(false); setCsvText(""); }}>Cancel</button>
                </div>
              </>
            )}
          </div>

          {/* ── Pending review ───────────────────────────────────────── */}
          {drafted.length > 0 && (
            <div className="admin-card">
              <div className="admin-card-head"><h2>Pending approval · {drafted.length}</h2></div>
              {drafted.map((lead) => (
                <div key={lead.id} style={{ padding: 14, border: "1px solid var(--rule, rgba(28,30,27,0.1))", borderRadius: 8, marginBottom: 10, background: "var(--bg-mute, rgba(28,30,27,0.03))" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, gap: 12 }}>
                    <span style={{ fontWeight: 500 }}>
                      {lead.name || lead.company || lead.email || lead.website}
                      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mute)", marginLeft: 8 }}>{lead.email}</span>
                    </span>
                    {lead.enrichment?.contact_form_url && (
                      <a href={lead.enrichment.contact_form_url} target="_blank" rel="noopener noreferrer" className="at-link" style={{ fontSize: 11 }}>
                        Contact form ↗
                      </a>
                    )}
                  </div>

                  {editing === lead.id ? (
                    <>
                      <input
                        className="admin-input"
                        style={{ marginBottom: 8, fontWeight: 500 }}
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                        placeholder="Subject"
                      />
                      <textarea
                        className="admin-textarea"
                        rows={8}
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                      />
                    </>
                  ) : (
                    <>
                      <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 6 }}>
                        Subject: {lead.edited_subject ?? lead.draft_subject}
                      </div>
                      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--sans, inherit)", fontSize: 13, lineHeight: 1.55, margin: 0 }}>
                        {lead.edited_body ?? lead.draft_body}
                      </pre>
                    </>
                  )}

                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    {editing === lead.id ? (
                      <>
                        <button className="admin-btn admin-btn-sm" onClick={() => saveEdit(lead.id)}>Save edit</button>
                        <button className="admin-btn-ghost admin-btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          className="admin-btn admin-btn-sm"
                          onClick={() => approveSend(lead)}
                          disabled={busyId === lead.id || remainingToday <= 0 || c.status !== "active"}
                          title={remainingToday <= 0 ? "Daily cap reached" : c.status !== "active" ? "Campaign not active" : ""}
                        >
                          {busyId === lead.id ? "Sending…" : "Approve + send"}
                        </button>
                        <button
                          className="admin-btn-ghost admin-btn-sm"
                          onClick={() => {
                            setEditing(lead.id);
                            setEditSubject(lead.edited_subject ?? lead.draft_subject ?? "");
                            setEditBody(lead.edited_body ?? lead.draft_body ?? "");
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="admin-btn-ghost admin-btn-sm"
                          onClick={() => draft(lead)}
                          disabled={busyId === lead.id}
                          title="Generate a new draft (replaces current)"
                        >
                          Redraft
                        </button>
                        <button
                          className="admin-btn-ghost admin-btn-sm"
                          style={{ color: "var(--red)", borderColor: "rgba(196,82,75,0.4)" }}
                          onClick={() => rejectLead(lead)}
                          disabled={busyId === lead.id}
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Lead queue ───────────────────────────────────────────── */}
          {(pending.length > 0 || researched.length > 0) && (
            <div className="admin-card">
              <div className="admin-card-head"><h2>Lead queue · {pending.length + researched.length}</h2></div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-mute)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    <th style={{ padding: "6px 8px" }}>Lead</th>
                    <th style={{ padding: "6px 8px" }}>Email</th>
                    <th style={{ padding: "6px 8px" }}>Website</th>
                    <th style={{ padding: "6px 8px" }}>Status</th>
                    <th style={{ padding: "6px 8px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {[...pending, ...researched].map((lead) => (
                    <tr key={lead.id} style={{ borderTop: "1px solid rgba(28,30,27,0.06)" }}>
                      <td style={{ padding: "8px" }}>{lead.name || lead.company || "—"}</td>
                      <td style={{ padding: "8px", fontFamily: "var(--mono)", fontSize: 11 }}>{lead.email || "—"}</td>
                      <td style={{ padding: "8px", fontFamily: "var(--mono)", fontSize: 11 }}>{lead.website || "—"}</td>
                      <td style={{ padding: "8px" }}>
                        <span className="status-chip paused" style={{ color: lead.status === "researched" ? "var(--gold, #C9A961)" : "var(--text-mute)" }}>
                          {lead.status}
                        </span>
                      </td>
                      <td style={{ padding: "8px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {lead.status === "pending" && lead.website && (
                          <button className="admin-btn-ghost admin-btn-sm" onClick={() => research(lead)} disabled={busyId === lead.id}>
                            {busyId === lead.id ? "…" : "Research"}
                          </button>
                        )}
                        {lead.status === "researched" && (
                          <button className="admin-btn admin-btn-sm" onClick={() => draft(lead)} disabled={busyId === lead.id}>
                            {busyId === lead.id ? "Drafting…" : "Draft email"}
                          </button>
                        )}
                        {lead.status === "pending" && !lead.website && lead.email && (
                          <button className="admin-btn admin-btn-sm" onClick={() => draft(lead)} disabled={busyId === lead.id}>
                            Draft email
                          </button>
                        )}
                        <button className="admin-btn-ghost admin-btn-sm" style={{ color: "var(--red)" }} onClick={() => rejectLead(lead)}>Skip</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Sent log ─────────────────────────────────────────────── */}
          {sent.length > 0 && (
            <div className="admin-card">
              <div className="admin-card-head"><h2>Sent · {sent.length}</h2></div>
              {sent.slice(0, 15).map((lead) => (
                <div key={lead.id} style={{ padding: 10, borderBottom: "1px solid var(--rule, rgba(28,30,27,0.06))", fontSize: 13, display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>{lead.name || lead.company} <span style={{ color: "var(--text-mute)", fontFamily: "var(--mono)", fontSize: 11, marginLeft: 8 }}>{lead.email}</span></span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mute)" }}>
                    {lead.sent_at ? new Date(lead.sent_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                  </span>
                </div>
              ))}
            </div>
          )}

          {other.length > 0 && (
            <details>
              <summary style={{ cursor: "pointer", padding: "8px 0", fontSize: 13, color: "var(--text-mute)", fontFamily: "var(--mono)", letterSpacing: "0.04em" }}>
                Rejected / failed / skipped · {other.length}
              </summary>
              <div className="admin-card" style={{ marginTop: 6 }}>
                {other.map((l) => (
                  <div key={l.id} style={{ padding: 10, borderBottom: "1px solid var(--rule, rgba(28,30,27,0.06))", fontSize: 13 }}>
                    <div>{l.name || l.company} <span style={{ color: "var(--text-mute)", fontFamily: "var(--mono)", fontSize: 11, marginLeft: 6 }}>{l.email}</span> · <span className="status-chip paused" style={{ color: "var(--red)" }}>{l.status}</span></div>
                    {l.rejected_reason && <div style={{ fontSize: 11, color: "var(--text-mute)", marginTop: 2 }}>{l.rejected_reason}</div>}
                    {l.send_error && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 2 }}>{l.send_error}</div>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        <div></div>
      </div>
    </>
  );
}
