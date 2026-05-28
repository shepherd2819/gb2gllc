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

export function WrenInbox({ accountId, messages: initial }: { accountId: string; messages: Msg[] }) {
  const [messages, setMessages] = useState(initial);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function updateMessage(id: string, patch: Partial<Msg>) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

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
                <MessageDetail
                  key={m.id}
                  message={m}
                  onUpdate={(patch) => updateMessage(m.id, patch)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageDetail({ message, onUpdate }: { message: Msg; onUpdate: (p: Partial<Msg>) => void }) {
  const [draft, setDraft] = useState(message.draft_reply ?? "");
  const [busy, setBusy] = useState<"" | "save" | "send" | "redraft" | "archive" | "flag">("");
  const dirty = draft !== (message.draft_reply ?? "");

  async function saveDraft() {
    setBusy("save");
    try {
      const res = await fetch(`/api/admin/wren/messages/${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_reply: draft }),
      });
      if (res.ok) onUpdate({ draft_reply: draft });
      else {
        const j = await res.json().catch(() => ({}));
        alert(`Save failed: ${j.error ?? res.statusText}`);
      }
    } finally {
      setBusy("");
    }
  }

  async function send() {
    if (!confirm("Send this draft to the client?")) return;
    if (dirty) await saveDraft();
    setBusy("send");
    try {
      const res = await fetch(`/api/admin/wren/messages/${message.id}/send`, { method: "POST" });
      if (res.ok) onUpdate({ status: "sent" });
      else {
        const j = await res.json().catch(() => ({}));
        alert(`Send failed: ${j.error ?? res.statusText}`);
      }
    } finally {
      setBusy("");
    }
  }

  async function redraft() {
    setBusy("redraft");
    try {
      const res = await fetch(`/api/admin/wren/messages/${message.id}/reclassify`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.classification) {
        const c = json.classification;
        onUpdate({
          category: c.category,
          priority: c.priority,
          suggested_action: c.suggested_action,
          draft_reply: c.draft_reply,
          status: "classified",
          classify_error: null,
        });
        setDraft(c.draft_reply ?? "");
      } else {
        alert(`Re-draft failed: ${json.error ?? res.statusText}`);
      }
    } finally {
      setBusy("");
    }
  }

  async function setStatus(next: "archived" | "flagged") {
    setBusy(next === "archived" ? "archive" : "flag");
    try {
      const res = await fetch(`/api/admin/wren/messages/${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) onUpdate({ status: next });
      else {
        const j = await res.json().catch(() => ({}));
        alert(`Update failed: ${j.error ?? res.statusText}`);
      }
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="message-detail">
      <p className="snippet">{message.snippet}</p>
      {message.suggested_action && <p><strong>Action:</strong> {message.suggested_action}</p>}
      {message.classify_error && <p className="error">Classify error: {message.classify_error}</p>}

      <h4>
        Draft reply
        {dirty && (
          <span style={{ marginLeft: 8, fontSize: 11, color: "var(--orange, #b07a3a)" }}>● unsaved</span>
        )}
      </h4>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.max(4, Math.min(20, draft.split("\n").length + 1))}
        className="draft-edit"
        placeholder={message.draft_reply ? "" : "No draft was generated for this email. Write one here and save, or click Re-draft."}
        style={{ width: "100%", fontFamily: "var(--mono, monospace)", fontSize: 13, lineHeight: 1.55, padding: 8, marginBottom: 10, resize: "vertical" }}
      />

      <div className="actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="admin-btn primary"
          onClick={send}
          disabled={busy !== "" || !draft.trim() || message.status === "sent"}
        >
          {busy === "send" ? "Sending…" : message.status === "sent" ? "Sent" : "Send"}
        </button>
        <button
          className="admin-btn"
          onClick={saveDraft}
          disabled={busy !== "" || !dirty}
        >
          {busy === "save" ? "Saving…" : "Save edit"}
        </button>
        <button
          className="admin-btn"
          onClick={redraft}
          disabled={busy !== ""}
        >
          {busy === "redraft" ? "Re-drafting…" : "Re-draft"}
        </button>
        <button
          className="admin-btn"
          onClick={() => setStatus("archived")}
          disabled={busy !== "" || message.status === "archived"}
        >
          {busy === "archive" ? "…" : "Archive"}
        </button>
        <button
          className="admin-btn"
          onClick={() => setStatus("flagged")}
          disabled={busy !== "" || message.status === "flagged"}
        >
          {busy === "flag" ? "…" : "Flag"}
        </button>
      </div>
    </div>
  );
}
