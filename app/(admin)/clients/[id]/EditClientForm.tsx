"use client";
import { useState } from "react";

export function EditClientForm({
  clientId, name, email, company,
}: {
  clientId: string; name: string | null; email: string; company: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [vals, setVals] = useState({ name: name || "", email, company: company || "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/admin/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(vals),
    });
    setSaving(false);
    if (res.ok) { setMsg("Saved"); setEditing(false); setTimeout(() => setMsg(""), 2000); }
    else setMsg("Error saving");
  }

  if (!editing) {
    return (
      <div className="client-meta">
        <div className="cm-row"><span>Name</span><span>{name || "—"}</span></div>
        <div className="cm-row"><span>Company</span><span>{company || "—"}</span></div>
        <div className="cm-row"><span>Email</span><span>{email}</span></div>
        {msg && <div style={{ fontSize: 11, color: "var(--sage)", fontFamily: "var(--mono)", marginTop: 4 }}>{msg}</div>}
        <button className="admin-btn-ghost admin-btn-sm" style={{ marginTop: 10 }} onClick={() => setEditing(true)}>Edit info</button>
      </div>
    );
  }

  return (
    <div className="client-meta">
      <div className="edit-form">
        <div className="admin-input-row">
          <label>Name</label>
          <input className="admin-input" style={{ marginBottom: 0 }} value={vals.name} onChange={e => setVals(v => ({ ...v, name: e.target.value }))} />
        </div>
        <div className="admin-input-row" style={{ marginTop: 8 }}>
          <label>Company</label>
          <input className="admin-input" style={{ marginBottom: 0 }} value={vals.company} onChange={e => setVals(v => ({ ...v, company: e.target.value }))} />
        </div>
        <div className="admin-input-row" style={{ marginTop: 8 }}>
          <label>Email</label>
          <input className="admin-input" style={{ marginBottom: 0 }} type="email" value={vals.email} onChange={e => setVals(v => ({ ...v, email: e.target.value }))} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="admin-btn admin-btn-sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          <button className="admin-btn-ghost admin-btn-sm" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
