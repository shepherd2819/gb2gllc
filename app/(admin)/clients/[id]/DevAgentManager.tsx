"use client";
import { useState } from "react";

type Run = {
  id: string;
  trigger: "ticket" | "manual" | "scheduled";
  triggering_ticket_id: string | null;
  task_text: string;
  status: "queued" | "running" | "completed_merged" | "completed_needs_review" | "failed";
  ship: { prUrl: string | null; merged: boolean } | null;
  tokens_used: number | null;
  cost_usd: number | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
};

type Assignment = {
  client_id: string;
  mission: string;
  trigger_categories: string[];
  budget_overrides: Record<string, number> | null;
  active: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
};

type Props = {
  clientId: string;
  initialAssignment: Assignment | null;
  initialRuns: Run[];
};

const CATEGORY_OPTIONS = ["Question", "Bug Report", "Feature Request", "Code Fix", "Other"];

export function DevAgentManager({ clientId, initialAssignment, initialRuns }: Props) {
  const [mission, setMission] = useState(initialAssignment?.mission ?? "");
  const [categories, setCategories] = useState<string[]>(initialAssignment?.trigger_categories ?? []);
  const [active, setActive] = useState(initialAssignment?.active ?? false);
  const [saving, setSaving] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [manualTask, setManualTask] = useState("");
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  function flash(text: string, tone: "ok" | "err") {
    setMsg({ text, tone });
    setTimeout(() => setMsg(null), 3500);
  }

  function toggleCategory(c: string) {
    setCategories((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/admin/clients/${clientId}/devagent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mission, trigger_categories: categories, active }),
    });
    setSaving(false);
    flash(res.ok ? "Saved" : "Save failed", res.ok ? "ok" : "err");
  }

  async function dispatch() {
    if (!manualTask.trim()) return flash("Task text required", "err");
    setDispatching(true);
    const res = await fetch(`/api/admin/clients/${clientId}/devagent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskText: manualTask }),
    });
    setDispatching(false);
    if (res.ok) {
      flash("Dispatched", "ok");
      setManualTask("");
      // Refresh runs list.
      const reload = await fetch(`/api/admin/clients/${clientId}/devagent`);
      if (reload.ok) {
        const data = await reload.json();
        setRuns(data.runs ?? []);
      }
    } else {
      flash("Dispatch failed", "err");
    }
  }

  function statusBadge(s: Run["status"]): { label: string; cls: string } {
    if (s === "completed_merged") return { label: "Merged", cls: "badge-ok" };
    if (s === "completed_needs_review") return { label: "Needs review", cls: "badge-warn" };
    if (s === "failed") return { label: "Failed", cls: "badge-err" };
    if (s === "running") return { label: "Running…", cls: "badge-info" };
    return { label: "Queued", cls: "badge-muted" };
  }

  return (
    <section className="manager-card">
      <h2 className="section-title">Ada (dev agent)</h2>

      {msg && <p className={msg.tone === "ok" ? "manager-msg-ok" : "manager-msg-err"}>{msg.text}</p>}

      <div className="manager-row">
        <label className="manager-label">Active</label>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
      </div>

      <div className="manager-row">
        <label className="manager-label">Mission</label>
        <textarea
          className="manager-textarea"
          value={mission}
          rows={4}
          onChange={(e) => setMission(e.target.value)}
        />
      </div>

      <div className="manager-row">
        <label className="manager-label">Auto-trigger on categories</label>
        <div className="chip-row">
          {CATEGORY_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              className={categories.includes(c) ? "chip chip-on" : "chip"}
              onClick={() => toggleCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <button className="manager-save" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>

      <hr className="manager-divider" />

      <h3 className="section-subtitle">Dispatch manually</h3>
      <textarea
        className="manager-textarea"
        placeholder="Task description (will be passed to Ada)..."
        value={manualTask}
        rows={3}
        onChange={(e) => setManualTask(e.target.value)}
      />
      <button className="manager-save" onClick={dispatch} disabled={dispatching}>
        {dispatching ? "Dispatching…" : "Dispatch Ada"}
      </button>

      <hr className="manager-divider" />

      <h3 className="section-subtitle">Recent runs</h3>
      {runs.length === 0 ? (
        <p className="manager-muted">No runs yet.</p>
      ) : (
        <table className="manager-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Started</th>
              <th>Task</th>
              <th>PR</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const b = statusBadge(r.status);
              return (
                <tr key={r.id}>
                  <td><span className={`badge ${b.cls}`}>{b.label}</span></td>
                  <td>{new Date(r.started_at).toLocaleString()}</td>
                  <td className="manager-task-cell">{r.task_text.slice(0, 80)}</td>
                  <td>{r.ship?.prUrl ? <a href={r.ship.prUrl} target="_blank" rel="noreferrer">PR</a> : "—"}</td>
                  <td>{r.cost_usd != null ? `$${Number(r.cost_usd).toFixed(4)}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
