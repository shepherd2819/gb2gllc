"use client";
import { useState } from "react";

export function JuneResetControls({
  attemptId,
  compact = false,
}: {
  attemptId?: string;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  async function call(body: object) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/june/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setMsg({ text: `Deleted ${data.deleted}`, tone: "ok" });
      if (!compact) setTimeout(() => window.location.reload(), 700);
    } else {
      setMsg({ text: data.error ?? "Failed", tone: "err" });
    }
  }

  if (compact && attemptId) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <button
          className="admin-btn-ghost admin-btn-sm"
          style={{ fontSize: 11, padding: "4px 10px", color: "var(--red)", borderColor: "rgba(196,82,75,0.4)" }}
          onClick={() => {
            if (confirm("Delete this attempt? The visitor will be able to demo again.")) {
              call({ attemptId }).then(() => setTimeout(() => window.location.reload(), 500));
            }
          }}
          disabled={busy}
        >
          {busy ? "…" : "Delete"}
        </button>
        {msg && (
          <span style={{ fontSize: 10, color: msg.tone === "ok" ? "var(--sage)" : "var(--red)" }}>
            {msg.text}
          </span>
        )}
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button
        className="admin-btn admin-btn-sm"
        onClick={() => call({ self: true })}
        disabled={busy}
        title="Delete the row matching your own IP so you can re-test the demo"
      >
        {busy ? "Resetting…" : "Reset my IP"}
      </button>
      {msg && (
        <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: msg.tone === "ok" ? "var(--sage)" : "var(--red)" }}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
