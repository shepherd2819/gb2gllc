// lib/inngest/functions/analytics-sync.ts
//
// Daily warehouse sync + snapshot recompute. Triggered by cron (5am ET, all
// clients) and by "analytics/source.connected" (one client — first-connect
// backfill and the admin "Sync now" button; concurrency keyed on clientId so
// event runs for the same client serialize). One durable step per source so
// a failing source never blocks the others (steward allSettled pattern); one
// snapshot step per client so there is exactly one snapshot writer per
// client per run. Runtime deps are lazy-imported inside steps
// (hollis-call-completed pattern).

import { inngest } from "@/lib/inngest/client";
import { computeSyncWindow, groupSourcesByClient } from "@/lib/analytics/sync";
import type { DataSourceRow } from "@/lib/analytics/types";

export const analyticsSync = inngest.createFunction(
  {
    id: "analytics-sync",
    name: "Analytics: source sync + snapshots",
    concurrency: [{ key: "event.data.clientId", limit: 1 }],
    triggers: [
      { cron: "TZ=America/New_York 0 5 * * *" },
      { event: "analytics/source.connected" },
    ],
  },
  async ({ event, step }) => {
    // Event runs scope to one client; cron runs (no event.data) cover all.
    const data = (event as { data?: { clientId?: unknown } }).data;
    const scopedClientId = typeof data?.clientId === "string" ? data.clientId : undefined;

    const sources = await step.run("load-sources", async () => {
      const { listActiveSources } = await import("@/lib/analytics/store");
      return listActiveSources(scopedClientId);
    });
    if (sources.length === 0) return { synced: 0, failed: 0, clients: 0 };

    // Rows round-trip through step JSON serialization; shape is unchanged.
    const grouped = groupSourcesByClient(sources as DataSourceRow[]);
    let synced = 0;
    let failed = 0;

    for (const [clientId, clientSources] of Object.entries(grouped)) {
      // A cron run covers every client; one client's failure must never
      // abort the loop and starve every client that comes after it.
      try {
        const results = await Promise.allSettled(
          clientSources.map((source) =>
            step.run(`sync-${source.id}`, async () => {
              const { toSourceCtx, upsertMetrics, markSyncResult, recordEvent } =
                await import("@/lib/analytics/store");
              const { getAdapter } = await import("@/lib/analytics/adapters");
              try {
                const adapter = getAdapter(source.provider);
                if (!adapter) {
                  const reason = `no adapter for provider "${source.provider}"`;
                  await markSyncResult(source.id, reason);
                  await recordEvent(clientId, "sync.failed", "system", {
                    source_id: source.id,
                    reason,
                  });
                  return { sourceId: source.id, ok: false as const };
                }
                const ctx = toSourceCtx(source as DataSourceRow);
                const window = computeSyncWindow(new Date(), source.last_sync_at === null);
                const res = await adapter.sync(ctx, window);
                if (!res.ok) {
                  if (res.kind === "unsupported") {
                    // MCP-only sources power chat, not tiles — healthy no-op.
                    await markSyncResult(source.id, null);
                    return { sourceId: source.id, ok: true as const, rows: 0 };
                  }
                  await markSyncResult(source.id, res.reason);
                  await recordEvent(clientId, "sync.failed", "system", {
                    source_id: source.id,
                    reason: res.reason,
                  });
                  return { sourceId: source.id, ok: false as const };
                }
                const rows = await upsertMetrics(clientId, source.id, res.rows);
                await markSyncResult(source.id, null);
                return { sourceId: source.id, ok: true as const, rows };
              } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                await markSyncResult(source.id, reason);
                await recordEvent(clientId, "sync.failed", "system", {
                  source_id: source.id,
                  reason,
                });
                return { sourceId: source.id, ok: false as const };
              }
            }),
          ),
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value.ok) synced += 1;
          else failed += 1;
        }

        // One snapshot writer per client per run — after all its source steps.
        await step.run(`snapshot-${clientId}`, async () => {
          const { listActiveSources, listMetricsForClient, writeSnapshot, recordEvent } =
            await import("@/lib/analytics/store");
          const { computeSnapshot } = await import("@/lib/analytics/snapshot");
          const { generateInsights } = await import("@/lib/analytics/insights");
          const { logEvent } = await import("@/lib/logger");

          const now = new Date();
          const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1))
            .toISOString()
            .slice(0, 10);
          const [freshSources, metrics] = await Promise.all([
            listActiveSources(clientId), // re-fetch: last_sync_at just changed
            listMetricsForClient(clientId, { grains: ["month"], from }),
          ]);
          const payload = computeSnapshot(metrics, freshSources, now);
          const insights = await generateInsights(payload);
          // insights null = preserve existing cards (writeSnapshot contract);
          // [] here means "generation skipped or failed", not "delete cards".
          await writeSnapshot(clientId, payload, insights.length > 0 ? insights : null);
          await recordEvent(clientId, "sync.completed", "system", {
            sources: freshSources.length,
            metric_rows: metrics.length,
            insight_cards: insights.length,
          });
          await logEvent({
            clientId,
            category: "analytics",
            message: `analytics sync completed — ${freshSources.length} source(s), ${metrics.length} month-grain rows`,
            metadata: { insight_cards: insights.length },
          });
          return { insights: insights.length };
        });
      } catch (err) {
        // Isolate this client's failure (e.g. snapshot step exhausted its
        // Inngest retries on a transient Supabase error) so later clients in
        // the same cron run still get processed.
        const { recordEvent } = await import("@/lib/analytics/store");
        const { logEvent } = await import("@/lib/logger");
        await recordEvent(clientId, "sync.failed", "system", {
          stage: "snapshot",
          error: String(err),
        });
        await logEvent({
          clientId,
          category: "analytics",
          level: "error",
          message: `Analytics snapshot failed: ${String(err)}`,
        });
        failed += 1;
        continue;
      }
    }

    return { synced, failed, clients: Object.keys(grouped).length };
  },
);
