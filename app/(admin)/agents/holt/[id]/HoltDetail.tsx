"use client";
import { useState } from "react";

type Account = { id: string; email_address: string; timezone: string | null; status: string };
type Briefing = {
  id: string;
  event_summary: string | null;
  event_start_at: string;
  event_end_at: string | null;
  event_location: string | null;
  external_attendees: { email: string; name: string | null; company: string | null }[];
  decision: string;
  prebrief_sent_at: string | null;
  evening_sent_at: string | null;
  briefing_markdown: string | null;
  generate_error: string | null;
};
type Settings = {
  account_id: string;
  internal_domains: string[];
  evening_digest_enabled: boolean;
  evening_digest_local_hour: number;
  prebrief_minutes_before: number;
  enable_web_research: boolean;
  voice_notes: string | null;
  delivery_email: string | null;
};

const DECISION_LABEL: Record<string, { label: string; color: string }> = {
  briefable:         { label: "external",  color: "#2c7a4a" },
  skipped_internal:  { label: "internal",  color: "#5a5a8a" },
  skipped_solo:      { label: "focus",     color: "#8a8a4a" },
  skipped_declined:  { label: "declined",  color: "#8a4a4a" },
  pending:           { label: "pending",   color: "#5a5a5a" },
};

export function HoltDetail({ account, briefings, settings }: { account: Account; briefings: Briefing[]; settings: Settings }) {
  const [selectedId, setSelectedId] = useState<string | null>(briefings[0]?.id ?? null);
  const [showSettings, setShowSettings] = useState(false);
  const selected = briefings.find((b) => b.id === selectedId) ?? null;

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1>🗓️ {account.email_address}</h1>
          <span className="client-email">
            {account.timezone ?? "tz unknown"} · <a href="/agents/holt" className="at-link">← All calendars</a>
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="admin-btn-ghost admin-btn-sm" onClick={() => setShowSettings(!showSettings)}>
            {showSettings ? "Hide settings" : "Settings"}
          </button>
        </div>
      </div>

      {showSettings && (
        <SettingsPanel accountId={account.id} initial={settings} onClose={() => setShowSettings(false)} />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 380px) 1fr", gap: 14 }}>
        {/* Briefings list */}
        <div className="admin-card" style={{ padding: 0, overflow: "hidden", maxHeight: "75vh", overflowY: "auto" }}>
          {briefings.length === 0 ? (
            <div className="admin-empty" style={{ padding: 20 }}>No briefings yet. Click <strong>Run now</strong> from the previous page once you have a meeting coming up.</div>
          ) : (
            briefings.map((b) => {
              const dec = DECISION_LABEL[b.decision] ?? DECISION_LABEL.pending;
              const sent = b.prebrief_sent_at || b.evening_sent_at;
              const isFuture = new Date(b.event_start_at).getTime() > Date.now();
              return (
                <button
                  key={b.id}
                  onClick={() => setSelectedId(b.id)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "10px 12px", borderBottom: "1px solid rgba(28,30,27,0.06)",
                    background: selectedId === b.id ? "rgba(28,30,27,0.05)" : "transparent",
                    border: "none", cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 9, color: "white", background: dec.color, padding: "1px 6px", borderRadius: 3, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>{dec.label}</span>
                    {sent && <span style={{ fontSize: 9, color: "#2c7a4a", fontFamily: "var(--mono)" }}>✓ sent</span>}
                    {b.generate_error && <span style={{ fontSize: 9, color: "#be5050", fontFamily: "var(--mono)" }}>! error</span>}
                    <span style={{ fontSize: 10, color: isFuture ? "var(--text)" : "var(--text-mute)", marginLeft: "auto", fontFamily: "var(--mono)" }}>
                      {new Date(b.event_start_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {b.event_summary || "(no title)"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-mute)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {b.external_attendees.length > 0
                      ? b.external_attendees.map((a) => a.name ?? a.email).join(", ")
                      : "(no external attendees)"}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {selected ? <BriefingDetail key={selected.id} briefing={selected} /> : (
          <div className="admin-card" style={{ padding: 24 }}>
            <div className="admin-empty">Select a meeting on the left.</div>
          </div>
        )}
      </div>
    </>
  );
}

function BriefingDetail({ briefing }: { briefing: Briefing }) {
  const [busy, setBusy] = useState(false);

  async function regenerate() {
    if (!confirm("Regenerate this briefing and re-send it?")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/holt/briefings/${briefing.id}/regenerate`, { method: "POST" });
    setBusy(false);
    if (res.ok) window.location.reload();
    else { const j = await res.json().catch(() => ({})); alert(`Regenerate failed: ${j.error ?? res.statusText}`); }
  }

  const dec = DECISION_LABEL[briefing.decision] ?? DECISION_LABEL.pending;

  return (
    <div className="admin-card" style={{ padding: 20, maxHeight: "75vh", overflowY: "auto" }}>
      <div style={{ borderBottom: "1px solid rgba(28,30,27,0.08)", paddingBottom: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: "white", background: dec.color, padding: "2px 8px", borderRadius: 3, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>{dec.label}</span>
          {briefing.prebrief_sent_at && <span className="status-chip active">prebrief sent</span>}
          {briefing.evening_sent_at && <span className="status-chip active">in digest</span>}
          {briefing.decision === "briefable" && !briefing.prebrief_sent_at && !briefing.evening_sent_at && <span className="status-chip paused">queued</span>}
          {briefing.decision === "briefable" && (
            <button className="admin-btn-ghost admin-btn-sm" onClick={regenerate} disabled={busy} style={{ marginLeft: "auto" }}>
              {busy ? "Regenerating…" : "Regenerate + resend"}
            </button>
          )}
        </div>
        <h2 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 500 }}>{briefing.event_summary || "(no title)"}</h2>
        <div style={{ fontSize: 12, color: "var(--text-mute)", fontFamily: "var(--mono)" }}>
          {new Date(briefing.event_start_at).toLocaleString()}
          {briefing.event_end_at && <> → {new Date(briefing.event_end_at).toLocaleString()}</>}
          {briefing.event_location && <> · {briefing.event_location}</>}
        </div>
        {briefing.external_attendees.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-mute)" }}>
            <strong>Attendees:</strong> {briefing.external_attendees.map((a) => a.name ? `${a.name} (${a.email})` : a.email).join(", ")}
          </div>
        )}
      </div>

      {briefing.generate_error && (
        <div style={{ marginBottom: 14, padding: 10, background: "rgba(190,80,80,0.08)", fontSize: 12, color: "var(--red, #be5050)", fontFamily: "var(--mono)" }}>
          {briefing.generate_error}
        </div>
      )}

      {briefing.briefing_markdown ? (
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          {briefing.briefing_markdown}
        </pre>
      ) : briefing.decision === "briefable" ? (
        <div className="admin-empty" style={{ padding: 20 }}>
          Brief hasn't been generated yet. The cron runs every 15 minutes; or click <strong>Run now</strong> from the previous page to trigger immediately.
        </div>
      ) : (
        <div className="admin-empty" style={{ padding: 20 }}>
          Holt skipped this one because it's <strong>{dec.label}</strong>.
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ accountId, initial, onClose }: { accountId: string; initial: Settings; onClose: () => void }) {
  const [internalDomains, setInternalDomains] = useState(initial.internal_domains.join("\n"));
  const [eveningEnabled, setEveningEnabled] = useState(initial.evening_digest_enabled);
  const [eveningHour, setEveningHour] = useState(initial.evening_digest_local_hour);
  const [prebriefMin, setPrebriefMin] = useState(initial.prebrief_minutes_before);
  const [webResearch, setWebResearch] = useState(initial.enable_web_research);
  const [voiceNotes, setVoiceNotes] = useState(initial.voice_notes ?? "");
  const [deliveryEmail, setDeliveryEmail] = useState(initial.delivery_email ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/admin/holt/accounts/${accountId}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        internal_domains: internalDomains.split("\n").map((s) => s.trim()).filter(Boolean),
        evening_digest_enabled: eveningEnabled,
        evening_digest_local_hour: eveningHour,
        prebrief_minutes_before: prebriefMin,
        enable_web_research: webResearch,
        voice_notes: voiceNotes,
        delivery_email: deliveryEmail || null,
      }),
    });
    setBusy(false);
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  }

  return (
    <div className="admin-card" style={{ padding: 18, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Holt settings</h3>
        <button className="admin-btn-ghost admin-btn-sm" onClick={onClose}>Close</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>
            Prebrief minutes before
          </label>
          <input
            type="number" min={15} max={720} step={15}
            value={prebriefMin}
            onChange={(e) => { setPrebriefMin(Number(e.target.value)); setSaved(false); }}
            className="admin-input" style={{ marginTop: 6 }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>
            Evening digest hour (local, 0-23)
          </label>
          <input
            type="number" min={0} max={23}
            value={eveningHour}
            onChange={(e) => { setEveningHour(Number(e.target.value)); setSaved(false); }}
            className="admin-input" style={{ marginTop: 6 }}
            disabled={!eveningEnabled}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={eveningEnabled} onChange={(e) => { setEveningEnabled(e.target.checked); setSaved(false); }} />
          Evening digest enabled
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={webResearch} onChange={(e) => { setWebResearch(e.target.checked); setSaved(false); }} />
          Web research enabled (Claude searches LinkedIn / news)
        </label>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>
          Internal email domains (one per line — attendees on these domains are treated as teammates and skipped)
        </label>
        <textarea
          value={internalDomains}
          onChange={(e) => { setInternalDomains(e.target.value); setSaved(false); }}
          rows={3}
          className="admin-input"
          placeholder="gb2gllc.com"
          style={{ marginTop: 6, fontSize: 12, fontFamily: "var(--mono)" }}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>
          Voice notes for brief writer
        </label>
        <textarea
          value={voiceNotes}
          onChange={(e) => { setVoiceNotes(e.target.value); setSaved(false); }}
          rows={3}
          className="admin-input"
          placeholder="e.g. Direct, no fluff. Always include 1 question that's slightly bold. Mention shared connections when found."
          style={{ marginTop: 6, fontSize: 13 }}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-mute)" }}>
          Deliver to (default: connected account)
        </label>
        <input
          type="email"
          value={deliveryEmail}
          onChange={(e) => { setDeliveryEmail(e.target.value); setSaved(false); }}
          className="admin-input"
          placeholder="john@gb2gllc.com"
          style={{ marginTop: 6, fontSize: 13 }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="admin-btn admin-btn-sm" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
        {saved && <span style={{ fontSize: 12, color: "var(--green, #3c8c5a)" }}>✓ Saved</span>}
      </div>
    </div>
  );
}
