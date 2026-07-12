// lib/admin-nav.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNav, isNavActive } from "./admin-nav";

const FIXTURE_GROUPS = [
  { label: "Comms", agents: [{ slug: "iris", name: "Iris", glyph: "✉", description: "Inbox triage agent." }] },
  { label: "Money", agents: [{ slug: "nora", name: "Nora", glyph: "$", description: "Finance agent." }] },
];

test("buildNav returns home, work, agents, money sections in order", () => {
  const sections = buildNav(FIXTURE_GROUPS);
  assert.deepEqual(sections.map((s) => s.key), ["home", "work", "agents", "money"]);
});

test("work section contains clients, submissions, support — support carries the tickets badge", () => {
  const work = buildNav(FIXTURE_GROUPS).find((s) => s.key === "work")!;
  const hrefs = work.groups.flatMap((g) => g.items.map((i) => i.href));
  assert.deepEqual(hrefs, ["/clients", "/submissions", "/support"]);
  const support = work.groups[0].items.find((i) => i.href === "/support")!;
  assert.equal(support.badgeKey, "tickets");
});

test("agents section starts with All agents, then one subgroup per manifest group with slug + tooltip carried through", () => {
  const agents = buildNav(FIXTURE_GROUPS).find((s) => s.key === "agents")!;
  assert.equal(agents.groups[0].items[0].href, "/agents");
  assert.equal(agents.groups[1].label, "Comms");
  const iris = agents.groups[1].items[0];
  assert.equal(iris.href, "/agents/iris");
  assert.equal(iris.agentSlug, "iris");
  assert.equal(iris.glyph, "✉");
  assert.equal(iris.title, "Inbox triage agent.");
});

test("money section rescues /journeys into the nav", () => {
  const money = buildNav(FIXTURE_GROUPS).find((s) => s.key === "money")!;
  const hrefs = money.groups.flatMap((g) => g.items.map((i) => i.href));
  assert.deepEqual(hrefs, ["/billing", "/journeys"]);
});

test("isNavActive: /admin and /agents are exact-match; everything else is prefix-match", () => {
  assert.equal(isNavActive("/admin", "/admin"), true);
  assert.equal(isNavActive("/admin/anything", "/admin"), false);
  assert.equal(isNavActive("/agents", "/agents"), true);
  assert.equal(isNavActive("/agents/iris/abc", "/agents"), false);
  assert.equal(isNavActive("/agents/iris/abc", "/agents/iris"), true);
  assert.equal(isNavActive("/clients", "/clients"), true);
  assert.equal(isNavActive("/clients/xyz/logs", "/clients"), true);
  assert.equal(isNavActive("/clientsfoo", "/clients"), false);
});
