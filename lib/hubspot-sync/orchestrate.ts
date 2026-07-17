// lib/hubspot-sync/orchestrate.ts
// Ties together: Spiro order fetch, contact matching, HubSpot upsert +
// association, and the local hubspot_order_syncs ledger. One call = one
// HubSpot client_data_sources row's daily sync.
//
// Checkpoint lives in the HubSpot source row's OWN config JSONB
// (last_order_sync_at / last_order_sync_error), NOT the shared last_sync_at
// column — see this plan's Global Constraints for why (the unrelated nightly
// analytics-sync cron sweeps every active source regardless of provider).
//
// On any per-order infra failure (Spiro/HubSpot network/auth error) that
// order is left unrecorded (not written to the ledger) and the checkpoint is
// NOT advanced past this run's start time, so the whole window is retried
// next run. Already-synced orders in that window are safe to reprocess —
// the ledger's spiro_status check makes them a no-op — so this fails safe
// (some extra work) rather than silently skipping a failed order forever.
import { decryptSecret } from "@/lib/analytics/crypto";
import { updateSourceConfig } from "@/lib/analytics/store";
import { loadSpiroCtx } from "@/lib/hollis/spiro";
import { fetchOrdersSince, createAgentEmailCache } from "./spiro-orders";
import { searchContactByEmail, upsertOrder, createAssociation } from "./hubspot-client";
import { matchContact } from "./match";
import { getSyncRow, upsertSyncRow } from "./store";
import { computeOrderSyncFloor } from "./window";
import type { HubspotCtx } from "./types";
import type { DataSourceRow } from "@/lib/analytics/types";

const HUBSPOT_BASE_URL = "https://api.hubapi.com";

export interface OrderSyncSummary {
  matched: number;
  unmatched: number;
  failed: number;
  error: string | null;
}

interface HubspotSourceConfig {
  spiro_source_id?: string;
  hubspot_object_type?: string;
  hubspot_id_property?: string;
  association_type_id?: number;
  cutoff_date?: string;
  last_order_sync_at?: string;
  last_order_sync_error?: string | null;
}

export async function runHubspotOrderSync(source: DataSourceRow): Promise<OrderSyncSummary> {
  const config = source.config as HubspotSourceConfig;

  if (!config.spiro_source_id) {
    return { matched: 0, unmatched: 0, failed: 0, error: "No Spiro source paired — set it in the HubSpot Order Sync panel" };
  }
  if (!source.secret_enc) {
    return { matched: 0, unmatched: 0, failed: 0, error: "No HubSpot token configured" };
  }
  if (!config.hubspot_object_type || !config.hubspot_id_property || !config.association_type_id) {
    return { matched: 0, unmatched: 0, failed: 0, error: "HubSpot object schema not yet introspected — see the HubSpot Order Sync panel" };
  }

  const spiroCtx = await loadSpiroCtx(source.client_id, config.spiro_source_id);
  if (!spiroCtx) {
    return { matched: 0, unmatched: 0, failed: 0, error: "Paired Spiro source not found or has no API key" };
  }

  const hubspotCtx: HubspotCtx = {
    baseUrl: HUBSPOT_BASE_URL,
    token: decryptSecret(source.secret_enc),
    objectType: config.hubspot_object_type,
    idProperty: config.hubspot_id_property,
    associationTypeId: config.association_type_id,
  };

  if (!config.cutoff_date) {
    return { matched: 0, unmatched: 0, failed: 0, error: "No cutoff date configured — set a go-live date in the HubSpot Order Sync panel" };
  }

  const runStartedAt = new Date().toISOString();
  // Bounded trailing rescan, not an ever-advancing frontier — see window.ts's
  // header comment and design spec §8: Spiro's dateSubmitted filter never
  // changes as an order's status progresses, so re-scanning a trailing
  // window keeps in-progress orders' status changes reachable even after the
  // checkpoint has long since passed their submission date. Never before
  // cutoff_date (no backfill, ever).
  const since = computeOrderSyncFloor(new Date(runStartedAt), config.cutoff_date);
  const ordersResult = await fetchOrdersSince(spiroCtx, since);
  if (!ordersResult.ok) {
    await updateSourceConfig(source.id, { ...config, last_order_sync_error: ordersResult.message });
    return { matched: 0, unmatched: 0, failed: 0, error: ordersResult.message };
  }

  const agentEmails = createAgentEmailCache(spiroCtx);
  let matched = 0;
  let unmatched = 0;
  let failed = 0;
  let lastFailureMessage: string | null = null;

  for (const order of ordersResult.value) {
    const existing = await getSyncRow(source.id, order.orderId);
    if (existing && existing.spiro_status === order.status) {
      if (existing.match_status === "matched") matched += 1;
      else unmatched += 1;
      continue;
    }

    const emailResult = await agentEmails.getEmail(order.agentId);
    if (!emailResult.ok) {
      failed += 1;
      lastFailureMessage = emailResult.message;
      continue; // not recorded — retried next run since the checkpoint won't advance past it
    }

    const searchResult = await searchContactByEmail(hubspotCtx, emailResult.value ?? "");
    if (!searchResult.ok) {
      failed += 1;
      lastFailureMessage = searchResult.message;
      continue;
    }

    const outcome = matchContact(emailResult.value, searchResult.value);
    if (outcome.kind === "unmatched") {
      await upsertSyncRow({
        client_id: source.client_id,
        source_id: source.id,
        spiro_order_id: order.orderId,
        spiro_status: order.status,
        hubspot_object_id: null,
        hubspot_contact_id: null,
        match_status: "unmatched",
        error: outcome.reason,
      });
      unmatched += 1;
      continue;
    }

    const properties: Record<string, string> = {
      status: order.status,
      tracking_code: order.trackingCode,
      address: order.addressText,
    };
    if (order.dateSubmitted) properties.date_submitted = order.dateSubmitted;
    if (order.mediaTitle) properties.media_title = order.mediaTitle;
    if (order.photographerName) properties.photographer = order.photographerName;
    if (order.appointmentDate) properties.appointment_date = order.appointmentDate;

    const upserted = await upsertOrder(hubspotCtx, order.orderId, properties);
    if (!upserted.ok) {
      failed += 1;
      lastFailureMessage = upserted.message;
      continue;
    }
    const associated = await createAssociation(hubspotCtx, upserted.value.id, outcome.contact.id);
    if (!associated.ok) {
      failed += 1;
      lastFailureMessage = associated.message;
      continue;
    }

    await upsertSyncRow({
      client_id: source.client_id,
      source_id: source.id,
      spiro_order_id: order.orderId,
      spiro_status: order.status,
      hubspot_object_id: upserted.value.id,
      hubspot_contact_id: outcome.contact.id,
      match_status: "matched",
      error: null,
    });
    matched += 1;
  }

  const nextConfig: HubspotSourceConfig = {
    ...config,
    last_order_sync_error: failed > 0 ? `${failed} order(s) failed this run (last error: ${lastFailureMessage}) — will retry` : null,
  };
  if (failed === 0) nextConfig.last_order_sync_at = runStartedAt;
  // `nextConfig` is typed via the local HubspotSourceConfig interface, which
  // (unlike a fresh object literal) TS won't structurally match against
  // updateSourceConfig's `Record<string, unknown>` param without an explicit
  // index signature — cast is type-level only, no runtime effect.
  await updateSourceConfig(source.id, nextConfig as Record<string, unknown>);

  return { matched, unmatched, failed, error: nextConfig.last_order_sync_error ?? null };
}
