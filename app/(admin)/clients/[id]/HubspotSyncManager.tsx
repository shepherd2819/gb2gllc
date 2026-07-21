"use client";
import { useState } from "react";

type HubspotSourceConfig = {
  spiro_source_id?: string;
  hubspot_object_type?: string;
  hubspot_id_property?: string;
  association_type_id?: number;
  cutoff_date?: string;
  last_order_sync_at?: string;
  last_order_sync_error?: string | null;
};

type SchemaOption = { objectTypeId: string; name: string; labelSingular: string; properties: string[] };

type Props = {
  clientId: string;
  hubspotSourceId: string | null;
  initialConfig: HubspotSourceConfig;
  hasSecret: boolean;
  spiroSources: { id: string; label: string }[];
  stats: { matched: number; unmatched: number };
};

export function HubspotSyncManager({ clientId, hubspotSourceId, initialConfig, hasSecret, spiroSources, stats }: Props) {
  const [config, setConfig] = useState<HubspotSourceConfig>(initialConfig);
  const [spiroSourceId, setSpiroSourceId] = useState(config.spiro_source_id ?? "");
  const [cutoffDate, setCutoffDate] = useState(config.cutoff_date ?? new Date().toISOString().slice(0, 10));
  const [schemas, setSchemas] = useState<SchemaOption[] | null>(null);
  const [selectedObjectTypeId, setSelectedObjectTypeId] = useState("");
  const [relinking, setRelinking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  function flash(text: string, tone: "ok" | "err") {
    setMsg({ text, tone });
    setTimeout(() => setMsg(null), 5000);
  }

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/clients/${clientId}/hubspot-sync`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { ok: res.ok, data };
  }

  async function savePairing() {
    if (!spiroSourceId) { flash("Pick a Spiro source", "err"); return; }
    setBusy("pairing");
    const { ok, data } = await patch({ spiro_source_id: spiroSourceId, cutoff_date: cutoffDate });
    setBusy(null);
    if (ok) { setConfig(data.config); flash("Saved", "ok"); }
    else flash(data.error || "Failed to save", "err");
  }

  async function introspect() {
    setBusy("introspect");
    const { ok, data } = await patch({ action: "introspect" });
    setBusy(null);
    if (ok) { setSchemas(data.schemas); flash(`Found ${data.schemas.length} object(s)`, "ok"); }
    else flash(data.error || "Introspection failed", "err");
  }

  async function selectSchema() {
    if (!selectedObjectTypeId) { flash("Pick an object", "err"); return; }
    setBusy("select");
    const { ok, data } = await patch({ action: "select_schema", objectTypeId: selectedObjectTypeId });
    setBusy(null);
    if (ok) { setConfig(data.config); setSchemas(null); setRelinking(false); flash("Object linked — ready to sync", "ok"); }
    else flash(data.error || "Failed to link object", "err");
  }

  async function syncNow() {
    setBusy("sync");
    const res = await fetch(`/api/admin/clients/${clientId}/hubspot-sync`, { method: "POST" });
    setBusy(null);
    flash(res.ok ? "Sync queued" : "Failed to queue sync", res.ok ? "ok" : "err");
  }

  if (!hubspotSourceId) {
    return (
      <div className="admin-card">
        <div className="admin-card-head"><h2>HubSpot Order Sync</h2></div>
        <div className="admin-empty">Add a HubSpot source in the Analytics section above (paste a Private App token), then come back here to configure the sync.</div>
      </div>
    );
  }

  const paired = !!config.spiro_source_id;
  const linked = !!config.hubspot_object_type;

  return (
    <div className="admin-card">
      <div className="admin-card-head"><h2>HubSpot Order Sync</h2></div>

      {!hasSecret && <div className="admin-empty">Paste a HubSpot Private App token in the Analytics section above first.</div>}

      {hasSecret && !paired && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label>Spiro source to pull orders from</label>
            <select className="admin-select" style={{ marginBottom: 0 }} value={spiroSourceId} onChange={(e) => setSpiroSourceId(e.target.value)}>
              <option value="">Select…</option>
              {spiroSources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label>Go-live cutoff date <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>— only orders submitted on/after this date ever sync, no backfill</span></label>
            <input className="admin-input" style={{ marginBottom: 0 }} type="date" value={cutoffDate} onChange={(e) => setCutoffDate(e.target.value)} />
          </div>
          <button className="admin-btn admin-btn-sm" disabled={busy === "pairing"} onClick={savePairing} style={{ alignSelf: "flex-start" }}>
            {busy === "pairing" ? "Saving…" : "Save pairing"}
          </button>
        </div>
      )}

      {hasSecret && paired && (!linked || relinking) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: "var(--text-mute)" }}>
            {linked ? "Re-linking the Orders object." : 'Paired to a Spiro source. Next: link HubSpot’s existing "Orders" object.'}
          </div>
          <button className="admin-btn admin-btn-sm" disabled={busy === "introspect"} onClick={introspect} style={{ alignSelf: "flex-start" }}>
            {busy === "introspect" ? "Looking…" : "Find Orders object"}
          </button>
          {schemas && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <select className="admin-select" style={{ marginBottom: 0 }} value={selectedObjectTypeId} onChange={(e) => setSelectedObjectTypeId(e.target.value)}>
                <option value="">Select the Orders object…</option>
                {schemas.map((s) => <option key={s.objectTypeId} value={s.objectTypeId}>{s.labelSingular} ({s.objectTypeId})</option>)}
              </select>
              <button className="admin-btn admin-btn-sm" disabled={busy === "select"} onClick={selectSchema} style={{ alignSelf: "flex-start" }}>
                {busy === "select" ? "Linking…" : "Use this object"}
              </button>
            </div>
          )}
          {linked && (
            <button className="admin-btn-ghost admin-btn-sm" onClick={() => { setRelinking(false); setSchemas(null); }} style={{ alignSelf: "flex-start" }}>
              Cancel
            </button>
          )}
        </div>
      )}

      {hasSecret && paired && linked && !relinking && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--text-mute)" }}>
            {config.last_order_sync_at ? `last synced ${new Date(config.last_order_sync_at).toLocaleString()}` : "never synced"}
          </div>
          {config.last_order_sync_error && <div style={{ fontSize: 12, color: "var(--red)" }}>{config.last_order_sync_error}</div>}
          <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
            <span>{stats.matched} matched</span>
            <span style={{ color: "var(--text-mute)" }}>{stats.unmatched} unmatched</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="admin-btn-ghost admin-btn-sm" disabled={busy === "sync"} onClick={syncNow} style={{ alignSelf: "flex-start" }}>
              {busy === "sync" ? "Queuing…" : "Sync now"}
            </button>
            <button className="admin-btn-ghost admin-btn-sm" onClick={() => setRelinking(true)} style={{ alignSelf: "flex-start" }}>
              Change object
            </button>
          </div>
        </div>
      )}

      {msg && <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: msg.tone === "ok" ? "var(--sage)" : "var(--red)", marginTop: 10 }}>{msg.text}</div>}
    </div>
  );
}
