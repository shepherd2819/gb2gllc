"use client";
import { useState } from "react";

const ALL_PRODUCTS = ["herald", "atrium", "steward"];

export function InviteClientModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [products, setProducts] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggleProduct(p: string) {
    setProducts(prev => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/admin/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, company, products: Array.from(products) }),
    });
    if (res.ok) {
      onCreated();
    } else {
      const d = await res.json();
      setError(d.error || "Something went wrong");
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <h2>Invite new client</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={submit}>
          <div className="admin-input-row">
            <label>Email</label>
            <input className="admin-input" style={{ marginBottom: 0 }} type="email" required placeholder="client@company.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="admin-input-row" style={{ marginTop: 8 }}>
            <label>Name</label>
            <input className="admin-input" style={{ marginBottom: 0 }} placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="admin-input-row" style={{ marginTop: 8 }}>
            <label>Company</label>
            <input className="admin-input" style={{ marginBottom: 0 }} placeholder="Company name" value={company} onChange={e => setCompany(e.target.value)} />
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="ctrl-label">Products</div>
            <div className="product-toggles">
              {ALL_PRODUCTS.map(p => (
                <button type="button" key={p} className={`prod-toggle ${products.has(p) ? "on" : "off"}`} onClick={() => toggleProduct(p)}>
                  <span className="pt-dot" />
                  <span className="pt-name">{p}</span>
                  <span className="pt-state">{products.has(p) ? "On" : "Off"}</span>
                </button>
              ))}
            </div>
          </div>

          {error && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 8 }}>{error}</div>}

          <div className="modal-footer">
            <button type="button" className="admin-btn-ghost admin-btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="admin-btn admin-btn-sm" disabled={saving || !email.trim()}>
              {saving ? "Sending invite…" : "Send invite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
