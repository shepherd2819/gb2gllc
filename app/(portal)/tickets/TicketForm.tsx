"use client";
import { useState } from "react";

export function TicketForm({ clientId }: { clientId: string }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const res = await fetch("/api/portal/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, subject, body }),
    });
    setStatus(res.ok ? "done" : "error");
    if (res.ok) { setSubject(""); setBody(""); }
  }

  return (
    <form className="ticket-form" onSubmit={submit}>
      <h2 className="section-title">New ticket</h2>
      {status === "done" && <p className="ticket-success">Sent. We&apos;ll be in touch soon.</p>}
      {status === "error" && <p className="ticket-error">Something went wrong — email us at hello@gb2gllc.com</p>}
      <input
        className="ticket-input"
        placeholder="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        required
        disabled={status === "sending"}
      />
      <textarea
        className="ticket-textarea"
        placeholder="Describe the issue or request..."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        required
        disabled={status === "sending"}
      />
      <button className="ticket-submit" type="submit" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Submit ticket →"}
      </button>
    </form>
  );
}
