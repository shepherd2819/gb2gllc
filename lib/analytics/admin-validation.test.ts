// lib/analytics/admin-validation.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSourceCreate, validateSourcePatch, isKnownProvider } from "./admin-validation";

const knows = (p: string) => p === "spiro" || p === "generic_mcp";

const goodCreate = {
  kind: "rest",
  provider: "spiro",
  label: "Spiro — production",
  config: { baseUrl: "https://api.spiro.media" },
  secret: "sk-live-abcd1234",
  chat_tool_allowlist: ["search_orders"],
};

test("validateSourceCreate accepts a well-formed body", () => {
  const v = validateSourceCreate(goodCreate, knows);
  assert.ok(v.ok);
  if (v.ok) {
    assert.equal(v.value.provider, "spiro");
    assert.equal(v.value.label, "Spiro — production");
    assert.deepEqual(v.value.chat_tool_allowlist, ["search_orders"]);
  }
});

test("validateSourceCreate rejects a non-object body", () => {
  assert.equal(validateSourceCreate(null, knows).ok, false);
  assert.equal(validateSourceCreate("x", knows).ok, false);
  assert.equal(validateSourceCreate([1], knows).ok, false);
});

test("validateSourceCreate rejects unknown kind", () => {
  const v = validateSourceCreate({ ...goodCreate, kind: "graphql" }, knows);
  assert.equal(v.ok, false);
});

test("validateSourceCreate enforces the provider whitelist", () => {
  const v = validateSourceCreate({ ...goodCreate, provider: "stripe" }, knows);
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.reason, /provider/i);
});

test("validateSourceCreate enforces label 1-80 chars (trimmed)", () => {
  assert.equal(validateSourceCreate({ ...goodCreate, label: "" }, knows).ok, false);
  assert.equal(validateSourceCreate({ ...goodCreate, label: "   " }, knows).ok, false);
  assert.equal(validateSourceCreate({ ...goodCreate, label: "x".repeat(81) }, knows).ok, false);
  assert.equal(validateSourceCreate({ ...goodCreate, label: "x".repeat(80) }, knows).ok, true);
});

test("validateSourceCreate requires config to be a plain object, defaulting {} when absent", () => {
  assert.equal(validateSourceCreate({ ...goodCreate, config: [1, 2] }, knows).ok, false);
  assert.equal(validateSourceCreate({ ...goodCreate, config: "nope" }, knows).ok, false);
  const noConfig = validateSourceCreate({ ...goodCreate, config: undefined }, knows);
  assert.ok(noConfig.ok);
  if (noConfig.ok) assert.deepEqual(noConfig.value.config, {});
});

test("validateSourceCreate requires allowlist to be an array of strings", () => {
  assert.equal(validateSourceCreate({ ...goodCreate, chat_tool_allowlist: "all" }, knows).ok, false);
  assert.equal(validateSourceCreate({ ...goodCreate, chat_tool_allowlist: [1] }, knows).ok, false);
  assert.equal(validateSourceCreate({ ...goodCreate, chat_tool_allowlist: [] }, knows).ok, true);
});

test("validateSourceCreate rejects an empty-string secret", () => {
  assert.equal(validateSourceCreate({ ...goodCreate, secret: "" }, knows).ok, false);
});

test("validateSourcePatch accepts partial updates and passes fields through", () => {
  const v = validateSourcePatch({ label: "New name", status: "paused" });
  assert.ok(v.ok);
  if (v.ok) {
    assert.equal(v.value.label, "New name");
    assert.equal(v.value.status, "paused");
    assert.equal(v.value.config, undefined);
  }
});

test("validateSourcePatch rejects an empty patch", () => {
  assert.equal(validateSourcePatch({}).ok, false);
});

test("validateSourcePatch rejects invalid status values", () => {
  assert.equal(validateSourcePatch({ status: "error" }).ok, false);
  assert.equal(validateSourcePatch({ status: "deleted" }).ok, false);
});

test("validateSourcePatch validates label, config, allowlist and secret like create", () => {
  assert.equal(validateSourcePatch({ label: "x".repeat(81) }).ok, false);
  assert.equal(validateSourcePatch({ config: ["a"] }).ok, false);
  assert.equal(validateSourcePatch({ chat_tool_allowlist: [true] }).ok, false);
  assert.equal(validateSourcePatch({ secret: "" }).ok, false);
  assert.equal(validateSourcePatch({ secret: "sk-new" }).ok, true);
});

// --- Prototype-pollution guard on the provider whitelist ---
// getAdapter() resolves providers via `REGISTRY[provider] ?? null`, a plain
// object lookup that returns Object.prototype (truthy) for provider values
// like "__proto__" or the inherited `constructor` function for "constructor".
// The route layer must NOT derive its whitelist check from getAdapter
// truthiness; admin-validation.ts owns an explicit, authoritative whitelist.

test("isKnownProvider accepts only the explicit whitelist", () => {
  assert.equal(isKnownProvider("spiro"), true);
  assert.equal(isKnownProvider("generic_mcp"), true);
  assert.equal(isKnownProvider("stripe"), false);
  assert.equal(isKnownProvider(""), false);
});

test("isKnownProvider rejects __proto__ and constructor (prototype-pollution keys)", () => {
  assert.equal(isKnownProvider("__proto__"), false);
  assert.equal(isKnownProvider("constructor"), false);
  assert.equal(isKnownProvider("toString"), false);
  assert.equal(isKnownProvider("hasOwnProperty"), false);
});

test("validateSourceCreate rejects __proto__/constructor providers via the real isKnownProvider whitelist", () => {
  const protoAttempt = validateSourceCreate({ ...goodCreate, provider: "__proto__" }, isKnownProvider);
  assert.equal(protoAttempt.ok, false);
  if (!protoAttempt.ok) assert.match(protoAttempt.reason, /provider/i);

  const ctorAttempt = validateSourceCreate({ ...goodCreate, provider: "constructor" }, isKnownProvider);
  assert.equal(ctorAttempt.ok, false);
  if (!ctorAttempt.ok) assert.match(ctorAttempt.reason, /provider/i);
});
