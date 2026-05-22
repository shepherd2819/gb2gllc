"use client";
import { useState } from "react";

type Product = { id: string; product: string; active: boolean; started_at: string };

export function ClientControls({
  clientId, clientEmail, clientName, clientCompany,
  status, products, stripeCustomerId,
}: {
  clientId: string; clientEmail: string; clientName: string | null;
  clientCompany: string | null; status: string;
  products: Product[]; stripeCustomerId: string | null;
}) {
  const ALL_PRODUCTS = ["herald", "atrium", "steward"];
  const activeSet = new Set(products.filter(p => p.active).map(p => p.product));
  const [active, setActive] = useState<Set<string>>(activeSet);
  const [acctStatus, setAcctStatus] = useState(status);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function toggleProduct(product: string) {
    const next = new Set(active);
    next.has(product) ? next.delete(product) : next.add(product);
    setActive(next);
    setSaving(true);
    const res = await fetch(`/api/admin/clients/${clientId}/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product, active: next.has(product) }),
    });
    setSaving(false);
    setMsg(res.ok ? "Saved" : "Error saving");
    setTimeout(() => setMsg(""), 2000);
  }

  async function setStatus(s: string) {
    setSaving(true);
    const res = await fetch(`/api/admin/clients/${clientId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: s }),
    });
    if (res.ok) setAcctStatus(s);
    setSaving(false);
    setMsg(res.ok ? "Status updated" : "Error");
    setTimeout(() => setMsg(""), 2000);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        {msg && <span className="save-msg">{msg}</span>}
        {saving && <span className="save-msg">Saving…</span>}
      </div>

      <div className="product-toggles">
        {ALL_PRODUCTS.map(p => (
          <button
            key={p}
            className={`prod-toggle ${active.has(p) ? "on" : "off"}`}
            onClick={() => toggleProduct(p)}
          >
            <span className="pt-dot" />
            <span className="pt-name">{p}</span>
            <span className="pt-state">{active.has(p) ? "Active" : "Off"}</span>
          </button>
        ))}
      </div>

      <div className="status-controls">
        <span className="ctrl-label">Account status</span>
        <div className="status-btns">
          {["active", "paused", "disabled"].map(s => (
            <button
              key={s}
              className={`status-btn s-${s} ${acctStatus === s ? "selected" : ""}`}
              onClick={() => setStatus(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}
