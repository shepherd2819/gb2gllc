"use client";
import { useState } from "react";

type Account = { id: string; email_address: string; aliases: string[]; status: string };
type Message = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  delivered_to: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string;
  category: string | null;
  priority: string | null;
  reasoning: string | null;
  suggested_action: string | null;
  draft_reply: string | null;
  body_text: string | null;
  body_purged_at: string | null;
  status: string;
  classify_error: string | null;
  gmail_draft_id: string | null;
  gmail_thread_id: string;
};
type Settings = {
  account_id: string;
  draft_categories: string[];
  ignore_from_patterns: string[];
  voice_notes: string | null;
  signature: string | null;
};

const CATEGORIES = ["lead", "support", "internal", "newsletter", "calendar", "spam", "personal", "other"];
const STATUSES   = ["classified", "new", "sent", "archived", "flagged", "all"];

const CAT_COLOR: Record<string, string> = {
  lead:       "#2c7a4a",
  support:    "#7a4c2c",
  internal:   "#4a4a8a",
  newsletter: "#8a8a4a",
  calendar:   "#2c5a7a",
  spam:       "#8a4a4a",
  personal:   "#7a2c7a",
  other:      "#5a5a5a",
};

const PRI_LABEL: Record<string, string> = { high: "🔴 high", med: "🟡 med", low: "⚪ low" };

