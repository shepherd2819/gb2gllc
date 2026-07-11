import type { OrderCard, SpiroAgent, SpiroCtx } from "./types";

export function toOrderCard(o: any): OrderCard {
  const addr = o?.address ?? {};
  const addressText = [addr.streetAddress || addr.fullAddress, addr.city, addr.stateOrProvince].filter(Boolean).join(", ");
  const appt = o?.primaryAppointment ?? {};
  return {
    orderId: String(o?.orderId ?? ""),
    trackingCode: String(o?.trackingCode ?? ""),
    status: o?.status ?? "unknown",
    addressText,
    arrivalWindowStart: appt.arrivalWindowStart ?? null,
    arrivalWindowEnd: appt.arrivalWindowEnd ?? null,
    photographerName: appt?.photographer?.name ?? null,
    agentId: String(o?.client?.agentId ?? o?.agentId ?? ""),
  };
}

export function toAgent(a: any): SpiroAgent {
  return {
    agentId: String(a?.identity?.agentId ?? a?.agentId ?? ""),
    firstName: a?.identity?.firstName ?? a?.firstName ?? "",
    lastName: a?.identity?.lastName ?? a?.lastName ?? "",
    email: a?.contact?.emailAddress ?? a?.emailAddress ?? null,
    phone: a?.contact?.phoneNumber ?? a?.phoneNumber ?? null,
    companyName: a?.company?.companyName ?? null,
  };
}

export type SpiroResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "auth" | "transient" | "bad"; message: string };

type FetchImpl = typeof fetch;

function authHeaders(ctx: SpiroCtx): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (ctx.authScheme === "x-api-key") h["x-api-key"] = ctx.apiKey;
  else h["Authorization"] = `Bearer ${ctx.apiKey}`;
  return h;
}

export async function spiroGet(ctx: SpiroCtx, path: string, fetchImpl: FetchImpl = fetch): Promise<SpiroResult<any>> {
  let res: Response;
  try {
    res = await fetchImpl(ctx.baseUrl.replace(/\/$/, "") + path, { headers: authHeaders(ctx), signal: AbortSignal.timeout(8000) });
  } catch (e) {
    return { ok: false, kind: "transient", message: (e as Error).message };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, kind: "auth", message: `Spiro ${res.status}` };
  if (res.status >= 500) return { ok: false, kind: "transient", message: `Spiro ${res.status}` };
  let json: any;
  try { json = JSON.parse(await res.text()); } catch { return { ok: false, kind: "bad", message: "non-JSON response" }; }
  if (!res.ok) return { ok: false, kind: "bad", message: `Spiro ${res.status}` };
  return { ok: true, value: json };
}

export async function findAgentByPhone(ctx: SpiroCtx, e164: string, fetchImpl: FetchImpl = fetch): Promise<SpiroResult<SpiroAgent | null>> {
  const r = await spiroGet(ctx, `/api/v1/agents?filter[phoneNumber][eq]=${encodeURIComponent(e164)}&pageSize=1`, fetchImpl);
  if (!r.ok) return r;
  const a = r.value?.data?.[0];
  return { ok: true, value: a ? toAgent(a) : null };
}

export async function findAgentByEmail(ctx: SpiroCtx, email: string, fetchImpl: FetchImpl = fetch): Promise<SpiroResult<SpiroAgent | null>> {
  const r = await spiroGet(ctx, `/api/v1/agents?filter[emailAddress][eq]=${encodeURIComponent(email)}&pageSize=1`, fetchImpl);
  if (!r.ok) return r;
  const a = r.value?.data?.[0];
  return { ok: true, value: a ? toAgent(a) : null };
}

export async function listAgentOrders(ctx: SpiroCtx, agentId: string, opts: { limit?: number } = {}, fetchImpl: FetchImpl = fetch): Promise<SpiroResult<OrderCard[]>> {
  const path = `/api/v1/orders?filter[agentId][eq]=${encodeURIComponent(agentId)}&pageSize=${opts.limit ?? 10}&sort=-dateSubmitted`;
  const r = await spiroGet(ctx, path, fetchImpl);
  if (!r.ok) return r;
  const arr = Array.isArray(r.value?.data) ? r.value.data : [];
  return { ok: true, value: arr.map(toOrderCard) };
}

export async function findAgentById(ctx: SpiroCtx, agentId: string, fetchImpl: FetchImpl = fetch): Promise<SpiroResult<SpiroAgent | null>> {
  const r = await spiroGet(ctx, `/api/v1/agents/${encodeURIComponent(agentId)}`, fetchImpl);
  if (!r.ok) return r;
  const a = r.value?.data ?? r.value;
  return { ok: true, value: a?.identity || a?.agentId ? toAgent(a) : null };
}

// Global order lookup by tracking code — works WITHOUT a prior agent match (spec §3.2, no-phone-match path).
export async function findOrderByTracking(ctx: SpiroCtx, trackingCode: string, fetchImpl: FetchImpl = fetch): Promise<SpiroResult<{ order: OrderCard | null; agentId: string | null }>> {
  const r = await spiroGet(ctx, `/api/v1/orders?filter[trackingCode][eq]=${encodeURIComponent(trackingCode)}&pageSize=1`, fetchImpl);
  if (!r.ok) return r;
  const raw = r.value?.data?.[0] ?? null;
  const order = raw ? toOrderCard(raw) : null;
  return { ok: true, value: { order, agentId: order?.agentId || null } };
}

export interface OrderPricing { cancellationAmount: number | null; rescheduleAmount: number | null; }
// Order detail carries the staff-only fee fields (spec §9 — never spoken to caller).
export async function getOrderDetail(ctx: SpiroCtx, orderId: string, fetchImpl: FetchImpl = fetch): Promise<SpiroResult<OrderPricing>> {
  const r = await spiroGet(ctx, `/api/v1/orders/${encodeURIComponent(orderId)}`, fetchImpl);
  if (!r.ok) return r;
  const p = (r.value?.data ?? r.value)?.pricing ?? {};
  return { ok: true, value: { cancellationAmount: p.cancellationAmount ?? null, rescheduleAmount: p.rescheduleAmount ?? null } };
}
