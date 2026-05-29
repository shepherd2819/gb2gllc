"use client";

import { useState } from "react";

export function ActionBar({ id, status, hasNotion }: { id: string; status: string; hasNotion: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: "resend" | "void" | "retry-notion", confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/vera/contracts/${id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `Failed (${res.status})`);
        setBusy(null);
        return;
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setBusy(null);
    }
  };

  return (
    <div style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {status === "sent" && (
        <button className="admin-btn" disabled={busy !== null} onClick={() => run("resend")}>
          {busy === "resend" ? "Resending…" : "Resend link"}
        </button>
      )}
      {(status === "draft" || status === "sent") && (
        <button className="admin-btn danger" disabled={busy !== null} onClick={() => run("void", "Void this contract? The signing link will stop working.")}>
          {busy === "void" ? "Voiding…" : "Void"}
        </button>
      )}
      {status === "signed" && !hasNotion && (
        <button className="admin-btn" disabled={busy !== null} onClick={() => run("retry-notion")}>
          {busy === "retry-notion" ? "Syncing…" : "Retry Notion sync"}
        </button>
      )}
      {error && <span style={{ color: "var(--red, #a33)" }}>{error}</span>}
    </div>
  );
}
