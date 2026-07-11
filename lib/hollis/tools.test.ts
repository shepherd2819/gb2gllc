import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOL_SCHEMAS, dispatch, handleLookupOrder, type ToolCtx } from "./tools";
import { handleRescheduleRequest, handleCancellationRequest, handleNewOrderRequest } from "./tools";
import { ORDER_TOOL_SCHEMAS, toolsForLine } from "./tools";

function fakeCtx(overrides: Partial<ToolCtx> = {}): ToolCtx {
  return {
    line: { id: "l1", client_id: "c1", booking_mode: "email", escalation_number: "+18310000000" },
    callId: "x",
    record: async () => {},
    ...overrides,
  };
}

test("exposes exactly five tools, all object-schema", () => {
  assert.equal(TOOL_SCHEMAS.length, 5);
  for (const t of TOOL_SCHEMAS) {
    assert.equal(t.input_schema.type, "object");
    assert.equal(t.input_schema.additionalProperties, false);
    assert.ok(Array.isArray(t.input_schema.required));
  }
});

test("tool names are the five expected", () => {
  assert.deepEqual(
    TOOL_SCHEMAS.map((t) => t.name).sort(),
    ["book_appointment", "lookup_faq", "qualify_lead", "take_message", "transfer_to_human"],
  );
});

test("take_message returns a spoken confirmation and records", async () => {
  let recorded: unknown = null;
  const out = await dispatch(
    "take_message",
    { name: "Pat", phone: "8312398123", message: "call back" },
    fakeCtx({ record: async (e) => { recorded = e; } }),
  );
  assert.match(out, /pass that along/i);
  assert.ok(recorded);
});

test("book_appointment confirms a follow-up", async () => {
  const out = await dispatch("book_appointment", { name: "Pat", phone: "1", service: "Photo", preferred_times: "Fri" }, fakeCtx());
  assert.match(out, /confirm|reach out|lock/i);
});

test("unknown tool returns a safe fallback string", async () => {
  const out = await dispatch("nope", {}, fakeCtx());
  assert.match(out, /take a message|didn.t catch/i);
});

const orderCard = { orderId: "o1", trackingCode: "r2m360pl1", status: "confirmed", addressText: "15 Oak Dr, Mount Pleasant, SC", arrivalWindowStart: "2026-07-14T14:30:00-04:00", arrivalWindowEnd: null, photographerName: "Taylor Thurber", agentId: "a1" };
const fakeAgent = { agentId: "a1", firstName: "V", lastName: "B", email: "v@x.com", phone: "+18435551234", companyName: null };
function orderDeps(over = {}) {
  return {
    loadSpiroCtx: async () => ({ baseUrl: "https://api.spiro.media", apiKey: "k", authScheme: "bearer" as const }),
    findAgentByPhone: async () => ({ ok: true as const, value: fakeAgent }),
    findAgentByEmail: async () => ({ ok: true as const, value: null }),
    findAgentById: async () => ({ ok: true as const, value: fakeAgent }),
    findOrderByTracking: async () => ({ ok: true as const, value: { order: orderCard, agentId: "a1" } }),
    getOrderDetail: async () => ({ ok: true as const, value: { cancellationAmount: 0, rescheduleAmount: 0 } }),
    resolveOrder: async () => ({ ok: true as const, value: { match: orderCard, candidates: [orderCard] } }),
    postEscalation: async () => ({ ok: true }),
    ...over,
  };
}

test("lookup_order returns a spoken card when verified by tracking code", async () => {
  const ctx = fakeCtx({ callerNumber: "+18435551234", line: { id: "l1", client_id: "c1", order_ops_enabled: true, spiro_source_id: "s1" } as any });
  const out = await handleLookupOrder({ tracking_code: "r2m360pl1" }, ctx, orderDeps());
  assert.match(out, /confirmed/i);
  assert.match(out, /Taylor Thurber/);
});

test("lookup_order asks to verify when no matching detail", async () => {
  const ctx = fakeCtx({ callerNumber: "+18435551234", line: { id: "l1", client_id: "c1", order_ops_enabled: true, spiro_source_id: "s1" } as any });
  const out = await handleLookupOrder({}, ctx, orderDeps({ resolveOrder: async () => ({ ok: true as const, value: { match: null, candidates: [orderCard] } }) }));
  assert.match(out, /address or.*tracking|confirm/i);
});

