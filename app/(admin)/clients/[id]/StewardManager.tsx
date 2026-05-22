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
}: {
  clientId: string;
  initialAssignments: Assignment[];
  platforms: Platform[];
}) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [showForm, setShowForm]       = useState(false);
  const [platformId, setPlatformId]   = useState("");
  const [mission, setMission]         = useState("");
  const [schedule, setSchedule]       = useState("");
  const [saving, setSaving]           = useState(false);
  const [togglingId, setTogglingId]   = useState<string | null>(null);
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const [confirmId, setConfirmId]     = useState<string | null>(null);
  const [err, setErr]                 = useState("");

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

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <h2>Steward agents</h2>
        {!showForm && (
          <button className="admin-card-action" onClick={() => setShowForm(true)}>
            + Add agent
          </button>
        )}
      </div>

      {assignments.length === 0 && !showForm && (
        <div className="admin-empty">No agents assigned yet.</div>
      )}

      {assignments.map(a => {
        const p = a.steward_platform_agents;
        return (
          <div key={a.id} className={`steward-assignment${a.active ? "" : " inactive"}`}>
            <div className="sa-header">
              <span className="sa-icon" aria-hidden="true">{p.icon}</span>
              <div className="sa-info">
                <span className="sa-platform">{p.display_name}</span>
                {a.last_run_at && (
                  <span className="sa-last-run">
                    Last run {new Date(a.last_run_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {a.last_run_status && (
                      <span className={`alr-badge ${a.last_run_status === "completed" ? "ok" : "warn"}`} style={{ marginLeft: 6 }}>
                        {a.last_run_status}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="sa-controls">
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
                    Remove
                  </button>
                )}
              </div>
            </div>
            <p className="sa-mission">{a.mission}</p>
            {a.schedule && <span className="sa-schedule">⏱ {a.schedule}</span>}
          </div>
        );
      })}

      {showForm && (
        <div className="steward-add-form">
          <div style={{ marginBottom: 10 }}>
            <label className="sa-field-label">Platform</label>
            <select
              value={platformId}
              onChange={e => setPlatformId(e.target.value)}
              className="admin-select"
              style={{ marginBottom: 0 }}
            >
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
              placeholder="What should this agent do for this client? Be specific — this becomes the scope boundary. e.g. Monitor Monday.com boards for items with no updates in 7+ days. Mark them as stale and comment with a nudge to the assignee."
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="sa-field-label">
              Schedule <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(cron, optional)</span>
            </label>
            <input
              value={schedule}
              onChange={e => setSchedule(e.target.value)}
              className="admin-input"
              style={{ marginBottom: 0 }}
              placeholder="0 9 * * 1-5  (Mon–Fri at 9am ET)"
            />
          </div>
          {err && <p style={{ color: "var(--red)", fontSize: 12, margin: "0 0 10px" }}>{err}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="admin-btn admin-btn-sm" onClick={handleAdd} disabled={saving}>
              {saving ? "Saving…" : "Add agent"}
            </button>
            <button className="admin-btn-ghost admin-btn-sm" onClick={() => { setShowForm(false); setErr(""); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
