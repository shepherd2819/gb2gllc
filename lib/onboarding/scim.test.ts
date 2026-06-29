import { test } from "node:test";
import assert from "node:assert/strict";
import { planMemberChange, normalizeRole } from "./scim";

test("user.created (active) → upsert with normalized role", () => {
  const p = planMemberChange("dsync.user.created", { organization_id: "org_1", email: "a@x.com", state: "active", role: { slug: "admin" } });
  assert.deepEqual(p, { action: "upsert", organizationId: "org_1", email: "a@x.com", role: "admin" });
});

test("user.updated inactive → delete", () => {
  const p = planMemberChange("dsync.user.updated", { organization_id: "org_1", email: "a@x.com", state: "inactive" });
  assert.equal(p.action, "delete");
});

test("user.deleted → delete", () => {
  const p = planMemberChange("dsync.user.deleted", { organization_id: "org_1", email: "a@x.com" });
  assert.equal(p.action, "delete");
});

test("missing organization_id → ignore", () => {
  assert.equal(planMemberChange("dsync.user.created", { email: "a@x.com" }).action, "ignore");
});

test("group + connection events → ignore", () => {
  assert.equal(planMemberChange("dsync.group.user_added", {}).action, "ignore");
  assert.equal(planMemberChange("dsync.activated", {}).action, "ignore");
});

test("unknown/disallowed role normalizes to member", () => {
  assert.equal(normalizeRole({ slug: "superuser" }), "member");
  assert.equal(normalizeRole("billing"), "billing");
  assert.equal(normalizeRole(null), "member");
});
