"use client";
import { useState } from "react";

type Account = {
  id: string;
  label: string;
  stripe_account_id: string | null;
  livemode: boolean;
  status: string;
  stripe_webhook_secret: string | null;
  last_polled_at: string | null;
  last_poll_error: string | null;
  last_metrics_json: {
    balance_available_cents?: number;
    balance_pending_cents?: number;
    currency?: string;
    mrr_cents?: number;
    active_subscriptions?: number;
    past_due_subscriptions?: number;
    failed_payments_last_7d?: { count?: number };
  } | null;
  last_metrics_at: string | null;
};

export function NoraAccountsList({
  initial,
  stats,
}: {
  initial: Account[];
  stats: Record<string, { pending_drafts: number; open_critical: number }>;
}) {
  const [accounts, setAccounts] = useState(initial);
  const [connecting, setConnecting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function togglePause(a: Account) {
    setBusyId(a.id);
    const next = a.status === "active" ? "paused" : "active";
    const res = await fetch(`/api/admin/nora/accounts/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
    setBusyId(null);
    if (res.ok) setAccounts(accounts.map((x) => (x.id === a.id ? { ...x, status: next } : x)));
  }
  async function disconnect(a: Account) {
    if (!confirm(`Disconnect Nora from ${a.label}? All stored events and digests will be deleted.`)) return;
    setBusyId(a.id);
    const res = await fetch(`/api/admin/nora/accounts/${a.id}`, { method: "DELETE" });
    setBusyId(null);
    if (res.ok) setAccounts(accounts.filter((x) => x.id !== a.id));
  }
  async function runNow(a: Account, withDigest: boolean) {
    setBusyId(a.id);
    const res = await fetch(`/api/admin/nora/accounts/${a.id}/run${withDigest ? "?digest=1" : ""}`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusyId(null);
    if (res.ok) {
      const r = json.reconcile;
      const d = json.digest;
      alert(`Ran Nora\n\nReconcile: ${r.scanned} scanned, ${r.new_events} new events\nDigest: ${d ? (d.sent ? "sent" : `skipped (${d.reason})`) : "(not requested)"}\nErrors: ${r.errors.length}${r.errors.length ? "\n\n" + r.errors.slice(0, 3).join("\n") : ""}`);
      window.location.reload();
    } else {
      alert(`Run failed: ${json.error ?? res.statusText}`);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        {!connecting && (
          <button className="admin-btn admin-btn-sm" onClick={() => setConnecting(true)}>+ Connect Stripe account</button>
        )}
      </div>

      {connecting && <ConnectForm onCancel={() => setConnecting(false)} onConnected={() => window.location.reload()} />}

      {accounts.length === 0 && !connecting ? (
        <div className="admin-card" style={{ padding: 24 }}>
          <div className="admin-empty">
            No Stripe account connected. Click <strong>+ Connect Stripe account</strong> to get started.
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-mute)" }}>
              You&apos;ll paste a restricted API key + webhook signing secret you create in your Stripe dashboard.
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {accounts.map((a) => {
            const s = stats[a.id] ?? { pending_drafts: 0, open_critical: 0 };
            const m = a.last_metrics_json ?? {};
            const cur = m.currency ?? "USD";
            return (
              <div key={a.id} className="admin-card" style={{ padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 14 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 15 }}>{a.label}</strong>
                      <span className={`status-chip ${a.status === "active" ? "active" : "paused"}`}>{a.status}</span>
                      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: a.livemode ? "#2c7a4a" : "#b07a3a", color: "white", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "var(--mono)" }}>
                        {a.livemode ? "live" : "test"}
                      </span>
                      {!a.stripe_webhook_secret && (
                        <span style={{ fontSize: 10, color: "var(--orange, #b07a3a)", fontFamily: "var(--mono)" }}>! webhook not wired</span>
                      )}
                    </div>
                    {a.stripe_account_id && (
                      <div style={{ fontSize: 11, color: "var(--text-mute)", fontFamily: "var(--mono)" }}>{a.stripe_account_id}</div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <a className="admin-btn admin-btn-sm" href={`/agents/nora/${a.id}`}>Open →</a>
                    <button className="admin-btn-ghost admin-btn-sm" onClick={() => runNow(a, false)} disabled={busyId === a.id}>
                      {busyId === a.id ? "…" : "Reconcile"}
                    </button>
                    <button className="admin-btn-ghost admin-btn-sm" onClick={() => runNow(a, true)} disabled={busyId === a.id}>
                      Send digest now
                    </button>
                    <button className="admin-btn-ghost admin-btn-sm" onClick={() => togglePause(a)} disabled={busyId === a.id}>
                      {a.status === "active" ? "Pause" : "Resume"}
                    </button>
                    <button className="admin-btn-ghost admin-btn-sm" onClick={() => disconnect(a)} disabled={busyId === a.id}>
                      Disconnect
                    </button>
                  </div>
                </div>

                {/* Snapshot strip */}
                {a.last_metrics_at && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, padding: "12px 14px", background: "rgba(28,30,27,0.03)", borderRadius: 4, fontSize: 12, marginBottom: 10 }}>
                    <Stat label="Balance available" value={money(m.balance_available_cents ?? 0, cur)} />
                    <Stat label="Balance pending"   value={money(m.balance_pending_cents ?? 0, cur)} />
                    <Stat label="MRR"               value={money(m.mrr_cents ?? 0, cur)} />
                    <Stat label="Active subs"       value={String(m.active_subscriptions ?? 0)} />
                    <Stat label="Past due"          value={String(m.past_due_subscriptions ?? 0)} highlight={Boolean(m.past_due_subscriptions && m.past_due_subscriptions > 0)} />
                    <Stat label="Failed 7d"         value={String(m.failed_payments_last_7d?.count ?? 0)} highlight={Boolean(m.failed_payments_last_7d?.count && m.failed_payments_last_7d.count > 0)} />
                  </div>
                )}

                <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-mute)" }}>
                  <span><strong style={{ color: s.pending_drafts > 0 ? "var(--text)" : "var(--text-mute)" }}>{s.pending_drafts}</strong> dunning drafts pending</span>
                  <span><strong style={{ color: s.open_critical > 0 ? "var(--red, #be5050)" : "var(--text-mute)" }}>{s.open_critical}</strong> critical events open</span>
                  <span>Last reconcile: {a.last_polled_at ? new Date(a.last_polled_at).toLocaleString() : "never"}</span>
                </div>
                {a.last_poll_error && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "var(--red, #be5050)", fontFamily: "var(--mono)" }}>
                    Last error: {a.last_poll_error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 14, fontWeight: 500, color: highlight ? "var(--red, #be5050)" : "var(--text)" }}>{value}</div>
    </div>
  );
}

function money(cents: number, currency: string): string {
  const c = currency.toUpperCase();
  const sym = c === "USD" ? "$" : c === "EUR" ? "€" : c === "GBP" ? "£" : "";
  const amt = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sym}${amt}${sym ? "" : ` ${c}`}`;
}

function ConnectForm({ onCancel, onConnected }: { onCancel: () => void; onConnected: () => void }) {
  const [secret, setSecret] = useState("");
  const [webhook, setWebhook] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setBusy(true); setErr("");
    const res = await fetch("/api/admin/nora/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret_key: secret, webhook_secret: webhook || null, label: label || undefined }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) onConnected();
    else setErr(json.error ?? "Failed");
  }

  return (
    <div className="admin-card" style={{ padding: 18, marginBottom: 16 }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 500 }}>Connect Stripe</h3>
      <div style={{ fontSize: 12, color: "var(--text-mute)", marginBottom: 14, lineHeight: 1.55 }}>
        In your Stripe dashboard:
        <ol style={{ margin: "8px 0", paddingLeft: 18 }}>
          <li><strong>Developers → API keys → Create restricted key</strong>. Grant <em>Read</em> on: Balance, Charges, Customers, Disputes, Invoices, Payouts, Refunds, Subscriptions, Events. <em>Write</em> on: Customers (so we can update notes). Paste the <code>rk_live_...</code> key below.</li>
          <li><strong>Developers → Webhooks → Add endpoint</strong>. URL: <code>https://admin.gb2gllc.com/api/stripe/webhook</code>. Subscribe to: <code>invoice.payment_failed, customer.subscription.created/updated/deleted, charge.failed, charge.refunded, charge.dispute.created, payout.failed, invoice.upcoming</code>. After creating, copy the <em>Signing secret</em> (<code>whsec_...</code>) and paste below.</li>
        </ol>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Stripe restricted key</label>
          <input
            type="password" value={secret} onChange={(e) => setSecret(e.target.value)}
            placeholder="rk_live_..." className="admin-input" style={{ marginTop: 4, fontFamily: "var(--mono)", fontSize: 12 }} autoComplete="off"
          />
        </div>
        <div>
          <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Webhook signing secret (optional — set later)</label>
          <input
            type="password" value={webhook} onChange={(e) => setWebhook(e.target.value)}
            placeholder="whsec_..." className="admin-input" style={{ marginTop: 4, fontFamily: "var(--mono)", fontSize: 12 }} autoComplete="off"
          />
        </div>
        <div>
          <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Label (optional — defaults to your business name)</label>
          <input
            type="text" value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. GB2GLLC main" className="admin-input" style={{ marginTop: 4 }}
          />
        </div>
      </div>

      {err && <div style={{ marginTop: 12, color: "var(--red, #be5050)", fontSize: 12 }}>{err}</div>}

      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <button className="admin-btn admin-btn-sm" onClick={submit} disabled={busy || !secret}>
          {busy ? "Validating…" : "Connect"}
        </button>
        <button className="admin-btn-ghost admin-btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
