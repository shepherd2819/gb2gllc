// lib/analytics/sync.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSyncWindow, groupSourcesByClient } from "./sync";
import type { DataSourceRow } from "./types";

const NOW = new Date("2026-07-07T09:30:00.000Z");

function src(id: string, clientId: string, overrides: Partial<DataSourceRow> = {}): DataSourceRow {
  return {
    id,
    client_id: clientId,
    kind: "rest",
    provider: "spiro",
    label: `Source ${id}`,
    config: {},
    secret_enc: null,
    chat_tool_allowlist: [],
    status: "active",
    last_sync_at: null,
    last_sync_error: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

test("normal window spans the trailing 13 calendar months", () => {
  assert.deepEqual(computeSyncWindow(NOW, false), {
    from: "2025-07-01",
    to: "2026-07-07",
    backfill: false,
  });
});

test("normal window always contains the 60-day day/week-grain span", () => {
  const w = computeSyncWindow(NOW, false);
  const sixtyDaysAgo = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000);
  assert.ok(new Date(`${w.from}T00:00:00.000Z`).getTime() <= sixtyDaysAgo.getTime());
});

test("first sync (last_sync_at null) backfills 24 calendar months", () => {
  assert.deepEqual(computeSyncWindow(NOW, true), {
    from: "2024-08-01",
    to: "2026-07-07",
    backfill: true,
  });
});

test("window month arithmetic crosses year boundaries", () => {
  const january = new Date("2026-01-15T00:00:00.000Z");
  assert.deepEqual(computeSyncWindow(january, false), {
    from: "2025-01-01",
    to: "2026-01-15",
    backfill: false,
  });
});

test("groupSourcesByClient groups by client_id preserving order", () => {
  const a1 = src("a1", "client-a");
  const b1 = src("b1", "client-b");
  const a2 = src("a2", "client-a");
  assert.deepEqual(groupSourcesByClient([a1, b1, a2]), {
    "client-a": [a1, a2],
    "client-b": [b1],
  });
});

test("groupSourcesByClient returns {} for no sources", () => {
  assert.deepEqual(groupSourcesByClient([]), {});
});
