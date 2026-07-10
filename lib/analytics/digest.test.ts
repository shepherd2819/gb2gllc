import { test } from "node:test";
import assert from "node:assert/strict";
import { digestEligibility, escapeHtml, renderDigestHtml } from "./digest";
import type { SnapshotPayload } from "./snapshot";

function makePayload(): SnapshotPayload {
  const months = [
    "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
  ];
  return {
    generatedAt: "2026-07-15T12:00:00.000Z",
    kpis: {
      revenueThisMonth: 100000,
      ordersThisMonth: 250,
      avgOrderValue: 400,
      activeCustomers: 40,
      revenueMoM: 0.25,
      ordersMoM: -0.05,
    },
    trend: months.map((month) => ({ month, revenue: 90000, orders: 230 })),
    productMix: [{ name: "Photos", revenue: 90000 }],
    statusMix: [{ name: "completed", count: 400 }],
    topCompanies: [{ name: "Acme Realty", revenue: 30000, orders: 50 }],
    topAgents: [{ name: "Jane Park", revenue: 25000, orders: 60 }],
    yoy: { revenueYoY: null, ordersYoY: null },
    paceToGoal: { target: null, mtd: 0, projected: 0, fraction: 0, basis: "none" },
    tileSparks: { revenue: [], orders: [], avgOrderValue: [], activeCustomers: [] },
    sources: [],
  };
}

// ── eligibility matrix ─────────────────────────────────────────────────────

test("eligible: active status + digest enabled + at least one source", () => {
  assert.deepEqual(
    digestEligibility({ status: "active", analytics_digest_enabled: true }, 1),
    { eligible: true },
  );
});

test("eligible: null status counts as active (herald precedent)", () => {
  assert.deepEqual(
    digestEligibility({ status: null, analytics_digest_enabled: true }, 2),
    { eligible: true },
  );
});

test("ineligible: non-active client status", () => {
  assert.deepEqual(
    digestEligibility({ status: "churned", analytics_digest_enabled: true }, 1),
    { eligible: false, reason: "client not active" },
  );
});

test("ineligible: digest disabled", () => {
  assert.deepEqual(
    digestEligibility({ status: "active", analytics_digest_enabled: false }, 1),
    { eligible: false, reason: "digest disabled for client" },
  );
});

test("ineligible: zero active sources", () => {
  assert.deepEqual(
    digestEligibility({ status: "active", analytics_digest_enabled: true }, 0),
    { eligible: false, reason: "no active data sources" },
  );
});

// ── escapeHtml ─────────────────────────────────────────────────────────────

test("escapeHtml escapes all five HTML-sensitive characters", () => {
  assert.equal(
    escapeHtml(`Tom & "Jerry" <b>'s</b>`),
    "Tom &amp; &quot;Jerry&quot; &lt;b&gt;&#39;s&lt;/b&gt;",
  );
});

// ── renderDigestHtml ───────────────────────────────────────────────────────

test("renderDigestHtml escapes every interpolated string", () => {
  const html = renderDigestHtml({
    companyName: "Acme <script>alert(1)</script>",
    payload: makePayload(),
    insights: [{ title: 'Revenue & orders "up"', body: "<img src=x>", tone: "up" }],
    portalUrl: "https://home.gb2gllc.com",
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Acme &lt;script&gt;/);
  assert.match(html, /Revenue &amp; orders &quot;up&quot;/);
  assert.match(html, /&lt;img src=x&gt;/);
});

test("renderDigestHtml shows KPI values with MoM deltas and the freshness line", () => {
  const html = renderDigestHtml({
    companyName: "Acme",
    payload: makePayload(),
    insights: [],
    portalUrl: "https://home.gb2gllc.com",
  });
  assert.match(html, /\$100,000/); // revenue this month
  assert.match(html, />250</); // orders this month
  assert.match(html, /\$400/); // average order value
  assert.match(html, /\+25\.0% MoM/); // revenue MoM
  assert.match(html, /-5\.0% MoM/); // orders MoM
  assert.match(html, /Data as of Jul 15, 2026/);
  assert.match(html, /href="https:\/\/home\.gb2gllc\.com\/analytics"/);
});

test("renderDigestHtml omits the insights section when there are no cards", () => {
  const html = renderDigestHtml({
    companyName: "Acme",
    payload: makePayload(),
    insights: [],
    portalUrl: "https://home.gb2gllc.com",
  });
  assert.doesNotMatch(html, /What moved/);
});

test("renderDigestHtml includes insight cards when present", () => {
  const html = renderDigestHtml({
    companyName: "Acme",
    payload: makePayload(),
    insights: [{ title: "Revenue up", body: "Revenue rose 25%.", tone: "up" }],
    portalUrl: "https://home.gb2gllc.com",
  });
  assert.match(html, /What moved/);
  assert.match(html, /Revenue up/);
  assert.match(html, /Revenue rose 25%\./);
  assert.match(html, /AI-generated/);
});
