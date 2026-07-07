// lib/analytics/adapters.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAdapter } from "./adapters";

test("getAdapter resolves the spiro REST adapter", () => {
  const a = getAdapter("spiro");
  assert.ok(a, "expected an adapter for spiro");
  assert.equal(a.provider, "spiro");
});

test("getAdapter resolves the generic MCP adapter", () => {
  const a = getAdapter("generic_mcp");
  assert.ok(a, "expected an adapter for generic_mcp");
  assert.equal(a.provider, "generic_mcp");
});

test("getAdapter returns null for unknown providers", () => {
  assert.equal(getAdapter("stripe"), null);
  assert.equal(getAdapter(""), null);
});
