// lib/devagent/workspace.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSlug, parseNumstat } from "./workspace";

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

test("parseNumstat: basic three-column parse", () => {
  const out = "10\t2\tlib/devagent/types.ts\n5\t0\tapp/page.tsx\n";
  const changes = parseNumstat(out);
  assert.deepEqual(changes, [
    { path: "lib/devagent/types.ts", added: 10, deleted: 2 },
    { path: "app/page.tsx", added: 5, deleted: 0 },
  ]);
});

test("parseNumstat: binary file lines parse to 0/0", () => {
  const out = "-\t-\tpublic/logo.png\n";
  const changes = parseNumstat(out);
  assert.deepEqual(changes, [{ path: "public/logo.png", added: 0, deleted: 0 }]);
});

test("parseNumstat: path containing a tab is preserved", () => {
  // git CAN produce paths with tabs (rare but legal on most filesystems).
  // Old impl truncated the path at the third tab; new impl preserves it.
  const out = "3\t1\tweird\tpath/with-tab.ts\n";
  const changes = parseNumstat(out);
  assert.deepEqual(changes, [
    { path: "weird\tpath/with-tab.ts", added: 3, deleted: 1 },
  ]);
});

test("parseNumstat: empty input yields empty list", () => {
  assert.deepEqual(parseNumstat(""), []);
  assert.deepEqual(parseNumstat("\n\n"), []);
});