test("lookup_order handles Spiro auth failure gracefully", async () => {
  const ctx = fakeCtx({ callerNumber: "+18435551234", line: { id: "l1", client_id: "c1", order_ops_enabled: true, spiro_source_id: "s1" } as any });
  const out = await handleLookupOrder({ tracking_code: "x" }, ctx, orderDeps({ findOrderByTracking: async () => ({ ok: false as const, kind: "auth", message: "401" }) }));
  assert.match(out, /trouble|team|later/i);
});

const SENT = /sent (this|that|it).*(team|over)|our team.*email|confirm by email/i;

test("reschedule escalates a verified order and promises email", async () => {
  const ctx = fakeCtx({ callerNumber: "+18435551234", line: { id: "l1", client_id: "c1", order_ops_enabled: true, spiro_source_id: "s1", slack_channel_id: "C1", booking_email: "ops@ep.com" } as any });
  let posted: any = null;
  const out = await handleRescheduleRequest({ tracking_code: "r2m360pl1", desired_window: "Wed AM" }, ctx, orderDeps({ postEscalation: async (i: any) => { posted = i; return { ok: true }; } }));
  assert.equal(posted.type, "reschedule");
  assert.equal(posted.verified, true);
  assert.match(out, SENT);
});

test("reschedule refuses when the order can't be verified", async () => {
  const ctx = fakeCtx({ callerNumber: "+18435551234", line: { id: "l1", client_id: "c1", order_ops_enabled: true, spiro_source_id: "s1" } as any });
  const out = await handleRescheduleRequest({ desired_window: "Wed AM" }, ctx, orderDeps({ resolveOrder: async () => ({ ok: true as const, value: { match: null, candidates: [] } }) }));
  assert.match(out, /confirm|address or.*tracking/i);
});

test("new order escalates without needing an existing order", async () => {
  const ctx = fakeCtx({ callerNumber: "+18435551234", line: { id: "l1", client_id: "c1", order_ops_enabled: true, spiro_source_id: "s1", slack_channel_id: "C1", booking_email: "ops@ep.com" } as any });
  let posted: any = null;
  const out = await handleNewOrderRequest({ property_address: "9 Palm Ct", package_or_services: "Deluxe + Drone", preferred_datetime: "next Tuesday AM" }, ctx, orderDeps({ postEscalation: async (i: any) => { posted = i; return { ok: true }; } }));
  assert.equal(posted.type, "new_order");
  assert.match(out, SENT);
});

test("base TOOL_SCHEMAS is still exactly five (non-breaking)", () => {
  assert.equal(TOOL_SCHEMAS.length, 5);
});

test("ORDER_TOOL_SCHEMAS has the four order tools, object-schema", () => {
  const names = ORDER_TOOL_SCHEMAS.map((t) => t.name).sort();
  assert.deepEqual(names, ["lookup_order", "request_cancellation", "request_new_order", "request_reschedule"]);
  for (const t of ORDER_TOOL_SCHEMAS) { assert.equal(t.input_schema.type, "object"); assert.equal(t.input_schema.additionalProperties, false); }
});

test("toolsForLine: disabled = base 5; enabled drops booking/lead + adds order tools (7)", () => {
  assert.equal(toolsForLine({ order_ops_enabled: false }).length, 5);
  const enabled = toolsForLine({ order_ops_enabled: true });
  const names = enabled.map((t) => t.name).sort();
  assert.equal(enabled.length, 7);
  assert.ok(!names.includes("book_appointment") && !names.includes("qualify_lead"), "booking/lead dropped on order line");
  assert.ok(["lookup_order", "take_message", "lookup_faq", "transfer_to_human"].every((n) => names.includes(n)));
});

test("dispatch refuses order tools when order_ops disabled", async () => {
  const ctx = fakeCtx({ line: { id: "l1", client_id: "c1", order_ops_enabled: false } as any });
  const out = await dispatch("lookup_order", { tracking_code: "x" }, ctx);
  assert.match(out, /take a message|not able|team/i);
});
