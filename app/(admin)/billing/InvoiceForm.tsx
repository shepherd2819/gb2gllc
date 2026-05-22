"use client";
import { useState } from "react";

type Client = { id: string; name: string | null; email: string; company: string | null; stripe_customer_id: string | null };

export function InvoiceForm({ clients, preselectedClientId }: { clients: Client[]; preselectedClientId?: string }) {
  const [clientId, setClientId] = useState(preselectedClientId ?? "");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId || !amount) return;
    setStatus("sending");
    const res = await fetch("/api/admin/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, description, amountDollars: parseFloat(amount) }),
    });
    const data = await res.json();
    if (res.ok) { setStatus("done"); setDescription(""); setAmount(""); }
    else { setStatus("error"); setErrorMsg(data.error ?? "Unknown error"); }
  }

  return (
    <form className="invoice-form" onSubmit={send}>
      {status === "done" && <p className="ticket-success">Invoice sent via Stripe.</p>}
      {status === "error" && <p className="ticket-error">{errorMsg}</p>}
      <select className="admin-select" value={clientId} onChange={e => setClientId(e.target.value)} required>
        <option value="">Select client…</option>
        {clients.map(c => (
          <option key={c.id} value={c.id}>{c.company || c.name || c.email}</option>
        ))}
      </select>
      <input className="admin-input" placeholder="Description (e.g. Herald — May 2026)" value={description} onChange={e => setDescription(e.target.value)} />
      <div className="amount-row">
        <span className="dollar-sign">$</span>
        <input className="admin-input amount-input" type="number" step="0.01" min="1" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} required />
      </div>
      <button className="admin-btn" type="submit" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Send invoice →"}
      </button>
    </form>
  );
}
