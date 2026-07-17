// lib/hubspot-sync/store.ts
// Thin supabaseAdmin wrappers around hubspot_order_syncs (migration 035).
// Tenant isolation is MANUAL, same convention as lib/analytics/store.ts:
// clientId/sourceId here always come from a source row already scoped to
// one client (orchestrate.ts) or the admin [id] route param (Task 10) —
// never from an unscoped request body.
import { supabaseAdmin } from "@/lib/supabase";

export interface SyncRow {
  spiro_order_id: string;
  spiro_status: string | null;
  hubspot_object_id: string | null;
  hubspot_contact_id: string | null;
  match_status: "matched" | "unmatched";
  error: string | null;
}

export async function getSyncRow(sourceId: string, spiroOrderId: string): Promise<SyncRow | null> {
  const { data, error } = await supabaseAdmin
    .from("hubspot_order_syncs")
    .select("spiro_order_id, spiro_status, hubspot_object_id, hubspot_contact_id, match_status, error")
    .eq("source_id", sourceId)
    .eq("spiro_order_id", spiroOrderId)
    .maybeSingle();
  if (error) throw new Error(`getSyncRow: ${error.message}`);
  return data as SyncRow | null;
}

export async function upsertSyncRow(row: {
  client_id: string;
  source_id: string;
  spiro_order_id: string;
  spiro_status: string | null;
  hubspot_object_id: string | null;
  hubspot_contact_id: string | null;
  match_status: "matched" | "unmatched";
  error: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("hubspot_order_syncs")
    .upsert({ ...row, synced_at: new Date().toISOString() }, { onConflict: "source_id,spiro_order_id" });
  if (error) throw new Error(`upsertSyncRow: ${error.message}`);
}

export async function countSyncStats(sourceId: string): Promise<{ matched: number; unmatched: number }> {
  const [{ count: matched }, { count: unmatched }] = await Promise.all([
    supabaseAdmin.from("hubspot_order_syncs").select("id", { count: "exact", head: true }).eq("source_id", sourceId).eq("match_status", "matched"),
    supabaseAdmin.from("hubspot_order_syncs").select("id", { count: "exact", head: true }).eq("source_id", sourceId).eq("match_status", "unmatched"),
  ]);
  return { matched: matched ?? 0, unmatched: unmatched ?? 0 };
}
