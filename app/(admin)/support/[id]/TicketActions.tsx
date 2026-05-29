"use client";
import { useState } from "react";

type Status = "open" | "in_progress" | "resolved" | "awaiting_review";

export function TicketActions({ ticketId, status }: { ticketId: string; status: string }) {
  const [busy, setBusy] = useState(false);

  async function setStatus(next: Status) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/support/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) alert((await res.json()).error ?? "Update failed");
      else location.reload();
    } finally {
      setBusy(false);
    }
  }

  const isAwaitingReview = status === "awaiting_review";

  return (
    <div className="ticket-actions" style={{ display: "flex", gap: 8, marginTop: 16 }}>
      {status !== "in_progress" && (
        <button className="admin-btn" onClick={() => setStatus("in_progress")} disabled={busy}>
          {isAwaitingReview ? "Re-open as in_progress" : "Mark in progress"}
        </button>
      )}
      {status !== "awaiting_review" && status !== "resolved" && (
        <button className="admin-btn" onClick={() => setStatus("awaiting_review")} disabled={busy}>
          Mark awaiting_review
        </button>
      )}
      {status !== "resolved" && (
        <button className="admin-btn primary" onClick={() => setStatus("resolved")} disabled={busy}>
          {busy ? "Saving…" : "Mark resolved"}
        </button>
      )}
      {status === "resolved" && (
        <button className="admin-btn" onClick={() => setStatus("open")} disabled={busy}>Re-open</button>
      )}
    </div>
  );
}