export function IrisInbox({ account, initialMessages, settings, currentStatus, currentCategory }: {
  account: Account;
  initialMessages: Message[];
  settings: Settings;
  currentStatus: string;
  currentCategory: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [selectedId, setSelectedId] = useState<string | null>(initialMessages[0]?.id ?? null);
  const [showSettings, setShowSettings] = useState(false);

  const selected = messages.find((m) => m.id === selectedId) ?? null;

  function updateMsg(id: string, patch: Partial<Message>) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function setFilter(key: "status" | "category", value: string) {
    const params = new URLSearchParams();
    if (key === "status") { if (value !== "classified") params.set("status", value); }
    else { if (currentStatus !== "classified") params.set("status", currentStatus); }
    if (key === "category") { if (value) params.set("category", value); }
    else { if (currentCategory) params.set("category", currentCategory); }
    const qs = params.toString();
    window.location.href = `/agents/iris/${account.id}${qs ? `?${qs}` : ""}`;
  }

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1>📥 {account.email_address}</h1>
          <span className="client-email">
            {account.aliases.length > 0 ? `Aliases: ${account.aliases.join(", ")}` : "No aliases"}
            {" · "}<a href="/agents/iris" className="at-link">← All inboxes</a>
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="admin-btn-ghost admin-btn-sm" onClick={() => setShowSettings(!showSettings)}>
            {showSettings ? "Hide settings" : "Settings"}
          </button>
        </div>
      </div>

      {showSettings && (
        <SettingsPanel accountId={account.id} initial={settings} onClose={() => setShowSettings(false)} />
      )}

      {/* Filter bar */}
      <div className="admin-card" style={{ padding: 12, marginBottom: 14, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-mute)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Status</span>
          <select value={currentStatus} onChange={(e) => setFilter("status", e.target.value)} className="admin-input" style={{ width: "auto", marginBottom: 0, padding: "4px 8px", fontSize: 12 }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-mute)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Category</span>
          <select value={currentCategory} onChange={(e) => setFilter("category", e.target.value)} className="admin-input" style={{ width: "auto", marginBottom: 0, padding: "4px 8px", fontSize: 12 }}>
            <option value="">all</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-mute)" }}>
          {messages.length} message{messages.length === 1 ? "" : "s"}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 14 }}>
        {/* Message list */}
        <div className="admin-card" style={{ padding: 0, overflow: "hidden", maxHeight: "75vh", overflowY: "auto" }}>
          {messages.length === 0 ? (
            <div className="admin-empty" style={{ padding: 20 }}>No messages match this filter.</div>
          ) : (
            messages.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedId(m.id)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "10px 12px", borderBottom: "1px solid rgba(28,30,27,0.06)",
                  background: selectedId === m.id ? "rgba(28,30,27,0.05)" : "transparent",
                  border: "none", cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  {m.category && (
                    <span style={{ fontSize: 9, color: "white", background: CAT_COLOR[m.category] ?? "#5a5a5a", padding: "1px 6px", borderRadius: 3, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>
                      {m.category}
                    </span>
                  )}
                  {m.priority && <span style={{ fontSize: 10 }}>{PRI_LABEL[m.priority] ?? m.priority}</span>}
                  <span style={{ fontSize: 10, color: "var(--text-mute)", marginLeft: "auto" }}>
                    {new Date(m.received_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.from_name || m.from_email || "(unknown sender)"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-mute)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.subject || "(no subject)"}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Detail pane */}
        {selected ? (
          <MessageDetail
            key={selected.id}
            message={selected}
            onUpdate={(patch) => updateMsg(selected.id, patch)}
          />
        ) : (
          <div className="admin-card" style={{ padding: 24 }}>
            <div className="admin-empty">Select a message on the left.</div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Detail pane ─────────────────────────────────────────────────────────
function MessageDetail({ message, onUpdate }: { message: Message; onUpdate: (p: Partial<Message>) => void }) {
  const [draft, setDraft] = useState(message.draft_reply ?? "");
  const [busy, setBusy] = useState<"" | "save" | "send" | "archive" | "reclassify">("");
  const dirty = draft !== (message.draft_reply ?? "");

  async function saveDraft() {
    setBusy("save");
    const res = await fetch(`/api/admin/iris/messages/${message.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft_reply: draft }),
    });
    setBusy("");
    if (res.ok) onUpdate({ draft_reply: draft });
    else { const j = await res.json().catch(() => ({})); alert(`Save failed: ${j.error ?? res.statusText}`); }
  }

  async function send() {
    if (!confirm("Send this reply via Gmail now?")) return;
    if (dirty) await saveDraft();
    setBusy("send");
    const res = await fetch(`/api/admin/iris/messages/${message.id}/send`, { method: "POST" });
    setBusy("");
    if (res.ok) onUpdate({ status: "sent" });
    else { const j = await res.json().catch(() => ({})); alert(`Send failed: ${j.error ?? res.statusText}`); }
  }

  async function archive() {
    setBusy("archive");
    const res = await fetch(`/api/admin/iris/messages/${message.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    setBusy("");
    if (res.ok) onUpdate({ status: "archived" });
  }

  async function reclassify() {
    setBusy("reclassify");
    const res = await fetch(`/api/admin/iris/messages/${message.id}/reclassify`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusy("");
    if (res.ok && json.classification) {
      const c = json.classification;
      onUpdate({
        category: c.category, priority: c.priority, reasoning: c.reasoning,
        suggested_action: c.suggested_action, draft_reply: c.draft_reply,
        status: "classified", classify_error: null,
      });
      setDraft(c.draft_reply ?? "");
    } else {
      alert(`Reclassify failed: ${json.error ?? res.statusText}`);
    }
  }

  const gmailThreadUrl = `https://mail.google.com/mail/u/0/#inbox/${message.gmail_thread_id}`;

  return (
    <div className="admin-card" style={{ padding: 20, maxHeight: "75vh", overflowY: "auto" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(28,30,27,0.08)", paddingBottom: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          {message.category && (
            <span style={{ fontSize: 10, color: "white", background: CAT_COLOR[message.category] ?? "#5a5a5a", padding: "2px 8px", borderRadius: 3, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>
              {message.category}
            </span>
          )}
          {message.priority && <span style={{ fontSize: 11 }}>{PRI_LABEL[message.priority] ?? message.priority}</span>}
          <span className={`status-chip ${message.status === "sent" ? "active" : "paused"}`} style={{ marginLeft: 4 }}>{message.status}</span>
          <a href={gmailThreadUrl} target="_blank" rel="noopener noreferrer" className="at-link" style={{ marginLeft: "auto", fontSize: 12 }}>
            Open in Gmail ↗
          </a>
        </div>
        <h2 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 500 }}>{message.subject || "(no subject)"}</h2>
        <div style={{ fontSize: 12, color: "var(--text-mute)", fontFamily: "var(--mono)" }}>
          From: {message.from_name ? `${message.from_name} <${message.from_email}>` : message.from_email}
          {message.delivered_to && <> · To: {message.delivered_to}</>}
          {" · "}{new Date(message.received_at).toLocaleString()}
        </div>
      </div>

      {/* Iris reasoning */}
      {(message.suggested_action || message.reasoning) && (
        <div style={{ marginBottom: 14, padding: 12, background: "rgba(28,30,27,0.03)", borderRadius: 4, fontSize: 13 }}>
          {message.suggested_action && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Iris suggests · </span>
              <strong>{message.suggested_action}</strong>
            </div>
          )}
          {message.reasoning && (
            <div style={{ fontSize: 12, color: "var(--text-mute)", fontStyle: "italic" }}>{message.reasoning}</div>
          )}
        </div>
      )}

      {message.classify_error && (
        <div style={{ marginBottom: 14, padding: 10, background: "rgba(190,80,80,0.08)", fontSize: 12, color: "var(--red, #be5050)", fontFamily: "var(--mono)" }}>
          Classifier error: {message.classify_error}
        </div>
      )}

      {/* Original body */}
      <details style={{ marginBottom: 14 }}>
        <summary style={{ cursor: "pointer", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)", marginBottom: 8 }}>
          Original email {message.body_purged_at && "(body purged — only snippet retained)"}
        </summary>
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.55, padding: 12, background: "rgba(28,30,27,0.03)", maxHeight: 320, overflowY: "auto", margin: 0 }}>
          {message.body_text || message.snippet || "(no body)"}
        </pre>
      </details>

      {/* Draft */}
      <div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>
            Draft reply {message.gmail_draft_id && "· synced to Gmail"}
          </span>
          {dirty && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--orange, #b07a3a)" }}>● unsaved</span>}
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.max(6, Math.min(20, draft.split("\n").length + 1))}
          className="admin-input"
          style={{ fontFamily: "var(--mono)", fontSize: 13, lineHeight: 1.55, resize: "vertical", marginBottom: 10 }}
          placeholder={message.draft_reply ? "" : "No draft was generated for this email. Write one here and save, or click Reclassify."}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="admin-btn admin-btn-sm" onClick={send} disabled={busy !== "" || !draft.trim() || message.status === "sent"}>
            {busy === "send" ? "Sending…" : message.status === "sent" ? "Sent" : "Send reply"}
          </button>
          <button className="admin-btn-ghost admin-btn-sm" onClick={saveDraft} disabled={busy !== "" || !dirty}>
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
          <button className="admin-btn-ghost admin-btn-sm" onClick={reclassify} disabled={busy !== ""}>
            {busy === "reclassify" ? "Reclassifying…" : "Reclassify"}
          </button>
          <button className="admin-btn-ghost admin-btn-sm" onClick={archive} disabled={busy !== "" || message.status === "archived"}>
            {busy === "archive" ? "…" : "Archive"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Settings panel ──────────────────────────────────────────────────────
function SettingsPanel({ accountId, initial, onClose }: { accountId: string; initial: Settings; onClose: () => void }) {
  const [draftCats, setDraftCats] = useState<string[]>(initial.draft_categories);
  const [ignore,    setIgnore]    = useState(initial.ignore_from_patterns.join("\n"));
  const [voice,     setVoice]     = useState(initial.voice_notes ?? "");
  const [sig,       setSig]       = useState(initial.signature ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggle(cat: string) {
    setDraftCats(draftCats.includes(cat) ? draftCats.filter((c) => c !== cat) : [...draftCats, cat]);
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/admin/iris/accounts/${accountId}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draft_categories: draftCats,
        ignore_from_patterns: ignore.split("\n").map((s) => s.trim()).filter(Boolean),
        voice_notes: voice,
        signature: sig,
      }),
    });
    setBusy(false);
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  }

  return (
    <div className="admin-card" style={{ padding: 18, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Iris settings</h3>
        <button className="admin-btn-ghost admin-btn-sm" onClick={onClose}>Close</button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>
          Draft replies for these categories
        </label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => toggle(c)}
              style={{
                fontSize: 11, padding: "4px 10px", borderRadius: 3,
                border: draftCats.includes(c) ? "none" : "1px solid var(--border, rgba(28,30,27,0.15))",
                background: draftCats.includes(c) ? (CAT_COLOR[c] ?? "#5a5a5a") : "transparent",
                color: draftCats.includes(c) ? "white" : "var(--text)",
                cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em",
              }}
            >{c}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>
          Voice notes (applied to every draft)
        </label>
        <textarea
          value={voice}
          onChange={(e) => { setVoice(e.target.value); setSaved(false); }}
          rows={3}
          className="admin-input"
          placeholder="e.g. Warm but direct. No exclamation points. Sign off as 'John'. Never offer specific times — say I'll send a Calendly link."
          style={{ marginTop: 6, fontSize: 13 }}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>
          Signature (appended to every draft)
        </label>
        <textarea
          value={sig}
          onChange={(e) => { setSig(e.target.value); setSaved(false); }}
          rows={3}
          className="admin-input"
          placeholder={"John\nGB2GLLC · gb2gllc.com"}
          style={{ marginTop: 6, fontSize: 13, fontFamily: "var(--mono)" }}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>
          Ignore senders matching (one substring per line — case-insensitive)
        </label>
        <textarea
          value={ignore}
          onChange={(e) => { setIgnore(e.target.value); setSaved(false); }}
          rows={4}
          className="admin-input"
          style={{ marginTop: 6, fontSize: 12, fontFamily: "var(--mono)" }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="admin-btn admin-btn-sm" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
        {saved && <span style={{ fontSize: 12, color: "var(--green, #3c8c5a)" }}>✓ Saved</span>}
        <span style={{ fontSize: 11, color: "var(--text-mute)", marginLeft: "auto" }}>
          Changes apply to future polls. To re-run Iris on existing messages, open each and click Reclassify.
        </span>
      </div>
    </div>
  );
}
