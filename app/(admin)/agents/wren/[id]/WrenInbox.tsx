"use client";
import { useState } from "react";

type Msg = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  category: string | null;
  priority: string | null;
  suggested_action: string | null;
  draft_reply: string | null;
  status: string;
  received_at: string;
  classify_error: string | null;
  matched_client_id: string | null;
};

export function WrenInbox({ accountId, messages }: { accountId: string; messages: Msg[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function pollNow() {
    setBusy("poll");
    try {
      const res = await fetch(`/api/admin/wren/accounts/${accountId}/poll`, { method: "POST" });
      if (!res.ok) alert("Poll failed");
      else location.reload();
    } finally {
      setBusy(null);
    }
  }

  async function reclassify(messageId: string) {
    setBusy(messageId);
    try {
      const res = await fetch(`/api/admin/wren/messages/${messageId}/reclassify`, { method: "POST" });
      if (!res.ok) alert((await res.json()).error ?? "Reclassify failed");
      else location.reload();
    } finally {
      setBusy(null);
    }
  }

  async function send(messageId: string) {
    if (!confirm("Send this draft to the client?")) return;
    setBusy(messageId);
    try {
      const res = await fetch(`/api/admin/wren/messages/${messageId}/send`, { method: "POST" });
      if (!res.ok) alert((await res.json()).error ?? "Send failed");
      else location.reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="wren-inbox">
      <div style={{ marginBottom: 12 }}>
        <button className="admin-btn" onClick={pollNow} disabled={busy !== null}>
          {busy === "poll" ? "Polling…" : "Poll now"}
        </button>
      </div>
      {messages.length === 0 ? (
        <p className="muted">No messages yet.</p>
      ) : (
        <ul className="message-list">
          {messages.map((m) => (
            <li key={m.id} className={`message-row status-${m.status}`}>
              <button className="message-summary" onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                <span className={`chip cat ${m.category ?? "unclassified"}`}>{m.category ?? "—"}</span>
                <span className={`chip pri ${m.priority ?? "low"}`}>{m.priority ?? "—"}</span>
                <span className="from">{m.from_name || m.from_email || "(unknown)"}</span>
                <span className="subject">{m.subject || "(no subject)"}</span>
                <span className="date">{new Date(m.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </button>
              {expanded === m.id && (
                <div className="message-detail">
                  <p className="snippet">{m.snippet}</p>
                  {m.suggested_action && <p><strong>Action:</strong> {m.suggested_action}</p>}
                  {m.classify_error && <p className="error">Classify error: {m.classify_error}</p>}
                  {m.draft_reply ? (
                    <>
                      <h4>Draft reply</h4>
                      <pre className="draft">{m.draft_reply}</pre>
                      <div className="actions">
                        <button className="admin-btn" onClick={() => reclassify(m.id)} disabled={busy === m.id}>Re-draft</button>
                        <button className="admin-btn primary" onClick={() => send(m.id)} disabled={busy === m.id}>
                          {busy === m.id ? "Sending…" : "Send"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="muted">No draft for this message.</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
