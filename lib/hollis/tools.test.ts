import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOL_SCHEMAS, dispatch, type ToolCtx } from "./tools";

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
