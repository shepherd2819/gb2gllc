import { test } from "node:test";
import assert from "node:assert/strict";
import { toOrderSummary, fetchOrdersSince, createAgentEmailCache } from "./spiro-orders";
import type { SpiroCtx } from "@/lib/hollis/types";

const ctx: SpiroCtx = { baseUrl: "https://api.spiro.media", apiKey: "k", authScheme: "bearer" };

const rawOrder = {
  orderId: "o1",
  trackingCode: "r2m360pl1",
  status: "confirmed",
  dateSubmitted: "2026-07-14T10:00:00-04:00",
  mediaTitle: "Full Photo + Video Package",
  address: { streetAddress: "15 Oak Dr", city: "Mount Pleasant", stateOrProvince: "SC" },
  client: { agentId: "a1" },
  primaryAppointment: { arrivalWindowStart: "2026-07-16T14:00:00-04:00", photographer: { name: "Taylor Thurber" } },
};

test("toOrderSummary flattens dateSubmitted + mediaTitle alongside the existing card fields", () => {
  const s = toOrderSummary(rawOrder);
  assert.equal(s.orderId, "o1");
  assert.equal(s.dateSubmitted, "2026-07-14T10:00:00-04:00");
  assert.equal(s.mediaTitle, "Full Photo + Video Package");
  assert.equal(s.addressText, "15 Oak Dr, Mount Pleasant, SC");
  assert.equal(s.photographerName, "Taylor Thurber");
  assert.equal(s.appointmentDate, "2026-07-16T14:00:00-04:00");
  assert.equal(s.agentId, "a1");
});

function pageOf(n: number, start: number) {
  return { data: Array.from({ length: n }, (_, i) => ({ ...rawOrder, orderId: `o${start + i}` })) };
}

test("fetchOrdersSince stops after a page smaller than the page size", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify(pageOf(3, 0)), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  const r = await fetchOrdersSince(ctx, "2026-07-01", fetchImpl);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.length, 3);
});

test("fetchOrdersSince pages through a full page then stops on the next, smaller one", async () => {
  let call = 0;
  const fetchImpl = (async () => {
    call += 1;
    const body = call === 1 ? pageOf(200, 0) : pageOf(5, 200);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const r = await fetchOrdersSince(ctx, "2026-07-01", fetchImpl);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.length, 205);
  assert.equal(call, 2);
});

test("createAgentEmailCache fetches an agent only once across repeated calls", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ data: { identity: { agentId: "a1" }, contact: { emailAddress: "v@x.com" } } }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const cache = createAgentEmailCache(ctx, fetchImpl);
  const first = await cache.getEmail("a1");
  const second = await cache.getEmail("a1");
  if (first.ok) assert.equal(first.value, "v@x.com");
  if (second.ok) assert.equal(second.value, "v@x.com");
  assert.equal(calls, 1);
});
