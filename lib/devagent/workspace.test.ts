// lib/devagent/workspace.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSlug } from "./workspace";

test("makeSlug: produces date+task slug", () => {
  const d = new Date("2026-05-28T14:33:00Z");
  const slug = makeSlug("Add CSV export to Avery leads", d);
  // YYYY-MM-DD-HHmm-... (UTC)
  assert.match(slug, /^2026-05-28-\d{4}-add-csv-export-to-avery-leads$/);
});

test("makeSlug: sanitizes and truncates", () => {
  const d = new Date("2026-05-28T14:33:00Z");
  const slug = makeSlug("Fix!!! the /\\ very-long string that should be truncated past the limit", d);
  // Body must be alphanumeric+hyphens, no trailing hyphen, length <= 40.
  const body = slug.replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, "");
  assert.ok(body.length > 0 && body.length <= 40, `body length: ${body.length}`);
  assert.match(body, /^[a-z0-9-]+$/);
  assert.equal(body.endsWith("-"), false);
});

test("makeSlug: empty/garbage description still yields a slug", () => {
  const d = new Date("2026-05-28T14:33:00Z");
  const slug = makeSlug("!!!", d);
  assert.match(slug, /^2026-05-28-\d{4}-task$/);
});
