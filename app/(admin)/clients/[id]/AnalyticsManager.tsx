"use client";
import { useEffect, useState } from "react";
import { Badge, StatusPill } from "@/components/ui";

type Source = {
  id: string;
  kind: "mcp" | "rest";
  provider: string;
  label: string;
  config: Record<string, unknown>;
  status: "active" | "paused" | "error";
  last_sync_at: string | null;
  last_sync_error: string | null;
  chat_tool_allowlist: string[];
  has_secret: boolean;
  // Derived server-side from secret_enc (never the bundle itself) — true
  // once an OAuth-mode source has completed the login flow at least once.
  has_tokens: boolean;
};

type Props = { clientId: string; initialSources: Source[]; digestEnabled: boolean; initialGoalRevenue: number | null };

const PROVIDERS = [
  { value: "spiro", label: "Spiro (REST)", kind: "rest" as const },
  { value: "spiro_mcp", label: "Spiro (MCP)", kind: "mcp" as const },
  { value: "generic_mcp", label: "Generic MCP", kind: "mcp" as const },
  { value: "hubspot", label: "HubSpot (REST)", kind: "rest" as const },
];

export function AnalyticsManager({ clientId, initialSources, digestEnabled, initialGoalRevenue }: Props) {
  const [sources, setSources] = useState<Source[]>(initialSources);
  const [digest, setDigest] = useState(digestEnabled);
  const [goalRevenue, setGoalRevenue] = useState(initialGoalRevenue != null ? String(initialGoalRevenue) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [tools, setTools] = useState<Record<string, string[]>>({});
  // Per-source pending value for the "rotate secret" input below — updates
  // the source in place (same id) rather than creating a duplicate row, so
  // anything referencing this source by id (e.g. hollis_lines.spiro_source_id,
  // a hubspot source's config.spiro_source_id) keeps working after a rotate.
  const [rotateValues, setRotateValues] = useState<Record<string, string>>({});

  const [provider, setProvider] = useState("spiro");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [authScheme, setAuthScheme] = useState("bearer");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [secret, setSecret] = useState("");
  // MCP-kind providers can connect via an interactive OAuth login (default
  // for spiro_mcp — Spiro's MCP only offers email/password + approve) or a
  // static bearer token. REST providers (spiro) only ever use a static key.
  const [authMode, setAuthMode] = useState<"oauth" | "static">("oauth");

  const kind = PROVIDERS.find((p) => p.value === provider)?.kind ?? "rest";
  const useOAuth = kind === "mcp" && authMode === "oauth";

  function flash(text: string, tone: "ok" | "err") {
    setMsg({ text, tone });
    setTimeout(() => setMsg(null), 4000);
  }

  // Picks up the ?analytics=connected|error flash the OAuth callback route
  // (app/api/admin/analytics/oauth/callback) redirects back with, then
  // scrubs it from the URL so a page refresh doesn't re-show it.
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const result = qs.get("analytics");
    if (!result) return;
    flash(result === "connected" ? "Connected — syncing will pick up the new source shortly" : "Connection failed — try again", result === "connected" ? "ok" : "err");
    qs.delete("analytics");
    const rest = qs.toString();
    window.history.replaceState({}, "", rest ? `${window.location.pathname}?${rest}` : window.location.pathname);
    // Runs once on mount only — this reads the URL exactly as it was on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addSource() {
    if (!label.trim()) { flash("Label is required", "err"); return; }
    setBusy("add");
    const config: Record<string, unknown> = provider === "spiro"
      ? { baseUrl, authScheme }
      : useOAuth
        ? { endpointUrl, authMode: "oauth" }
        : { endpointUrl };
    const body: Record<string, unknown> = { kind, provider, label, config };
    if (!useOAuth) body.secret = secret; // OAuth sources start with no secret — Connect / Log in supplies it
    const res = await fetch(`/api/admin/clients/${clientId}/analytics/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(null);
    if (res.ok) {
      setSources((s) => [...s, data.source as Source]);
      setLabel(""); setBaseUrl(""); setEndpointUrl(""); setSecret("");
      flash(useOAuth ? "Source added — click Connect / Log in below" : "Source added — run Test connection next", "ok");
    } else flash(data.error || "Failed to add source", "err");
  }

  async function testSource(id: string) {
    setBusy(`test:${id}`);
    const res = await fetch(`/api/admin/clients/${clientId}/analytics/sources/${id}/test`, { method: "POST" });
    const data = await res.json();
    setBusy(null);
    // The test route always answers HTTP 200 — success/failure lives in the
    // Result union's own `ok` field (data.ok), not the fetch-level res.ok.
    if (res.ok && data.ok) {
      if (Array.isArray(data.info?.toolNames)) setTools((t) => ({ ...t, [id]: data.info.toolNames as string[] }));
      flash(data.info?.detail ? `OK · ${data.info.detail}` : "Connection OK", "ok");
    } else flash(data.error || data.reason || "Connection failed", "err");
  }

  async function patchSource(id: string, body: Record<string, unknown>) {
    setBusy(`patch:${id}`);
    const res = await fetch(`/api/admin/clients/${clientId}/analytics/sources/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(null);
    if (res.ok) { setSources((s) => s.map((x) => (x.id === id ? { ...x, ...(data.source as Source) } : x))); flash("Saved", "ok"); }
    else flash(data.error || "Failed", "err");
  }

  async function removeSource(id: string) {
    if (!confirm("Remove this source? Its synced metrics are deleted too.")) return;
    setBusy(`del:${id}`);
    const res = await fetch(`/api/admin/clients/${clientId}/analytics/sources/${id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) { setSources((s) => s.filter((x) => x.id !== id)); flash("Removed", "ok"); }
    else flash("Failed to remove", "err");
  }

  async function syncNow(id?: string) {
    setBusy(`sync:${id ?? "all"}`);
    const res = await fetch(`/api/admin/clients/${clientId}/analytics/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { sourceId: id } : {}),
    });
    setBusy(null);
    flash(res.ok ? "Sync queued" : "Sync failed", res.ok ? "ok" : "err");
  }

  async function toggleDigest(next: boolean) {
    setDigest(next);
    const res = await fetch(`/api/admin/clients/${clientId}/analytics/digest`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    if (!res.ok) { setDigest(!next); flash("Failed to update digest", "err"); }
  }

  async function saveGoal() {
    const n = Number(goalRevenue);
    if (!Number.isFinite(n) || n < 0) { flash("Goal must be a number ≥ 0", "err"); return; }
    setBusy("goal");
    const res = await fetch(`/api/admin/clients/${clientId}/analytics/goal`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revenue: n }),
    });
    setBusy(null);
    flash(res.ok ? "Monthly goal saved" : "Failed to save goal", res.ok ? "ok" : "err");
  }

  async function rotateSecret(id: string) {
    const value = (rotateValues[id] ?? "").trim();
    if (!value) { flash("Enter a new secret first", "err"); return; }
    await patchSource(id, { secret: value });
    setRotateValues((r) => ({ ...r, [id]: "" }));
  }

  function toggleAllowlist(src: Source, tool: string) {
    const cur = new Set(src.chat_tool_allowlist ?? []);
    if (cur.has(tool)) cur.delete(tool); else cur.add(tool);
    void patchSource(src.id, { chat_tool_allowlist: [...cur] });
  }

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <h2>Analytics</h2>
        <a className="admin-card-action" href={`/clients/${clientId}/analytics`}>View dashboard →</a>
      </div>

      {sources.length === 0 ? (
        <div className="admin-empty">No data sources yet. Add one below to activate analytics for this client.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {sources.map((s) => (
            <div key={s.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--r)", padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{s.label}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mute)", marginTop: 2 }}>
                    <span>{s.provider} · {s.kind}</span>
                    <StatusPill status={s.status} />
                    {s.config?.authMode === "oauth" && (
                      <Badge tone={s.has_tokens ? "sage" : "gold"}>{s.has_tokens ? "Connected" : "Needs login"}</Badge>
                    )}
                    <span>{s.last_sync_at ? `synced ${new Date(s.last_sync_at).toLocaleString()}` : "never synced"}</span>
                    {s.has_secret && s.config?.authMode !== "oauth" && <span style={{ color: "var(--text-mute)" }}>· credential on file</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {s.config?.authMode === "oauth" && (
                    <a
                      className="admin-btn admin-btn-sm"
                      href={`/api/admin/clients/${clientId}/analytics/sources/${s.id}/oauth/start`}
                    >
                      {s.has_tokens ? "Reconnect" : "Connect / Log in"}
                    </a>
                  )}
                  <button className="admin-btn-ghost admin-btn-sm" disabled={busy === `test:${s.id}`} onClick={() => testSource(s.id)}>{busy === `test:${s.id}` ? "Testing…" : "Test"}</button>
                  {s.status === "active"
                    ? <button className="admin-btn-ghost admin-btn-sm" disabled={!!busy} onClick={() => patchSource(s.id, { action: "pause" })}>Pause</button>
                    : <button className="admin-btn admin-btn-sm" disabled={!!busy} onClick={() => patchSource(s.id, { action: "resume" })}>Resume</button>}
                  <button className="admin-btn-ghost admin-btn-sm" disabled={!!busy} onClick={() => syncNow(s.id)}>Sync now</button>
                  <button className="admin-btn-ghost admin-btn-sm" style={{ color: "var(--red)", borderColor: "var(--red)" }} disabled={!!busy} onClick={() => removeSource(s.id)}>Delete</button>
                </div>
              </div>
              {s.config?.authMode !== "oauth" && (
                <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                  <input
                    className="admin-input"
                    type="password"
                    autoComplete="new-password"
                    style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12, flex: 1 }}
                    value={rotateValues[s.id] ?? ""}
                    onChange={(e) => setRotateValues((r) => ({ ...r, [s.id]: e.target.value }))}
                    placeholder="New secret — rotates this source in place"
                  />
                  <button
                    className="admin-btn-ghost admin-btn-sm"
                    disabled={!!busy || !(rotateValues[s.id] ?? "").trim()}
                    onClick={() => rotateSecret(s.id)}
                  >
                    {busy === `patch:${s.id}` ? "Rotating…" : "Rotate"}
                  </button>
                </div>
              )}
              {s.last_sync_error && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 6 }}>{s.last_sync_error}</div>}
              {(tools[s.id]?.length ?? 0) > 0 && (
                <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--text-mute)", marginBottom: 6 }}>Chat tool allowlist (from last test)</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {tools[s.id].map((t) => (
                      <label key={t} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                        <input type="checkbox" checked={(s.chat_tool_allowlist ?? []).includes(t)} onChange={() => toggleAllowlist(s, t)} />
                        <span style={{ fontFamily: "var(--mono)" }}>{t}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="admin-card-head" style={{ marginTop: 8, marginBottom: 8, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <h2 style={{ fontSize: 14 }}>Add a source</h2>
      </div>
      <div className="admin-input-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label>Provider</label>
          <select
            className="admin-select"
            style={{ marginBottom: 0 }}
            value={provider}
            onChange={(e) => {
              const next = e.target.value;
              setProvider(next);
              setAuthMode(next === "spiro_mcp" ? "oauth" : "static");
            }}
          >
            {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label>Label</label>
          <input className="admin-input" style={{ marginBottom: 0 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Spiro — production" />
        </div>
      </div>
      {provider === "spiro" ? (
        <div className="admin-input-row" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <div>
            <label>Base URL</label>
            <input className="admin-input" style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.spiro.media" />
          </div>
          <div>
            <label>Auth scheme</label>
            <select className="admin-select" style={{ marginBottom: 0 }} value={authScheme} onChange={(e) => setAuthScheme(e.target.value)}>
              <option value="bearer">Bearer</option>
              <option value="apikey">API key header</option>
            </select>
          </div>
        </div>
      ) : provider === "hubspot" ? (
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-mute)" }}>
          HubSpot uses a Private App token only — generate one in HubSpot Settings → Integrations → Private Apps, then paste it below. No base URL or auth mode to configure.
        </div>
      ) : (
        <>
          <div className="admin-input-row" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <div>
              <label>Auth mode</label>
              <select className="admin-select" style={{ marginBottom: 0 }} value={authMode} onChange={(e) => setAuthMode(e.target.value as "oauth" | "static")}>
                <option value="oauth">OAuth login</option>
                <option value="static">Static token</option>
              </select>
            </div>
            <div>
              <label>MCP endpoint URL</label>
              <input className="admin-input" style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }} value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} placeholder="https://mcp.example.com/v1" />
            </div>
          </div>
        </>
      )}
      {useOAuth ? (
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-mute)" }}>
          No secret to enter here — after adding, use “Connect / Log in” below to authorize via the provider’s own login page. GB2G stores only the resulting refresh token, encrypted.
        </div>
      ) : (
        <div className="admin-input-row" style={{ marginTop: 12 }}>
          <label>Secret (API key / bearer token) <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>— write-only, stored encrypted</span></label>
          <input className="admin-input" type="password" autoComplete="new-password" style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••" />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button className="admin-btn admin-btn-sm" onClick={addSource} disabled={busy === "add"}>{busy === "add" ? "Adding…" : "Add source"}</button>
        {msg && <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: msg.tone === "ok" ? "var(--sage)" : "var(--red)" }}>{msg.text}</span>}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <div style={{ flex: "0 0 200px" }}>
          <label>Monthly revenue goal ($)</label>
          <input
            className="admin-input"
            style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }}
            type="number"
            min={0}
            step={1000}
            value={goalRevenue}
            onChange={(e) => setGoalRevenue(e.target.value)}
            placeholder="150000"
          />
        </div>
        <button className="admin-btn admin-btn-sm" disabled={busy === "goal"} onClick={saveGoal}>{busy === "goal" ? "Saving…" : "Save goal"}</button>
        <span style={{ fontSize: 11, color: "var(--text-mute)" }}>Powers the hero pace-to-goal ring. Blank / 0 → falls back to last-year pace.</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={digest} onChange={(e) => toggleDigest(e.target.checked)} />
          <span>Weekly email digest</span>
        </label>
        <button className="admin-btn-ghost admin-btn-sm" disabled={busy === "sync:all"} onClick={() => syncNow()}>{busy === "sync:all" ? "Queuing…" : "Sync all now"}</button>
      </div>
    </div>
  );
}
