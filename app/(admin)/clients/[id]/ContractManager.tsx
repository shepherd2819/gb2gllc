"use client";

import { useState } from "react";

type Contract = {
  id: string;
  product: string;
  amount_cents: number;
  cadence: string;
  status: string;
  sent_at: string | null;
  signed_at: string | null;
  voided_at: string | null;
  expires_at: string;
  signer_name: string | null;
  token: string;
};

export function ContractManager({
  clientId,
  contracts,
  marketingUrl,
}: {
  clientId: string;
  contracts: Contract[];
  marketingUrl: string;
}) {
  const [product, setProduct]   = useState("herald");
  const [amount, setAmount]     = useState("2400");
  const [cadence, setCadence]   = useState("monthly");
  const [scope, setScope]       = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg]           = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/vera/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id:    clientId,
          product,
          amount_cents: Math.round(Number(amount) * 100),
          cadence,
          scope_notes:  scope.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMsg({ text: j.error || `Failed (${res.status})`, tone: "err" });
        setSubmitting(false);
        return;
      }
      window.location.reload();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Network error", tone: "err" });
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <h2>Contracts</h2>
      </div>

      <form onSubmit={onSubmit}>
        <div className="admin-input-row">
          <label>Product</label>
          <select className="admin-select" value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="herald">Herald</option>
            <option value="atrium">Atrium</option>
            <option value="steward">Steward</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="admin-input-row">
          <label>Amount (USD)</label>
          <input className="admin-input" type="number" step="0.01" min="0" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="admin-input-row">
          <label>Cadence</label>
          <select className="admin-select" value={cadence} onChange={(e) => setCadence(e.target.value)}>
            <option value="monthly">per month</option>
            <option value="one_time">one-time</option>
            <option value="hourly">per hour</option>
          </select>
        </div>
        <div className="admin-input-row">
          <label>Scope notes <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(optional, overrides default)</span></label>
          <textarea className="admin-textarea" rows={3} value={scope} onChange={(e) => setScope(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <button type="submit" className="admin-btn" disabled={submitting}>
            {submitting ? "Generating…" : "Generate Contract"}
          </button>
          {msg && (
            <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: msg.tone === "ok" ? "var(--sage)" : "var(--red)" }}>
              {msg.text}
            </span>
          )}
        </div>
      </form>

      <div className="admin-card-head" style={{ marginTop: 24, marginBottom: 8, borderTop: "1px solid var(--border)", paddingTop: 18 }}>
        <h2 style={{ fontSize: 14 }}>History</h2>
      </div>
      {contracts.length === 0 ? (
        <div className="admin-empty">No contracts yet.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontFamily: "var(--mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-mute)", borderBottom: "1px solid var(--border)" }}>Product</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontFamily: "var(--mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-mute)", borderBottom: "1px solid var(--border)" }}>Amount</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontFamily: "var(--mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-mute)", borderBottom: "1px solid var(--border)" }}>Status</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontFamily: "var(--mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-mute)", borderBottom: "1px solid var(--border)" }}>Sent</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontFamily: "var(--mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-mute)", borderBottom: "1px solid var(--border)" }}>Signed</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontFamily: "var(--mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-mute)", borderBottom: "1px solid var(--border)" }}>Signer</th>
                <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }} />
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td style={{ padding: "8px 12px", fontSize: 13, borderBottom: "1px solid var(--border)" }}>{c.product}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13, fontFamily: "var(--mono)", borderBottom: "1px solid var(--border)" }}>${(c.amount_cents / 100).toFixed(2)} / {c.cadence}</td>
                  <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
                    <span className="admin-badge">{c.status}</span>
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: "var(--mono)", color: "var(--text-mute)", borderBottom: "1px solid var(--border)" }}>
                    {c.sent_at ? new Date(c.sent_at).toLocaleDateString() : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: "var(--mono)", color: "var(--text-mute)", borderBottom: "1px solid var(--border)" }}>
                    {c.signed_at ? new Date(c.signed_at).toLocaleDateString() : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 13, borderBottom: "1px solid var(--border)" }}>{c.signer_name ?? "—"}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                    <a href={`/agents/vera/${c.id}`} className="at-link">Open →</a>
                    {c.status === "sent" && (
                      <>
                        {" · "}
                        <a href={`${marketingUrl}/sign/${c.token}`} target="_blank" rel="noreferrer" className="at-link">Link</a>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
