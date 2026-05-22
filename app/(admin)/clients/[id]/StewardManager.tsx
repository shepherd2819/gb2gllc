"use client";
import { useState } from "react";

type Platform = { id: string; display_name: string; icon: string; description: string };

type Assignment = {
  id: string;
  platform_agent_id: string;
  mission: string;
  active: boolean;
  schedule: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
  steward_platform_agents: Platform;
};

export function StewardManager({
  clientId,
  initialAssignments,
  platforms,
  connectedPlatforms: initialConnected,
}: {
  clientId: string;
  initialAssignments: Assignment[];
  platforms: Platform[];
  connectedPlatforms: string[];
}) {
  const [assignments, setAssignments]     = useState(initialAssignments);
  const [connected, setConnected]         = useState<Set<string>>(new Set(initialConnected));
  const [showForm, setShowForm]           = useState(false);
  const [platformId, setPlatformId]       = useState("");
  const [mission, setMission]             = useState("");
  const [schedule, setSchedule]           = useState("");
  const [saving, setSaving]               = useState(false);
  const [togglingId, setTogglingId]       = useState<string | null>(null);
  const [deletingId, setDeletingId]       = useState<string | null>(null);
  const [confirmId, setConfirmId]         = useState<string | null>(null);
  const [runningId, setRunningId]         = useState<string | null>(null);
  const [runMsg, setRunMsg]               = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [connectingFor, setConnectingFor] = useState<string | null>(null); // platform_agent_id
  const [apiKey, setApiKey]               = useState("");
  const [connecting, setConnecting]       = useState(false);
  const [err, setErr]                     = useState("");

  async function handleAdd() {
    if (!platformId || !mission.trim()) { setErr("Select a platform and describe the mission."); return; }
    setSaving(true); setErr("");
    const res = await fetch("/api/admin/steward/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, platformAgentId: platformId, mission, schedule }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setErr(data.error || "Error saving"); return; }
    setAssignments(prev => [...prev, data]);
    setPlatformId(""); setMission(""); setSchedule(""); setShowForm(false);
  }

  async function handleToggle(id: string, current: boolean) {
    setTogglingId(id);
    const res = await fetch(`/api/admin/steward/assignments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !current }),
    });
    if (res.ok) setAssignments(prev => prev.map(a => a.id === id ? { ...a, active: !current } : a));
    setTogglingId(null);
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const res = await fetch(`/api/admin/steward/assignments/${id}`, { method: "DELETE" });
    if (res.ok) { setAssignments(prev => prev.filter(a => a.id !== id)); setConfirmId(null); }
    setDeletingId(null);
  }

  async function handleRun(assignment: Assignment) {
    if (!connected.has(assignment.platform_agent_id)) {
      setConnectingFor(assignment.platform_agent_id);
      return;
    }
    setRunningId(assignment.id);
    setRunMsg(null);
    const res = await fetch("/api/admin/steward/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId: assignment.id }),
    });
    const data = await res.json();
    setRunningId(null);
    if (res.ok) {
      setAssignments(prev => prev.map(a =>
        a.id === assignment.id
          ? { ...a, last_run_at: new Date().toISOString(), last_run_status: data.status }
          : a
      ));
      setRunMsg({ id: assignment.id, text: data.summary ? `Done: ${data.summary.slice(0, 120)}` : "Run completed", ok: true });
    } else {
      setRunMsg({ id: assignment.id, text: data.error || "Run failed", ok: false });
    }
  }

  async function handleConnect(platform: string) {
    if (!apiKey.trim()) return;
    setConnecting(true);
    const res = await fetch("/api/admin/steward/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, platform, tokenData: { api_key: apiKey.trim() } }),
    });
    setConnecting(false);
    if (res.ok) {
      setConnected(prev => new Set([...prev, platform]));
      setConnectingFor(null);
      setApiKey("");
    }
  }

  async function handleDisconnect(platform: string) {
    await fetch(`/api/admin/steward/tokens?clientId=${clientId}&platform=${platform}`, { method: "DELETE" });
    setConnected(prev => { const s = new Set(prev); s.delete(platform); return s; });
  }

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <h2>Steward agents</h2>
        {!showForm && (
          <button className="admin-card-action" onClick={() => setShowForm(true)}>+ Add agent</button>
        )}
      </div>

      {assignments.length === 0 && !showForm && (
        <div className="admin-empty">No agents assigned yet.</div>
      )}

      {assignments.map(a => {
        const p = a.steward_platform_agents;
        const isConnected = connected.has(a.platform_agent_id);
        const isRunning = runningId === a.id;
        const msg = runMsg?.id === a.id ? runMsg : null;

        return (
          <div key={a.id} className={`steward-assignment${a.active ? "" : " inactive"}`}>
            <div className="sa-header">
              <span className="sa-icon" aria-hidden="true">{p.icon}</span>
              <div className="sa-info">
                <span className="sa-platform">{p.display_name}</span>
                <span className="sa-last-run">
                  {a.last_run_at
                    ? `Last run ${new Date(a.last_run_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                    : "Never run"}
                  {a.last_run_status && (
                    <span className={`alr-badge ${a.last_run_status === "completed" ? "ok" : "warn"}`} style={{ marginLeft: 6 }}>
                      {a.last_run_status}
                    </span>
                  )}
                  {!isConnected && (
                    <span className="alr-badge warn" style={{ marginLeft: 6 }}>not connected</span>
                  )}
                </span>
              </div>
              <div className="sa-controls">
                <button
                  className="admin-btn admin-btn-sm"
                  onClick={() => handleRun(a)}
                  disabled={isRunning || !a.active}
                  title={!isConnected ? "Connect platform first" : "Run now"}
                >
                  {isRunning ? "Running…" : "Run now"}
                </button>
                <button
                  className={`sa-toggle ${a.active ? "on" : "off"}`}
                  onClick={() => handleToggle(a.id, a.active)}
                  disabled={togglingId === a.id}
                >
                  {a.active ? "Active" : "Paused"}
                </button>
                {confirmId === a.id ? (
                  <>
                    <button
                      className="admin-btn-ghost admin-btn-sm"
                      style={{ color: "var(--red)", borderColor: "var(--red)" }}
                      onClick={() => handleDelete(a.id)}
                      disabled={deletingId === a.id}
                    >
                      {deletingId === a.id ? "Removing…" : "Confirm"}
                    </button>
                    <button className="admin-btn-ghost admin-btn-sm" onClick={() => setConfirmId(null)}>Cancel</button>
                  </>
                ) : (
                  <button
                    className="admin-btn-ghost admin-btn-sm"
                    style={{ color: "var(--text-mute)", borderColor: "transparent" }}
                    onClick={() => setConfirmId(a.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <p className="sa-mission">{a.mission}</p>

            <div className="sa-footer">
              {a.schedule && <span className="sa-schedule">⏱ {a.schedule}</span>}
              {isConnected
                ? <button className="sa-connect-link" onClick={() => handleDisconnect(a.platform_agent_id)}>Disconnect {p.display_name}</button>
                : <button className="sa-connect-link warn" onClick={() => setConnectingFor(a.platform_agent_id)}>Connect {p.display_name} →</button>
              }
            </div>

            {msg && (
              <p className="sa-run-msg" style={{ color: msg.ok ? "var(--sage)" : "var(--red)" }}>
                {msg.text}
              </p>
            )}

            {connectingFor === a.platform_agent_id && (
              <div className="steward-connect-form">
                <p className="sa-field-label" style={{ marginBottom: 8 }}>
                  {p.display_name} API key — find it in your Monday.com account under Administration → Developers.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="password"
                    className="admin-input"
                    style={{ flex: 1, marginBottom: 0 }}
                    placeholder="Paste API key…"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                  />
                  <button className="admin-btn admin-btn-sm" onClick={() => handleConnect(a.platform_agent_id)} disabled={connecting || !apiKey.trim()}>
                    {connecting ? "Saving…" : "Save"}
                  </button>
                  <button className="admin-btn-ghost admin-btn-sm" onClick={() => { setConnectingFor(null); setApiKey(""); }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {showForm && (
        <div className="steward-add-form">
          <div style={{ marginBottom: 10 }}>
            <label className="sa-field-label">Platform</label>
            <select value={platformId} onChange={e => setPlatformId(e.target.value)} className="admin-select" style={{ marginBottom: 0 }}>
              <option value="">Select platform…</option>
              {platforms.map(p => (
                <option key={p.id} value={p.id}>{p.icon} {p.display_name}</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label className="sa-field-label">Mission</label>
            <textarea
              value={mission}
              onChange={e => setMission(e.target.value)}
              className="admin-textarea"
              rows={3}
              placeholder="What should this agent do for this client? Be specific — this is the scope boundary. e.g. Monitor Monday.com boards for items with no activity in 7+ days. Add a stale comment and move them to the Stale group."
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="sa-field-label">Schedule <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(cron, optional)</span></label>
            <input
              value={schedule}
              onChange={e => setSchedule(e.target.value)}
              className="admin-input"
              style={{ marginBottom: 0 }}
              placeholder="0 9 * * 1-5  (Mon–Fri 9am)"
            />
          </div>
          {err && <p style={{ color: "var(--red)", fontSize: 12, margin: "0 0 10px" }}>{err}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="admin-btn admin-btn-sm" onClick={handleAdd} disabled={saving}>{saving ? "Saving…" : "Add agent"}</button>
            <button className="admin-btn-ghost admin-btn-sm" onClick={() => { setShowForm(false); setErr(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
