"use client";
import { useState } from "react";

type Props = {
  clientId: string;
  initialBotId: string | null;
  initialAgentName: string | null;
  initialEnabled: boolean;
  lastSentAt: string | null;
};

export function HeraldManager({ clientId, initialBotId, initialAgentName, initialEnabled, lastSentAt }: Props) {
  const [botId, setBotId] = useState(initialBotId ?? "");
  const [agentName, setAgentName] = useState(initialAgentName ?? "");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [result, setResult] = useState<null | {
    status: string;
    reason?: string;
    step?: string;
    email?: string;
  }>(null);

  function flash(text: string, tone: "ok" | "err") {
    setMsg({ text, tone });
    setTimeout(() => setMsg(null), 3500);
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/admin/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatbot_bot_id: botId,
        chatbot_agent_name: agentName,
        herald_digest_enabled: enabled,
      }),
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
    setResult(null);
    let data: { status?: string; reason?: string; step?: string; email?: string } = {};
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/herald/test-digest`, { method: "POST" });
      data = await res.json().catch(() => ({ status: "failed", reason: `HTTP ${res.status} with non-JSON response` }));
      if (!res.ok && !data.status) {
        data = { status: "failed", reason: `HTTP ${res.status}` };
      }
    } catch (err) {
      data = { status: "failed", reason: err instanceof Error ? err.message : "Network error", step: "fetch" };
    }
    setTesting(false);
    setResult({ status: data.status ?? "failed", reason: data.reason, step: data.step, email: data.email });
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

      <div className="admin-input-row" style={{ marginTop: 8 }}>
        <label>Agent name <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(shown on client dashboard + emails)</span></label>
        <input
          className="admin-input"
          style={{ marginBottom: 0 }}
          placeholder="e.g. PMC Web Agent"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
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

      {result && (
        <div
          style={{
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: 8,
            fontSize: 12,
            fontFamily: "var(--mono)",
            background: result.status === "sent" ? "rgba(106,142,99,0.10)" : "rgba(196,82,75,0.10)",
            color: result.status === "sent" ? "var(--sage)" : "var(--red)",
            border: `1px solid ${result.status === "sent" ? "rgba(106,142,99,0.30)" : "rgba(196,82,75,0.30)"}`,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {result.status === "sent" ? "✓ Digest sent" : `✗ ${result.status}${result.step ? ` (at ${result.step})` : ""}`}
          </div>
          {result.reason && <div style={{ opacity: 0.85, lineHeight: 1.4 }}>{result.reason}</div>}
          {result.email && result.status === "sent" && (
            <div style={{ opacity: 0.7, marginTop: 4 }}>To: {result.email}</div>
          )}
        </div>
      )}
    </div>
  );
}
