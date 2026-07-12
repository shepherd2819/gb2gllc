import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEscalationBlocks, buildSummaryText, escalationText, postEscalation, safeText } from "./escalation";
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

function deps(over = {}) {
  const calls: any = { inserted: null, updated: null, slack: null, email: null };
  return { calls, deps: {
    insertRow: async (row: any) => { calls.inserted = row; return "esc1"; },
    updateRow: async (id: string, patch: any) => { calls.updated = { id, patch }; },
    getSlackToken: async () => "xoxb-test",
    postSlack: async (o: any) => { calls.slack = o; return { ok: true, ts: "1700.1" }; },
    sendStaffEmail: async (o: any) => { calls.email = o; },
    ...over,
  } };
}

test("posts to Slack and marks the row open with ts", async () => {
  const { calls, deps: d } = deps();
  const r = await postEscalation(base, d);
  assert.equal(r.ok, true);
  assert.equal(r.slackTs, "1700.1");
  assert.equal(calls.inserted.type, "reschedule");
  assert.equal(calls.slack.channel, "C1");
  assert.equal(calls.email, null);
});

test("falls back to staff email when Slack fails", async () => {
  const { calls, deps: d } = deps({ postSlack: async () => { throw new Error("slack down"); } });
  const r = await postEscalation(base, d);
  assert.equal(r.ok, false);
  assert.equal(r.fallback, "email");
  assert.equal(calls.email.to, "ops@ep.com");
  assert.equal(calls.updated.patch.status, "failed");
});

test("summary text is one concise line", () => {
  const t = buildSummaryText({ caller: "+18435551234", outcome: "booking_request", asks: ["reschedule o1"] });
  assert.match(t, /\+18435551234/);
  assert.match(t, /reschedule o1/);
});

test("safeText escapes mrkdwn metacharacters and collapses newlines", () => {
  assert.equal(safeText("<http://evil|click>\n*Injected:* pwned"), "&lt;http://evil|click&gt; *Injected:* pwned");
  assert.equal(safeText("a & b"), "a &amp; b");
  assert.equal(safeText(null), "");
  assert.equal(safeText(undefined), "");
  assert.equal(safeText(42), "42");
});

test("caller-supplied field text cannot inject fake Slack mrkdwn or fabricate lines", () => {
  const malicious = "<http://evil|click>\n*Injected:* pwned";
  const input: EscalationInput = { ...base, callerNumber: malicious, fields: { ...base.fields, reason: malicious } };
  const json = JSON.stringify(buildEscalationBlocks(input));

  // The raw, unescaped payload must never appear verbatim in the rendered blocks.
  assert.ok(!json.includes("<http://evil|click>"), "raw malicious link markup leaked into blocks");

  // The escaped form is expected to be present instead.
  assert.ok(json.includes("&lt;http://evil|click&gt;"), "escaped form of the payload is missing");

  // The embedded newline must be collapsed so "*Injected:* pwned" cannot masquerade
  // as its own `*Field:*` line — it must remain glued to the preceding text on one line.
  assert.ok(!json.includes("\\n*Injected:*"), "newline-introduced fake field survived as its own segment");
});
