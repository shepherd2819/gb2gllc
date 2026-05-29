"use client";
import { useState } from "react";

type Account = {
  id: string;
  email_address: string;
  timezone: string | null;
  status: string;
  last_polled_at: string | null;
  last_poll_error: string | null;
  updated_at: string;
};

export function HoltAccountsList({
  initial,
  counts,
}: {
  initial: Account[];
  counts: Record<string, { upcoming: number; sent_today: number }>;
}) {
  const [accounts, setAccounts] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function togglePause(a: Account) {
    setBusyId(a.id);
    const next = a.status === "active" ? "paused" : "active";
    const res = await fetch(`/api/admin/holt/accounts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusyId(null);
    if (res.ok) setAccounts(accounts.map((x) => (x.id === a.id ? { ...x, status: next } : x)));
  }

  async function disconnect(a: Account) {
    if (!confirm(`Disconnect Holt for ${a.email_address}? All stored briefings will be deleted.`)) return;
    setBusyId(a.id);
    const res = await fetch(`/api/admin/holt/accounts/${a.id}`, { method: "DELETE" });
    setBusyId(null);
    if (res.ok) setAccounts(accounts.filter((x) => x.id !== a.id));
  }

  async function runNow(a: Account) {
    setBusyId(a.id);
    const res = await fetch(`/api/admin/holt/accounts/${a.id}/run`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusyId(null);
    if (res.ok) {
      const r = json.result;
      alert(`Ran Holt for ${a.email_address}\n\nEvents scanned: ${r.events_scanned}\nNew briefable: ${r.briefable_new}\nPrebriefs sent: ${r.prebriefs_sent}\nEvening digests sent: ${r.evening_digests_sent}\nErrors: ${r.errors.length}${r.errors.length ? "\n\n" + r.errors.slice(0, 3).join("\n") : ""}`);
      window.location.reload();
    } else {
      alert(`Run failed: ${json.error ?? res.statusText}`);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <a className="admin-btn admin-btn-sm" href="/api/holt/oauth/start">+ Connect Google Calendar</a>
      </div>

      {accounts.length === 0 ? (
        <div className="admin-card" style={{ padding: 24 }}>
          <div className="admin-empty">
            No calendar connected yet. Click <strong>+ Connect Google Calendar</strong> to authorize Holt.
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-mute)" }}>
              Holt requests read-only calendar access. She never creates, modifies, or deletes events.
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {accounts.map((a) => {
            const c = counts[a.id] ?? { upcoming: 0, sent_today: 0 };
            return (
              <div key={a.id} className="admin-card" style={{ padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                      <strong style={{ fontSize: 15 }}>{a.email_address}</strong>
                      <span className={`status-chip ${a.status === "active" ? "active" : "paused"}`}>{a.status}</span>
                      {a.timezone && <span style={{ fontSize: 11, color: "var(--text-mute)", fontFamily: "var(--mono)" }}>{a.timezone}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-mute)" }}>
                      <span><strong style={{ color: "var(--text)" }}>{c.upcoming}</strong> external meetings in next 24h</span>
                      <span><strong style={{ color: "var(--text)" }}>{c.sent_today}</strong> briefings sent today</span>
                      <span>Last scan: {a.last_polled_at ? new Date(a.last_polled_at).toLocaleString() : "never"}</span>
                    </div>
                    {a.last_poll_error && (
                      <div style={{ marginTop: 8, fontSize: 11, color: "var(--red, #be5050)", fontFamily: "var(--mono)" }}>
                        Last error: {a.last_poll_error}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <a className="admin-btn admin-btn-sm" href={`/agents/holt/${a.id}`}>Open →</a>
                    <button className="admin-btn-ghost admin-btn-sm" onClick={() => runNow(a)} disabled={busyId === a.id}>
                      {busyId === a.id ? "…" : "Run now"}
                    </button>
                    <button className="admin-btn-ghost admin-btn-sm" onClick={() => togglePause(a)} disabled={busyId === a.id}>
                      {a.status === "active" ? "Pause" : "Resume"}
                    </button>
                    <button className="admin-btn-ghost admin-btn-sm" onClick={() => disconnect(a)} disabled={busyId === a.id}>
                      Disconnect
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
