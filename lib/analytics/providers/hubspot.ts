// lib/analytics/providers/hubspot.ts
//
// Registered ONLY so the nightly analytics-sync cron (which sweeps every
// active client_data_sources row regardless of provider) treats a
// provider='hubspot' row as a healthy no-op instead of a permanent "no
// adapter" error. The real order-attribution sync is a separate, dedicated
// job — lib/hubspot-sync/orchestrate.ts, driven by
// lib/inngest/functions/hubspot-order-sync.ts — NOT this adapter's sync().
// testConnection() still makes a real HubSpot call so the existing "Test"
// button in AnalyticsManager works for a hubspot source.

import type {
  ChatTool,
  ConnectionInfo,
  MetricRow,
  ProviderAdapter,
  Result,
  SourceCtx,
  SyncWindow,
} from "@/lib/analytics/types";

const HUBSPOT_BASE_URL = "https://api.hubapi.com";

function mapHubspotStatus(status: number): "auth" | "network" | "error" {
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "network";
  return "error";
}

function authHeaders(ctx: SourceCtx): Result<{ headers: Record<string, string> }> {
  if (!ctx.secret) {
    return { ok: false, kind: "config", reason: "HubSpot source has no Private App token configured" };
  }
  return { ok: true, headers: { Authorization: `Bearer ${ctx.secret}`, Accept: "application/json" } };
}

async function hubspotGet(ctx: SourceCtx, path: string): Promise<Result<{ json: unknown }>> {
  const auth = authHeaders(ctx);
  if (!auth.ok) return auth;
  let text: string;
  let status: number;
  let ok: boolean;
  try {
    const res = await fetch(`${HUBSPOT_BASE_URL}${path}`, { headers: auth.headers, cache: "no-store" });
    status = res.status;
    ok = res.ok;
    text = await res.text();
  } catch (e) {
    return { ok: false, kind: "network", reason: `Network error reaching HubSpot: ${(e as Error).message}` };
  }
  if (!ok) {
    return { ok: false, kind: mapHubspotStatus(status), reason: `HubSpot ${path} ${status}: ${text.slice(0, 200)}` };
  }
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, kind: "error", reason: `HubSpot ${path} returned non-JSON (status ${status})` };
  }
}

export const hubspotAdapter: ProviderAdapter = {
  provider: "hubspot",

  async testConnection(ctx: SourceCtx): Promise<Result<{ info: ConnectionInfo }>> {
    const r = await hubspotGet(ctx, "/crm/v3/objects/contacts?limit=1");
    if (!r.ok) return r;
    return { ok: true, info: { detail: "HubSpot token OK — contacts read access confirmed" } };
  },

  async sync(_ctx: SourceCtx, _window: SyncWindow): Promise<Result<{ rows: MetricRow[] }>> {
    return {
      ok: false,
      kind: "unsupported",
      reason: "HubSpot order-attribution sync runs on its own daily job, not the analytics warehouse sync",
    };
  },

  async chatTools(_ctx: SourceCtx): Promise<ChatTool[]> {
    return [];
  },
};
