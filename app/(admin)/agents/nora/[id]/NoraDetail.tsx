"use client";
import { useState } from "react";

type Account = { id: string; label: string; stripe_account_id: string | null; livemode: boolean; status: string };
type Event = {
  id: string;
  stripe_event_id: string;
  stripe_event_type: string;
  stripe_object_id: string | null;
  customer_email: string | null;
  customer_name: string | null;
  amount_cents: number | null;
  currency: string | null;
  category: string;
  severity: string;
  summary: string;
  draft_to_email: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  status: string;
  sent_at: string | null;
  alert_sent_at: string | null;
  created_at: string;
};
type Settings = {
  account_id: string;
  dunning_enabled: boolean;
  dunning_voice_notes: string | null;
  dunning_signature: string | null;
  urgent_alert_categories: string[];
  delivery_email: string | null;
  weekly_digest_enabled: boolean;
  weekly_digest_dow: number;
  weekly_digest_local_hour: number;
  timezone: string;
  monthly_burn_cents: number | null;
};
type Digest = { id: string; period_start: string; period_end: string; sent_at: string | null; markdown: string };

const SEV_COLOR: Record<string, string> = { critical: "#be5050", warn: "#b07a3a", info: "#5a7a8a" };
const CAT_LABEL: Record<string, string> = {
  payment_failed: "payment failed",
  subscription_canceled: "canceled",
  subscription_past_due: "past due",
  charge_disputed: "dispute",
  charge_refunded: "refund",
  payout_failed: "payout failed",
  invoice_upcoming: "upcoming",
  new_subscription: "new sub",
  other: "other",
};
const ALL_CATEGORIES = ["payment_failed", "subscription_canceled", "subscription_past_due", "charge_disputed", "charge_refunded", "payout_failed", "invoice_upcoming", "new_subscription", "other"];
const STATUS_FILTERS = ["open", "classified", "sent", "acknowledged", "dismissed", "all"];

