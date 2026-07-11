import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleDynamicVariables, hollisLineColumns } from "./config";
import type { HollisLine } from "./types";

const line = {
  agent_name: "Ava",
  voice_profile: "female",
  hours: { mon_fri: "9-5" },
  services: ["Photo", "Drone"],
  escalation_number: "+18310000000",
  booking_mode: "email",
  recording_enabled: true,
  greeting_override: null,
  persona: { tone: "warm" },
} as unknown as HollisLine;

test("assembles business-facing variables + greeting", () => {
  const dv = assembleDynamicVariables(line, "BrightLens Media", [{ question: "Turnaround?", answer: "48 hours" }]);
  assert.equal(dv.business_name, "BrightLens Media");
  assert.equal(dv.agent_name, "Ava");
  assert.match(dv.greeting, /AI assistant/i);
  assert.match(dv.greeting, /BrightLens Media/);
  assert.match(dv.faq, /Turnaround/);
  assert.match(dv.services, /Photo/);
  assert.equal(dv.escalation_number, "+18310000000");
});

test("empty FAQ + services produce empty strings, not crashes", () => {
  const bare = { ...line, services: [], greeting_override: null } as unknown as HollisLine;
  const dv = assembleDynamicVariables(bare, "X", []);
  assert.equal(dv.faq, "");
  assert.equal(dv.services, "");
});

test("line column list includes the order-desk columns", () => {
  const cols = hollisLineColumns();
  for (const c of ["order_ops_enabled", "spiro_source_id", "slack_channel_id", "agent_name"]) {
    assert.ok(cols.includes(c), `missing ${c}`);
  }
});
