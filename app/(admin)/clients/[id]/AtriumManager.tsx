"use client";
import { useState } from "react";

type Stage = { id: string; stage: number; label: string; note: string | null; completed: boolean };

export function AtriumManager({ clientId, stages }: { clientId: string; stages: Stage[] }) {
  const [list, setList] = useState<Stage[]>(stages);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function addStage() {
    if (!label.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/admin/clients/${clientId}/atrium`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, note }),
    });
    if (res.ok) {
      const { stage } = await res.json();
      setList(prev => [...prev, stage]);
      setLabel(""); setNote("");
    }
    setSaving(false);
  }

  async function toggleStage(id: string, completed: boolean) {
    const res = await fetch(`/api/admin/clients/${clientId}/atrium`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, completed }),
    });
    if (res.ok) setList(prev => prev.map(s => s.id === id ? { ...s, completed } : s));
  }

  return (
    <div className="admin-card">
      <h2 className="admin-card-title">Atrium Progress</h2>
      <div className="atrium-stage-list">
        {list.length === 0 && <div className="admin-empty">No stages yet</div>}
        {list.map(s => (
          <div key={s.id} className={`atrium-admin-row ${s.completed ? "done" : ""}`}>
            <button
              className={`atrium-check ${s.completed ? "checked" : ""}`}
              onClick={() => toggleStage(s.id, !s.completed)}
            >
              {s.completed ? "✓" : "○"}
            </button>
            <div className="atrium-row-text">
              <span className="ar-label">{s.label}</span>
              {s.note && <span className="ar-note">{s.note}</span>}
            </div>
            <span className="ar-stage">#{s.stage}</span>
          </div>
        ))}
      </div>
      <div className="atrium-add-form">
        <input className="admin-input" placeholder="Stage label (e.g. Wireframe complete)" value={label} onChange={e => setLabel(e.target.value)} />
        <input className="admin-input" placeholder="Note for client (optional)" value={note} onChange={e => setNote(e.target.value)} />
        <button className="admin-btn" onClick={addStage} disabled={saving || !label.trim()}>
          {saving ? "Adding…" : "Add stage"}
        </button>
      </div>
    </div>
  );
}
