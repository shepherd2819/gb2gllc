"use client";
import { useState } from "react";

type Campaign = {
  id: string;
  name: string;
  status: string;
  sender_email: string;
  daily_send_cap: number;
  created_at: string;
  updated_at: string;
};

export function AveryCampaignsList({ initial }: { initial: Campaign[] }) {
  const [campaigns, setCampaigns] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function create() {
    if (!name.trim()) return;
    setBusy(true); setErr("");
    const res = await fetch("/api/admin/avery/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setCampaigns([data.campaign, ...campaigns]);
      setName(""); setCreating(false);
      window.location.href = `/agents/avery/${data.campaign.id}`;
    } else {
      setErr(data.error ?? "Failed to create");
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        {!creating && (
          <button className="admin-btn admin-btn-sm" onClick={() => setCreating(true)}>+ New campaign</button>
        )}
      </div>

      {creating && (
        <div className="admin-card" style={{ marginBottom: 18, padding: 16 }}>
          <div className="admin-input-row" style={{ marginBottom: 0 }}>
            <label>Campaign name</label>
            <input
              className="admin-input"
              style={{ marginBottom: 0 }}
              placeholder="e.g. Real-estate media agencies — Q3"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          {err && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 8 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="admin-btn admin-btn-sm" onClick={create} disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create + open"}
            </button>
            <button className="admin-btn-ghost admin-btn-sm" onClick={() => { setCreating(false); setName(""); setErr(""); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="admin-card" style={{ padding: 24 }}>
          <div className="admin-empty">
            No campaigns yet. Click <strong>+ New campaign</strong> to start your first outreach run.
          </div>
        </div>
      ) : (
        <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg-mute, rgba(28,30,27,0.04))", textAlign: "left" }}>
                {["Name", "Status", "From", "Daily cap", "Updated", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid rgba(28,30,27,0.06)" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 500 }}>{c.name}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span className={`status-chip ${c.status === "active" ? "active" : "paused"}`}>{c.status}</span>
                  </td>
                  <td style={{ padding: "10px 12px", fontFamily: "var(--mono)", fontSize: 11 }}>{c.sender_email}</td>
                  <td style={{ padding: "10px 12px", fontFamily: "var(--mono)", fontSize: 11 }}>{c.daily_send_cap}/day</td>
                  <td style={{ padding: "10px 12px", fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mute)" }}>
                    {new Date(c.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <a href={`/agents/avery/${c.id}`} className="at-link">Open →</a>
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
