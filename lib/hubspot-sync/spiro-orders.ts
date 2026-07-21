// Client-wide (multi-agent) Spiro order fetch for the HubSpot order-sync job.
// lib/hollis/spiro.ts is agent-scoped (a caller's own orders) — this module
// adds the multi-agent, date-filtered, paginated "everything since X" query
// this job needs, reusing lib/hollis/spiro.ts's spiroGet/findAgentById rather
// than duplicating Spiro's auth/fetch plumbing.
import { spiroGet, findAgentById } from "@/lib/hollis/spiro";
import type { SpiroCtx } from "@/lib/hollis/types";
import type { SpiroResult } from "@/lib/hollis/spiro";
import type { SpiroOrderSummary } from "./types";

type FetchImpl = typeof fetch;

const PAGE_SIZE = 200; // Spiro's documented max pageSize

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toOrderSummary(o: any): SpiroOrderSummary {
  const addr = o?.address ?? {};
  const addressText = [addr.streetAddress || addr.fullAddress, addr.city, addr.stateOrProvince].filter(Boolean).join(", ");
  const appt = o?.primaryAppointment ?? {};
  return {
    orderId: String(o?.orderId ?? ""),
    trackingCode: String(o?.trackingCode ?? ""),
    status: String(o?.status ?? "unknown"),
    dateSubmitted: o?.dateSubmitted ?? null,
    addressText,
    mediaTitle: o?.mediaTitle ?? null,
    photographerName: appt?.photographer?.name ?? null,
    appointmentDate: appt?.arrivalWindowStart ?? null,
    agentId: String(o?.client?.agentId ?? o?.agentId ?? ""),
  };
}

// Oldest-first (sort=dateSubmitted, ascending) so a mid-run failure can
// safely resume from the last order actually processed — the caller
// (orchestrate.ts) advances its checkpoint per-order, not per-page.
export async function fetchOrdersSince(
  ctx: SpiroCtx,
  sinceDate: string,
  fetchImpl: FetchImpl = fetch,
): Promise<SpiroResult<SpiroOrderSummary[]>> {
  const out: SpiroOrderSummary[] = [];
  let page = 1;
  for (;;) {
    const path = `/api/v1/orders?filter[dateSubmitted][gte]=${encodeURIComponent(sinceDate)}&page=${page}&pageSize=${PAGE_SIZE}&sort=dateSubmitted`;
    const r = await spiroGet(ctx, path, fetchImpl);
    if (!r.ok) return r;
    const rows = Array.isArray(r.value?.data) ? r.value.data : [];
    out.push(...rows.map(toOrderSummary));
    if (rows.length < PAGE_SIZE) return { ok: true, value: out };
    page += 1;
  }
}

export interface SpiroInvoiceSummary {
  status: string;
}

// Payment status lives on a separate Spiro resource, not the order itself —
// an order can have more than one invoice (e.g. company vs. agent billing
// split), so this returns every invoice for the order; derivePaidStatus
// below reduces that list to a single value.
export async function fetchInvoicesForOrder(
  ctx: SpiroCtx,
  orderId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<SpiroResult<SpiroInvoiceSummary[]>> {
  const path = `/api/v1/invoices?filter[orderId][eq]=${encodeURIComponent(orderId)}&pageSize=50`;
  const r = await spiroGet(ctx, path, fetchImpl);
  if (!r.ok) return r;
  const rows = Array.isArray(r.value?.data) ? r.value.data : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok: true, value: rows.map((i: any) => ({ status: String(i?.status ?? "") })) };
}

// "Paid" only when every invoice tied to the order is fully paid — a mixed
// company/agent split where only one side has paid reads as "Unpaid", and an
// order with no invoice yet is "Unpaid" too (not an error).
export function derivePaidStatus(invoices: SpiroInvoiceSummary[]): "Paid" | "Unpaid" {
  return invoices.length > 0 && invoices.every((i) => i.status === "Paid") ? "Paid" : "Unpaid";
}

// The chosen package/bundle name (e.g. "Deluxe + Zillow Tour") lives on the
// per-order detail endpoint, not the list endpoint fetchOrdersSince uses —
// callers should only fetch this for orders they're about to upsert, not
// for every order in a rescan window.
export async function fetchOrderPackageName(
  ctx: SpiroCtx,
  orderId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<SpiroResult<string | null>> {
  const r = await spiroGet(ctx, `/api/v1/orders/${encodeURIComponent(orderId)}`, fetchImpl);
  if (!r.ok) return r;
  const name = (r.value?.data ?? r.value)?.bundle?.name;
  return { ok: true, value: typeof name === "string" && name.trim().length > 0 ? name.trim() : null };
}

// Caches agent→email lookups for the lifetime of one sync run so an agent
// with many orders in the same batch is fetched from Spiro only once.
export function createAgentEmailCache(ctx: SpiroCtx, fetchImpl: FetchImpl = fetch) {
  const cache = new Map<string, SpiroResult<string | null>>();
  return {
    async getEmail(agentId: string): Promise<SpiroResult<string | null>> {
      const cached = cache.get(agentId);
      if (cached) return cached;
      const r = await findAgentById(ctx, agentId, fetchImpl);
      const result: SpiroResult<string | null> = r.ok ? { ok: true, value: r.value?.email ?? null } : r;
      cache.set(agentId, result);
      return result;
    },
  };
}
