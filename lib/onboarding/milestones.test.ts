import { test } from "node:test";
import assert from "node:assert/strict";
import { seedRows, nextActionable, progressSummary, type MilestoneView } from "./milestones";

test("seedRows produces insert-ready rows in pending state", () => {
  const rows = seedRows("j1", [{ key: "a", title: "A", owner: "client", sort_order: 0 }]);
  assert.equal(rows[0].journey_id, "j1");
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].key, "a");
});

const ms: MilestoneView[] = [
  { key: "sign_contract", title: "Sign", owner: "client", status: "done", sort_order: 0 },
  { key: "pay_invoice", title: "Pay", owner: "client", status: "pending", sort_order: 1 },
  { key: "book_kickoff", title: "Kickoff", owner: "client", status: "pending", sort_order: 2 },
  { key: "configure_agents", title: "Config", owner: "gb2g", status: "pending", sort_order: 3 },
];

test("nextActionable returns the first pending client milestone by order", () => {
  assert.equal(nextActionable(ms)?.key, "pay_invoice");
});

test("nextActionable skips gb2g-owned and done milestones", () => {
  const done = ms.map((m) => ({ ...m, status: "done" as const }));
  assert.equal(nextActionable(done), null);
});

test("progressSummary counts done/blocked and pct, ignoring skipped", () => {
  const s = progressSummary([
    ...ms,
    { key: "x", title: "X", owner: "gb2g", status: "skipped", sort_order: 9 },
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.done, 1);
  assert.equal(s.pct, 25);
});
