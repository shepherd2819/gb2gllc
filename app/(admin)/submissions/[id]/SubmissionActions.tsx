"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SubmissionActions({ sessionId, notionUrl }: { sessionId: string; notionUrl: string | null }) {
  const router = useRouter();
  const [converting, setConverting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function convert() {
    setConverting(true);
    setMsg("");
    const res = await fetch(`/api/admin/submissions/${sessionId}/convert`, { method: "POST" });
    const data = await res.json();
    setConverting(false);
    if (res.ok) {
      setMsg("Client created + invite sent");
      if (data.clientId) setTimeout(() => router.push(`/clients/${data.clientId}`), 1200);
    } else {
      setMsg(data.error || "Error converting");
    }
  }

  async function del() {
    setDeleting(true);
    const res = await fetch(`/api/admin/submissions/${sessionId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/submissions");
    } else {
      setMsg("Error deleting");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="admin-card" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <button className="admin-btn" onClick={convert} disabled={converting}>
        {converting ? "Creating client…" : "Convert to client"}
      </button>

      {notionUrl && (
        <a href={notionUrl} target="_blank" rel="noopener noreferrer" className="admin-btn-ghost admin-btn-sm" style={{ display: "inline-block" }}>
          Open in Notion ↗
        </a>
      )}

      {!confirmDelete ? (
        <button
          className="admin-btn-ghost admin-btn-sm"
          style={{ marginLeft: "auto", borderColor: "var(--red)", color: "var(--red)" }}
          onClick={() => setConfirmDelete(true)}
        >
          Delete submission
        </button>
      ) : (
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-mute)" }}>Are you sure?</span>
          <button
            className="admin-btn admin-btn-sm"
            style={{ background: "var(--red)" }}
            onClick={del}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Yes, delete"}
          </button>
          <button className="admin-btn-ghost admin-btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
        </div>
      )}

      {msg && <span className="save-msg" style={{ width: "100%" }}>{msg}</span>}
    </div>
  );
}
