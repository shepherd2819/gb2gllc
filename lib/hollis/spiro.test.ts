import { test } from "node:test";
import assert from "node:assert/strict";
import { toOrderCard, toAgent, spiroGet, findAgentByPhone, listAgentOrders, findOrderByTracking, getOrderDetail } from "./spiro";

const rawOrder = {
  orderId: "o1", trackingCode: "r2m360pl1", status: "confirmed",
  address: { streetAddress: "15 Oak Dr", fullAddress: "15 Oak Dr, Mount Pleasant, SC 29466", city: "Mount Pleasant", stateOrProvince: "SC", postalCode: "29466" },
  client: { agentId: "a1", agentName: "Vanessa B", companyName: "Unassigned" },
  primaryAppointment: { appointmentId: "ap1", arrivalWindowStart: "2026-07-14T14:30:00-04:00", arrivalWindowEnd: "2026-07-14T14:30:00-04:00", photographer: { photographerId: "p1", name: "Taylor Thurber" } },
};

test("toOrderCard flattens the verified order shape", () => {
  const c = toOrderCard(rawOrder);
  assert.equal(c.trackingCode, "r2m360pl1");
  assert.equal(c.status, "confirmed");
  assert.equal(c.addressText, "15 Oak Dr, Mount Pleasant, SC");
  assert.equal(c.arrivalWindowStart, "2026-07-14T14:30:00-04:00");
  assert.equal(c.photographerName, "Taylor Thurber");
  assert.equal(c.agentId, "a1");
});

test("toAgent flattens nested identity/contact/company", () => {
  const a = toAgent({ identity: { agentId: "a1", firstName: "Vanessa", lastName: "Beem" }, contact: { emailAddress: "v@x.com", phoneNumber: "+18435551234" }, company: { companyName: "ACME" } });
  assert.equal(a.agentId, "a1");
  assert.equal(a.phone, "+18435551234");
  assert.equal(a.companyName, "ACME");
});

const ctx = { baseUrl: "https://api.spiro.media", apiKey: "k", authScheme: "bearer" as const };
function fakeFetch(status: number, body: unknown) {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("spiroGet maps 401 to auth error", async () => {
  const r = await spiroGet(ctx, "/api/v1/orders", fakeFetch(401, {}) as unknown as typeof fetch);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, "auth");
});

test("findAgentByPhone returns first agent or null", async () => {
  const hit = await findAgentByPhone(ctx, "+18435551234", fakeFetch(200, { data: [{ identity: { agentId: "a1", firstName: "V", lastName: "B" }, contact: { phoneNumber: "+18435551234", emailAddress: "v@x.com" } }] }) as unknown as typeof fetch);
  assert.equal(hit.ok, true);
  if (hit.ok) assert.equal(hit.value?.agentId, "a1");
  const miss = await findAgentByPhone(ctx, "+10000000000", fakeFetch(200, { data: [] }) as unknown as typeof fetch);
  if (miss.ok) assert.equal(miss.value, null);
});

test("listAgentOrders maps orders to cards", async () => {
  const r = await listAgentOrders(ctx, "a1", { limit: 5 }, fakeFetch(200, { data: [{ orderId: "o1", trackingCode: "t1", status: "confirmed", address: { streetAddress: "1 A St", city: "X", stateOrProvince: "SC" }, client: { agentId: "a1" }, primaryAppointment: {} }] }) as unknown as typeof fetch);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value[0].trackingCode, "t1");
});

test("findOrderByTracking resolves an order + agentId globally (no prior agent match)", async () => {
  const r = await findOrderByTracking(ctx, "r2m360pl1", fakeFetch(200, { data: [{ orderId: "o1", trackingCode: "r2m360pl1", status: "confirmed", address: { streetAddress: "1 A St", city: "X", stateOrProvince: "SC" }, client: { agentId: "a9" }, primaryAppointment: {} }] }) as unknown as typeof fetch);
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.value.order?.orderId, "o1"); assert.equal(r.value.agentId, "a9"); }
});

test("getOrderDetail extracts staff-only fee fields", async () => {
  const r = await getOrderDetail(ctx, "o1", fakeFetch(200, { data: { pricing: { cancellationAmount: 50, rescheduleAmount: 0 } } }) as unknown as typeof fetch);
  if (r.ok) { assert.equal(r.value.cancellationAmount, 50); assert.equal(r.value.rescheduleAmount, 0); }
});
