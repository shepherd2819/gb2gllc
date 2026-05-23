"use client";
import { useState } from "react";
import { InviteClientModal } from "./InviteClientModal";

type Client = {
  id: string; name: string | null; email: string | null; company: string | null;
  status: string | null; created_at: string; last_signed_in_at: string | null;
  client_products: { product: string; active: boolean }[];
};

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export function ClientsPageClient({ initialClients }: { initialClients: Client[] }) {
  const [clients, setClients] = useState(initialClients);
  const [showInvite, setShowInvite] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = clients.filter(c => {
    const q = search.toLowerCase();
    return !q || (c.company || "").toLowerCase().includes(q) || (c.name || "").toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q);
  });

  async function refresh() {
    setShowInvite(false);
    window.location.reload();
  }

  return (
    <>
      <div className="admin-page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1>Clients</h1>
          <span className="admin-count">{clients.length} total</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            className="admin-input"
            style={{ width: 220, marginBottom: 0 }}
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="admin-btn" onClick={() => setShowInvite(true)}>+ Invite client</button>
        </div>
      </div>

      <div className="admin-table">
        <div className="at-head">
          <span>Company</span>
          <span>Email</span>
          <span>Products</span>
          <span>Status</span>
          <span>Last seen</span>
          <span>Since</span>
          <span></span>
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: "24px 16px", color: "var(--text-mute)", fontSize: 13 }}>
            {search ? "No clients match your search." : "No clients yet. Invite your first one."}
          </div>
        )}
        {filtered.map((c) => {
          const prods = c.client_products ?? [];
          const activeProds = prods.filter(p => p.active).map(p => p.product);
          return (
            <div key={c.id} className={`at-row status-${c.status ?? "active"}`}>
              <span className="at-company">{c.company || c.name || "—"}</span>
              <span className="at-email">{c.email || <em style={{ color: "var(--text-mute)" }}>no email yet</em>}</span>
              <span className="at-products">
                {activeProds.length === 0
                  ? <span className="prod-none">none</span>
                  : activeProds.map(p => <span key={p} className={`prod-chip ${p}`}>{p}</span>)
                }
              </span>
              <span><span className={`status-chip ${c.status ?? "active"}`}>{c.status ?? "active"}</span></span>
              <span className="at-date" title={c.last_signed_in_at ?? "Never signed in"} style={{ color: c.last_signed_in_at ? undefined : "var(--text-mute)" }}>
                {relativeTime(c.last_signed_in_at)}
              </span>
              <span className="at-date">{new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}</span>
              <span><a href={`/clients/${c.id}`} className="at-link">Manage →</a></span>
            </div>
          );
        })}
      </div>

      {showInvite && <InviteClientModal onClose={() => setShowInvite(false)} onCreated={refresh} />}
    </>
  );
}
