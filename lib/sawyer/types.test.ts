import { test } from "node:test";
import assert from "node:assert/strict";
import { PROPOSAL_STATUSES } from "./types";

test("PROPOSAL_STATUSES has the four lifecycle states", () => {
  assert.deepEqual([...PROPOSAL_STATUSES].sort(), ["accepted", "declined", "draft", "sent"]);
});
