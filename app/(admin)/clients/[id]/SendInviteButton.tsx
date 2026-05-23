"use client";
import { useState } from "react";

export function SendInviteButton({
  clientId,
  hasEmail,
  alreadyInvited,
}: {
  clientId: string;
  hasEmail: boolean;
  alreadyInvited: boolean;
}) {
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  if (!hasEmail) {
    return <span style={{ fontSize: 11, color: "var(--text-mute)" }}>Add an email first</span>;
  }

  async function send() {
    if (alreadyInvited && !confirm("Re-send the invitation email?")) return;
    setSending(true);
    setMsg(null);
    const res = await fetch(`/api/admin/clients/${clientId}/invite`, { method: "POST" });
    const data = await res.json();
    setSending(false);
    if (res.ok) setMsg({ text: `Invitation sent to ${data.email}`, tone: "ok" });
    else setMsg({ text: data.error || "Failed to send", tone: "err" });
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        onClick={send}
        disabled={sending}
        className="admin-btn-ghost admin-btn-sm"
        style={{ fontSize: 11, padding: "4px 10px" }}
      >
        {sending ? "Sending…" : alreadyInvited ? "Re-send invite" : "Send invite"}
      </button>
      {msg && (
        <span style={{ fontSize: 11, color: msg.tone === "ok" ? "var(--sage)" : "var(--red)" }}>
          {msg.text}
        </span>
      )}
    </span>
  );
}
