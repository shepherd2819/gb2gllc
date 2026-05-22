"use client";
import { useState } from "react";

type Announcement = { id: string; title: string; body: string | null; type: string; created_at: string; client_id: string | null };

export function AnnouncementManager({
  clientId, initialAnnouncements,
}: {
  clientId: string; initialAnnouncements: Announcement[];
}) {
  const [list, setList] = useState(initialAnnouncements);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState("info");
  const [broadcast, setBroadcast] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function send() {
    if (!title.trim()) return;
    setSaving(true);
    const res = await fetch("/api/admin/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: broadcast ? null : clientId, title, body, type }),
    });
    if (res.ok) {
      const { announcement } = await res.json();
      setList(prev => [announcement, ...prev]);
      setTitle(""); setBody(""); setType("info"); setBroadcast(false);
      setMsg("Sent");
      setTimeout(() => setMsg(""), 2000);
    } else setMsg("Error");
    setSaving(false);
  }

  async function remove(id: string) {
    await fetch(`/api/admin/announcements/${id}`, { method: "DELETE" });
    setList(prev => prev.filter(a => a.id !== id));
  }

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <h2>Announcements</h2>
        {msg && <span className="save-msg">{msg}</span>}
      </div>

      <div className="announcement-list">
        {list.length === 0 && <div className="admin-empty">No announcements</div>}
        {list.map(a => (
          <div key={a.id} className="announcement-row">
            <div className="ann-head">
              <span className={`ann-type ${a.type}`}>{a.type.replace("_", " ")}</span>
              {a.client_id === null && <span className="ann-type" style={{ background: "var(--red-dim)", color: "var(--red)" }}>broadcast</span>}
              <span className="ann-title">{a.title}</span>
              <button className="ann-delete" onClick={() => remove(a.id)} title="Delete">×</button>
            </div>
            {a.body && <div className="ann-body">{a.body}</div>}
            <div className="ann-meta">{new Date(a.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
          </div>
        ))}
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div className="ctrl-label">New announcement</div>
        <input className="admin-input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
        <textarea className="admin-input" rows={2} placeholder="Body (optional)" style={{ resize: "vertical" }} value={body} onChange={e => setBody(e.target.value)} />
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <select className="admin-select" style={{ width: "auto", marginBottom: 0 }} value={type} onChange={e => setType(e.target.value)}>
            <option value="info">Info</option>
            <option value="update">Update</option>
            <option value="action_required">Action required</option>
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-soft)", cursor: "pointer" }}>
            <input type="checkbox" checked={broadcast} onChange={e => setBroadcast(e.target.checked)} />
            Broadcast to all clients
          </label>
        </div>
        <button className="admin-btn" onClick={send} disabled={saving || !title.trim()}>
          {saving ? "Sending…" : "Send announcement"}
        </button>
      </div>
    </div>
  );
}
