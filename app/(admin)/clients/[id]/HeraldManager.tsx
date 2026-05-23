"use client";
import { useState } from "react";

type Props = {
  clientId: string;
  initialBotId: string | null;
  initialEnabled: boolean;
  lastSentAt: string | null;
};

export function HeraldManager({ clientId, initialBotId, initialEnabled, lastSentAt }: Props) {
  const [botId, setBotId] = useState(initialBotId ?? "");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  function flash(text: string, tone: "ok" | "err") {
    setMsg({ text, tone });
    setTimeout(() => setMsg(null), 3500);
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/admin/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatbot_bot_id: botId, herald_digest_enabled: enabled }),
    });
    setSaving(false);
    if (res.ok) flash("Saved", "ok");
    else flash("Save failed", "err");
  }

  async function sendTest() {
    if (!botId.trim()) {
      flash("Set a bot ID first", "err");
      return;
    }
    setTesting(true);
    const res = await fetch(`/api/admin/clients/${clientId}/herald/test-digest`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setTesting(false);
    if (res.ok && data.status === "sent") flash("Digest sent", "ok");
    else flash(data.reason || data.error || "Failed to send", "err");
  }

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <h2>Herald (chatbot.com)</h2>
        {lastSentAt && (
          <span style={{ fontSize: 11, color: "var(--text-mute)", fontFamily: "var(--mono)" }}>
            Last sent {new Date(lastSentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
      </div>

      <div className="admin-input-row">
        <label>Bot / Story ID</label>
        <input
          className="admin-input"
          style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }}
          placeholder="e.g. abc123def456"
          value={botId}
          onChange={(e) => setBotId(e.target.value)}
        />
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Send weekly digest to {`{client email}`}</span>
      </label>

      <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
        <button className="admin-btn admin-btn-sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="admin-btn-ghost admin-btn-sm" onClick={sendTest} disabled={testing || !botId.trim()}>
          {testing ? "Sending…" : "Send test digest now"}
        </button>
        {msg && (
          <span
            style={{
              fontSize: 12,
              fontFamily: "var(--mono)",
              color: msg.tone === "ok" ? "var(--sage)" : "var(--red)",
            }}
          >
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
