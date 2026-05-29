import { test } from "node:test";
import assert from "node:assert/strict";
import { substituteSection, fallbackSections } from "./template";

test("substituteSection replaces a single variable", () => {
  const out = substituteSection("Hello {{name}}.", { name: "World" });
  assert.equal(out, "Hello World.");
});

test("substituteSection replaces multiple occurrences", () => {
  const out = substituteSection("{{a}} and {{a}} and {{b}}", { a: "x", b: "y" });
  assert.equal(out, "x and x and y");
});

test("substituteSection leaves unknown variables literal", () => {
  const out = substituteSection("Hello {{unknown}}.", { name: "World" });
  assert.equal(out, "Hello {{unknown}}.");
});

test("substituteSection handles empty input", () => {
  assert.equal(substituteSection("", { a: "x" }), "");
});

test("fallbackSections returns all 9 keys", () => {
  const out = fallbackSections();
  assert.equal(Object.keys(out.sections).length, 9);
  assert.equal(out.version.startsWith("bundled:"), true);
});
