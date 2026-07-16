// lib/inngest/functions/hubspot-order-sync.ts
//
// Daily HubSpot order-attribution sync for Elevated Productions (and any
// future client with a provider='hubspot' source). Triggered by cron (6am
// ET, staggered an hour after analytics-sync's 5am run so the two don't hit
// Spiro at the same moment) and by "crm/hubspot.sync_requested" (the admin
// "Sync now" button — one client). Concurrency keyed on clientId so an event
// run for the same client serializes. One durable step per source so a
// failing client never blocks another (Promise.allSettled — same pattern as
// analytics-sync.ts). Runtime deps are lazy-imported inside steps
// (hollis-call-completed / analytics-sync pattern).
import { inngest } from "@/lib/inngest/client";
import type { DataSourceRow } from "@/lib/analytics/types";

export const hubspotOrderSync = inngest.createFunction(
  {
    id: "hubspot-order-sync",
    name: "HubSpot: order attribution sync",
    concurrency: [{ key: "event.data.clientId", limit: 1 }],
    triggers: [
      { cron: "TZ=America/New_York 0 6 * * *" },
      { event: "crm/hubspot.sync_requested" },
    ],
  },
  async ({ event, step }) => {
    // Event runs scope to one client; cron runs (no event.data) cover all.
    const data = (event as { data?: { clientId?: unknown } }).data;
    const scopedClientId = typeof data?.clientId === "string" ? data.clientId : undefined;

    const sources = await step.run("load-sources", async () => {
      const { supabaseAdmin } = await import("@/lib/supabase");
      let query = supabaseAdmin
        .from("client_data_sources")
        .select("*")
        .eq("status", "active")
        .eq("provider", "hubspot");
      if (scopedClientId) query = query.eq("client_id", scopedClientId);
      const { data: rows, error } = await query;
      if (error) throw new Error(`hubspot-order-sync load-sources: ${error.message}`);
      return rows ?? [];
    });
    if (sources.length === 0) return { synced: 0, failed: 0, clients: 0 };

    // Rows round-trip through step JSON serialization; shape is unchanged
    // (analytics-sync.ts convention).
    const typedSources = sources as DataSourceRow[];

    const results = await Promise.allSettled(
      typedSources.map((source) =>
        step.run(`sync-${source.id}`, async () => {
          const { runHubspotOrderSync } = await import("@/lib/hubspot-sync/orchestrate");
          try {
            const summary = await runHubspotOrderSync(source);
            return { sourceId: source.id, ok: summary.error === null, summary };
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return { sourceId: source.id, ok: false as const, summary: { matched: 0, unmatched: 0, failed: 0, error: reason } };
          }
        }),
      ),
    );

    let synced = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.ok) synced += 1;
      else failed += 1;
    }
    return { synced, failed, clients: typedSources.length };
  },
);
