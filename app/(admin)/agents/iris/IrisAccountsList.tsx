"use client";
import { useState } from "react";

type Account = {
  id: string;
  email_address: string;
  aliases: string[];
  status: string;
  last_polled_at: string | null;
  last_poll_error: string | null;
  updated_at: string;
};

export function IrisAccountsList({
  initial,
  counts,
}: {
  initial: Account[];
  counts: Record<string, { pending: number }>;
}) {
  const [accounts, setAccounts] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function togglePause(a: Account) {
    setBusyId(a.id);
    const next = a.status === "active" ? "paused" : "active";
    const res = await fetch(`/api/admin/iris/accounts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusyId(null);
    if (res.ok) setAccounts(accounts.map((x) => (x.id === a.id ? { ...x, status: next } : x)));
  }

  async function disconnect(a: Account) {
    if (!confirm(`Disconnect ${a.email_address}? All stored messages for this inbox will be deleted.`)) return;
    setBusyId(a.id);
    const res = await fetch(`/api/admin/iris/accounts/${a.id}`, { method: "DELETE" });
    setBusyId(null);
    if (res.ok) setAccounts(accounts.filter((x) => x.id !== a.id));
  }

  async function pollNow(a: Account) {
    setBusyId(a.id);
    const res = await fetch(`/api/admin/iris/accounts/${a.id}/poll`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusyId(null);
    if (res.ok) {
      const r = json.result;
      alert(`Polled ${a.email_address}\n\nNew: ${r.fetched}\nClassified: ${r.classified}\nDrafted: ${r.drafted}\nSkipped: ${r.skipped}\nErrors: ${r.errors.length}${r.errors.length ? "\n\n" + r.errors.slice(0, 3).join("\n") : ""}`);
      window.location.reload();
    } else {
      alert(`Poll failed: ${json.error ?? res.statusText}`);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <a className="admin-btn admin-btn-sm" href="/api/iris/oauth/start">+ Connect Gmail inbox</a>
      </div>

      {accounts.length === 0 ? (
        <div className="admin-card" style={{ padding: 24 }}>
          <div className="admin-empty">
            No inbox connected yet. Click <strong>+ Connect Gmail inbox</strong> to authorize Iris.
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-mute)" }}>
              Iris will request: read mail, modify labels, create drafts. She never sends without a click.
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {accounts.map((a) => {
            const pending = counts[a.id]?.pending ?? 0;
            return (
              <div key={a.id} className="admin-card" style={{ padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                      <strong style={{ fontSize: 15 }}>{a.email_address}</strong>
                      <span className={`status-chip ${a.status === "active" ? "active" : "paused"}`}>{a.status}</span>
                    </div>
                    {a.aliases.length > 0 && (
                      <div style={{ fontSize: 11, color: "var(--text-mute)", fontFamily: "var(--mono)", marginBottom: 6 }}>
                        Aliases: {a.aliases.join(", ")}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-mute)" }}>
                      <span>
                        <strong style={{ color: "var(--text)" }}>{pending}</strong> pending review
                      </span>
                      <span>
                        Last polled: {a.last_polled_at ? new Date(a.last_polled_at).toLocaleString() : "never"}
                      </span>
                    </div>
                    {a.last_poll_error && (
                      <div style={{ marginTop: 8, fontSize: 11, color: "var(--red, #be5050)", fontFamily: "var(--mono)" }}>
                        Last error: {a.last_poll_error}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <a className="admin-btn admin-btn-sm" href={`/agents/iris/${a.id}`}>Open inbox →</a>
                    <button className="admin-btn-ghost admin-btn-sm" onClick={() => pollNow(a)} disabled={busyId === a.id}>
                      {busyId === a.id ? "…" : "Poll now"}
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
