import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEscalationBlocks, escalationText } from "./escalation";
import type { EscalationInput } from "./types";

const base: EscalationInput = {
  type: "reschedule", clientId: "c1", lineId: "l1", slackChannel: "C1", staffEmail: "ops@ep.com",
  callerNumber: "+18435551234", agentId: "a1", retellCallId: "call_abc", verified: true,
  order: { orderId: "o1", trackingCode: "r2m360pl1", status: "confirmed", addressText: "15 Oak Dr, Mount Pleasant, SC", arrivalWindowStart: "2026-07-14T14:30:00-04:00", arrivalWindowEnd: "2026-07-14T14:30:00-04:00", photographerName: "Taylor Thurber", agentId: "a1" },
  fields: { desired_window: "Wednesday morning", reason: "seller conflict" },
  staffContext: { rescheduleAmount: 0 },
};

test("blocks include type header, order ref, and captured fields", () => {
  const blocks = buildEscalationBlocks(base);
  const json = JSON.stringify(blocks);
  assert.match(json, /Reschedule/i);
  assert.match(json, /r2m360pl1/);
  assert.match(json, /desired_window|Wednesday morning/i);
  assert.match(json, /call_abc/); // retell call id rendered for traceability
  assert.ok(blocks.length >= 2);
});

test("escalationText is a concise one-liner", () => {
  assert.match(escalationText(base), /Reschedule/i);
});