export function NoraDetail({
  account, initialEvents, settings, digests, currentStatus, preselectEventId,
}: {
  account: Account;
  initialEvents: Event[];
  settings: Settings;
  digests: Digest[];
  currentStatus: string;
  preselectEventId: string | null;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [selectedId, setSelectedId] = useState<string | null>(preselectEventId ?? initialEvents[0]?.id ?? null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDigests, setShowDigests] = useState(false);

  const selected = events.find((e) => e.id === selectedId) ?? null;
  function updateEvent(id: string, patch: Partial<Event>) {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function setFilter(value: string) {
    const params = new URLSearchParams();
    if (value !== "open") params.set("status", value);
    const qs = params.toString();
    window.location.href = `/agents/nora/${account.id}${qs ? `?${qs}` : ""}`;
  }

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1>💰 {account.label}</h1>
          <span className="client-email">
            {account.livemode ? "live mode" : "test mode"} · {account.stripe_account_id ?? "(unknown acct)"} ·{" "}
            <a href="/agents/nora" className="at-link">← All accounts</a>
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="admin-btn-ghost admin-btn-sm" onClick={() => setShowDigests(!showDigests)}>
            {showDigests ? "Hide digests" : `Digests (${digests.length})`}
          </button>
          <button className="admin-btn-ghost admin-btn-sm" onClick={() => setShowSettings(!showSettings)}>
            {showSettings ? "Hide settings" : "Settings"}
          </button>
        </div>
      </div>

      {showSettings && <SettingsPanel accountId={account.id} initial={settings} onClose={() => setShowSettings(false)} />}
      {showDigests && <DigestsPanel digests={digests} onClose={() => setShowDigests(false)} />}

      {/* Filter bar */}
      <div className="admin-card" style={{ padding: 12, marginBottom: 14, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-mute)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Status</span>
          <select value={currentStatus} onChange={(e) => setFilter(e.target.value)} className="admin-input" style={{ width: "auto", marginBottom: 0, padding: "4px 8px", fontSize: 12 }}>
            {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-mute)" }}>
          {events.length} event{events.length === 1 ? "" : "s"}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 380px) 1fr", gap: 14 }}>
        <div className="admin-card" style={{ padding: 0, overflow: "hidden", maxHeight: "75vh", overflowY: "auto" }}>
          {events.length === 0 ? (
            <div className="admin-empty" style={{ padding: 20 }}>No events. They&apos;ll appear here as Stripe webhooks come in (or once you hit <strong>Reconcile</strong>).</div>
          ) : (
            events.map((e) => (
              <button
                key={e.id}
                onClick={() => setSelectedId(e.id)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "10px 12px", borderBottom: "1px solid rgba(28,30,27,0.06)",
                  background: selectedId === e.id ? "rgba(28,30,27,0.05)" : "transparent",
                  border: "none", cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 9, color: "white", background: SEV_COLOR[e.severity] ?? "#5a5a5a", padding: "1px 6px", borderRadius: 3, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>
                    {CAT_LABEL[e.category] ?? e.category}
                  </span>
                  {e.status === "sent" && <span style={{ fontSize: 9, color: "#2c7a4a", fontFamily: "var(--mono)" }}>✓ sent</span>}
                  {e.status === "dismissed" && <span style={{ fontSize: 9, color: "var(--text-mute)", fontFamily: "var(--mono)" }}>dismissed</span>}
                  {e.draft_body && e.status === "classified" && <span style={{ fontSize: 9, color: "#b07a3a", fontFamily: "var(--mono)" }}>· draft ready</span>}
                  <span style={{ fontSize: 10, color: "var(--text-mute)", marginLeft: "auto", fontFamily: "var(--mono)" }}>
                    {new Date(e.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.summary}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-mute)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.customer_name ? `${e.customer_name} · ${e.customer_email}` : e.customer_email ?? "(no customer)"}
                </div>
              </button>
            ))
          )}
        </div>

        {selected ? (
          <EventDetail key={selected.id} account={account} event={selected} onUpdate={(patch) => updateEvent(selected.id, patch)} />
        ) : (
          <div className="admin-card" style={{ padding: 24 }}><div className="admin-empty">Select an event on the left.</div></div>
        )}
      </div>
    </>
  );
}

// ─── Event detail ───────────────────────────────────────────────────────
function EventDetail({ account, event, onUpdate }: { account: Account; event: Event; onUpdate: (p: Partial<Event>) => void }) {
  const [subject, setSubject] = useState(event.draft_subject ?? "");
  const [body,    setBody]    = useState(event.draft_body ?? "");
  const [to,      setTo]      = useState(event.draft_to_email ?? event.customer_email ?? "");
  const [busy, setBusy] = useState<"" | "save" | "send" | "ack" | "dismiss">("");
  const dirty = subject !== (event.draft_subject ?? "") || body !== (event.draft_body ?? "") || to !== (event.draft_to_email ?? event.customer_email ?? "");

  async function save() {
    setBusy("save");
    const res = await fetch(`/api/admin/nora/events/${event.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft_subject: subject, draft_body: body, draft_to_email: to }) });
    setBusy("");
    if (res.ok) onUpdate({ draft_subject: subject, draft_body: body, draft_to_email: to });
  }
  async function send() {
    if (!confirm(`Send dunning email to ${to}?`)) return;
    if (dirty) await save();
    setBusy("send");
    const res = await fetch(`/api/admin/nora/events/${event.id}/send`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setBusy("");
    if (res.ok) onUpdate({ status: "sent", sent_at: new Date().toISOString() });
    else alert(`Send failed: ${j.error ?? res.statusText}`);
  }
  async function ackOrDismiss(next: "acknowledged" | "dismissed") {
    setBusy(next === "acknowledged" ? "ack" : "dismiss");
    const res = await fetch(`/api/admin/nora/events/${event.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
    setBusy("");
    if (res.ok) onUpdate({ status: next });
  }

  const stripeLink = stripeDashboardLink(account.livemode, event.stripe_object_id);

  return (
    <div className="admin-card" style={{ padding: 20, maxHeight: "75vh", overflowY: "auto" }}>
      <div style={{ borderBottom: "1px solid rgba(28,30,27,0.08)", paddingBottom: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "white", background: SEV_COLOR[event.severity] ?? "#5a5a5a", padding: "2px 8px", borderRadius: 3, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>
            {CAT_LABEL[event.category] ?? event.category}
          </span>
          <span className={`status-chip ${event.status === "sent" ? "active" : event.status === "dismissed" ? "paused" : "active"}`}>{event.status}</span>
          {stripeLink && (
            <a href={stripeLink} target="_blank" rel="noopener noreferrer" className="at-link" style={{ marginLeft: "auto", fontSize: 12 }}>
              View in Stripe ↗
            </a>
          )}
        </div>
        <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 500 }}>{event.summary}</h2>
        <div style={{ fontSize: 12, color: "var(--text-mute)", fontFamily: "var(--mono)" }}>
          {event.stripe_event_type} · {event.stripe_event_id}
        </div>
        {(event.customer_email || event.customer_name) && (
          <div style={{ marginTop: 6, fontSize: 12 }}>
            <strong>Customer:</strong> {event.customer_name ? `${event.customer_name} <${event.customer_email}>` : event.customer_email}
          </div>
        )}
      </div>

      {/* Draft editor */}
      {event.draft_body !== null || event.draft_subject !== null ? (
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)", marginBottom: 6 }}>
            Dunning draft {dirty && <span style={{ marginLeft: 8, color: "var(--orange, #b07a3a)" }}>● unsaved</span>}
          </div>
          <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>To</label>
              <input value={to} onChange={(e) => setTo(e.target.value)} className="admin-input" style={{ marginTop: 4, fontFamily: "var(--mono)", fontSize: 12 }} />
            </div>
            <div>
              <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Subject</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="admin-input" style={{ marginTop: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Body</label>
              <textarea
                value={body} onChange={(e) => setBody(e.target.value)}
                rows={Math.max(6, Math.min(20, body.split("\n").length + 1))}
                className="admin-input"
                style={{ marginTop: 4, fontFamily: "var(--mono)", fontSize: 13, lineHeight: 1.55, resize: "vertical" }}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="admin-btn admin-btn-sm" onClick={send} disabled={busy !== "" || !body.trim() || event.status === "sent" || !to}>
              {busy === "send" ? "Sending…" : event.status === "sent" ? "Sent" : "Send dunning"}
            </button>
            <button className="admin-btn-ghost admin-btn-sm" onClick={save} disabled={busy !== "" || !dirty}>
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
            <button className="admin-btn-ghost admin-btn-sm" onClick={() => ackOrDismiss("acknowledged")} disabled={busy !== "" || event.status === "acknowledged"}>
              Acknowledge
            </button>
            <button className="admin-btn-ghost admin-btn-sm" onClick={() => ackOrDismiss("dismissed")} disabled={busy !== "" || event.status === "dismissed"}>
              Dismiss
            </button>
          </div>
        </div>
      ) : (
        <div className="admin-empty" style={{ padding: 16 }}>
          No dunning draft for this event category. Use the buttons to acknowledge or dismiss.
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button className="admin-btn-ghost admin-btn-sm" onClick={() => ackOrDismiss("acknowledged")} disabled={busy !== "" || event.status === "acknowledged"}>Acknowledge</button>
            <button className="admin-btn-ghost admin-btn-sm" onClick={() => ackOrDismiss("dismissed")} disabled={busy !== "" || event.status === "dismissed"}>Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Settings panel ─────────────────────────────────────────────────────
function SettingsPanel({ accountId, initial, onClose }: { accountId: string; initial: Settings; onClose: () => void }) {
  const [dunning, setDunning] = useState(initial.dunning_enabled);
  const [voice, setVoice] = useState(initial.dunning_voice_notes ?? "");
  const [sig, setSig] = useState(initial.dunning_signature ?? "");
  const [urgent, setUrgent] = useState<string[]>(initial.urgent_alert_categories);
  const [delivery, setDelivery] = useState(initial.delivery_email ?? "");
  const [digestEnabled, setDigestEnabled] = useState(initial.weekly_digest_enabled);
  const [dow, setDow] = useState(initial.weekly_digest_dow);
  const [hour, setHour] = useState(initial.weekly_digest_local_hour);
  const [tz, setTz] = useState(initial.timezone);
  const [burnDollars, setBurnDollars] = useState(initial.monthly_burn_cents ? (initial.monthly_burn_cents / 100).toString() : "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggleCat(c: string) {
    setUrgent(urgent.includes(c) ? urgent.filter((x) => x !== c) : [...urgent, c]);
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/admin/nora/accounts/${accountId}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dunning_enabled: dunning,
        dunning_voice_notes: voice,
        dunning_signature: sig,
        urgent_alert_categories: urgent,
        delivery_email: delivery || null,
        weekly_digest_enabled: digestEnabled,
        weekly_digest_dow: dow,
        weekly_digest_local_hour: hour,
        timezone: tz,
        monthly_burn_cents: burnDollars ? Math.round(Number(burnDollars) * 100) : null,
      }),
    });
    setBusy(false);
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  }

  const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="admin-card" style={{ padding: 18, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Nora settings</h3>
        <button className="admin-btn-ghost admin-btn-sm" onClick={onClose}>Close</button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={dunning} onChange={(e) => { setDunning(e.target.checked); setSaved(false); }} />
          Auto-draft dunning emails (you still click Send)
        </label>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>
          Dunning voice notes
        </label>
        <textarea
          value={voice}
          onChange={(e) => { setVoice(e.target.value); setSaved(false); }}
          rows={3} className="admin-input"
          placeholder="e.g. Warm but direct. Mention 'God bless' in closing. Never pressure."
          style={{ marginTop: 6, fontSize: 13 }}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>
          Signature (appended to drafts)
        </label>
        <textarea
          value={sig} onChange={(e) => { setSig(e.target.value); setSaved(false); }}
          rows={3} className="admin-input"
          placeholder={"John\nGB2GLLC · gb2gllc.com"}
          style={{ marginTop: 6, fontSize: 13, fontFamily: "var(--mono)" }}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>
          Categories that trigger an immediate alert email
        </label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {ALL_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => toggleCat(c)}
              style={{
                fontSize: 11, padding: "4px 10px", borderRadius: 3,
                border: urgent.includes(c) ? "none" : "1px solid var(--border, rgba(28,30,27,0.15))",
                background: urgent.includes(c) ? (SEV_COLOR.critical) : "transparent",
                color: urgent.includes(c) ? "white" : "var(--text)",
                cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em",
              }}
            >{CAT_LABEL[c] ?? c}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div>
          <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Digest day</label>
          <select value={dow} onChange={(e) => { setDow(Number(e.target.value)); setSaved(false); }} className="admin-input" style={{ marginTop: 6 }} disabled={!digestEnabled}>
            {DOW_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Hour (local)</label>
          <input type="number" min={0} max={23} value={hour} onChange={(e) => { setHour(Number(e.target.value)); setSaved(false); }} className="admin-input" style={{ marginTop: 6 }} disabled={!digestEnabled} />
        </div>
        <div>
          <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Timezone (IANA)</label>
          <input type="text" value={tz} onChange={(e) => { setTz(e.target.value); setSaved(false); }} className="admin-input" style={{ marginTop: 6, fontFamily: "var(--mono)", fontSize: 12 }} placeholder="America/Chicago" />
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={digestEnabled} onChange={(e) => { setDigestEnabled(e.target.checked); setSaved(false); }} />
          Weekly cash digest enabled
        </label>
      </div>

      <div style={{ marginBottom: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Deliver alerts + digest to</label>
          <input type="email" value={delivery} onChange={(e) => { setDelivery(e.target.value); setSaved(false); }} className="admin-input" placeholder="john@gb2gllc.com" style={{ marginTop: 6 }} />
        </div>
        <div>
          <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>Monthly burn estimate ($)</label>
          <input type="number" min={0} step={100} value={burnDollars} onChange={(e) => { setBurnDollars(e.target.value); setSaved(false); }} className="admin-input" placeholder="for runway calc — optional" style={{ marginTop: 6, fontFamily: "var(--mono)" }} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="admin-btn admin-btn-sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
        {saved && <span style={{ fontSize: 12, color: "var(--green, #3c8c5a)" }}>✓ Saved</span>}
      </div>
    </div>
  );
}

// ─── Digests history panel ──────────────────────────────────────────────
function DigestsPanel({ digests, onClose }: { digests: Digest[]; onClose: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="admin-card" style={{ padding: 18, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Recent digests</h3>
        <button className="admin-btn-ghost admin-btn-sm" onClick={onClose}>Close</button>
      </div>

      {digests.length === 0 ? (
        <div className="admin-empty">No digests yet. The first one will fire on your configured day/hour.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {digests.map((d) => (
            <div key={d.id} style={{ border: "1px solid rgba(28,30,27,0.08)", padding: 10, borderRadius: 4 }}>
              <button
                onClick={() => setOpenId(openId === d.id ? null : d.id)}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontFamily: "inherit", color: "var(--text)", display: "flex", alignItems: "center", gap: 8, width: "100%" }}
              >
                <span>{openId === d.id ? "▼" : "▶"}</span>
                <span>{new Date(d.period_start).toLocaleDateString()} – {new Date(d.period_end).toLocaleDateString()}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-mute)", fontFamily: "var(--mono)" }}>
                  {d.sent_at ? `sent ${new Date(d.sent_at).toLocaleString()}` : "not sent"}
                </span>
              </button>
              {openId === d.id && (
                <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: 1.55, padding: 12, background: "rgba(28,30,27,0.03)", borderRadius: 3 }}>
                  {d.markdown}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function stripeDashboardLink(livemode: boolean, objId: string | null): string | null {
  if (!objId) return null;
  const base = livemode ? "https://dashboard.stripe.com" : "https://dashboard.stripe.com/test";
  if (objId.startsWith("in_"))  return `${base}/invoices/${objId}`;
  if (objId.startsWith("ch_"))  return `${base}/payments/${objId}`;
  if (objId.startsWith("sub_")) return `${base}/subscriptions/${objId}`;
  if (objId.startsWith("dp_") || objId.startsWith("du_")) return `${base}/disputes/${objId}`;
  if (objId.startsWith("po_"))  return `${base}/payouts/${objId}`;
  return null;
}
