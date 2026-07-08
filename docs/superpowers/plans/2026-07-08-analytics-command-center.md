# Analytics Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the shipped analytics dashboard into a dark, motion-rich executive "command center" (client-impressing WOW) — a hero north-star + pace-to-goal ring, sparkline KPI tiles, an AI narrative briefing, an area+brush trend, clickable ranked lists → slide-over deep-dives, and a full-screen presentation mode.

**Architecture:** Pure additions on top of the existing warehouse/snapshot/SVG-chart-kit/Anthropic layer. A dark theme is scoped to a `.cc-root` wrapper (portal stays light elsewhere) by remapping semantic `--color-*` tokens. `computeSnapshot` gains additive fields (yoy, paceToGoal, tileSparks); a new post-sync `generateBriefing` writes a narrative; two new portal routes (entity drill-through, briefing regenerate) + an admin goal route. `AnalyticsDashboard` restructures into Overview→Explore→Deep-dive.

**Tech Stack:** Next.js 16.2.6 (App Router, nonstandard), Supabase (service-role), Inngest, raw `@anthropic-ai/sdk`, hand-rolled SVG charts, node --test via tsx. No new dependency.

## Global Constraints

- **Nonstandard Next.js 16.2.6:** `params`/`searchParams` are Promises — `await` them; `proxy.ts` not `middleware.ts`; route handlers export `const dynamic = "force-dynamic"` (+ `maxDuration` when long); no Server Actions; no root `app/layout.tsx`; server components by default, `"use client"` only for interactive islands.
- **Tenant isolation is MANUAL:** portal routes derive `clientId` from `getPortalClientId(user.id)` (never body/query) and scope every warehouse query by `client_id`; admin routes use `requireAdmin()` + the awaited `[id]` param.
- **AI:** raw `@anthropic-ai/sdk` via `import { anthropic } from "@/lib/anthropic"`, lazy-imported inside async functions so pure exports test without `ANTHROPIC_API_KEY`. Model const `"claude-sonnet-4-6"`.
- **Colors:** only semantic CSS vars (`var(--color-*)`) in all chart/UI code — NEVER hex. The ONLY place literal dark hex is allowed is the `.cc-root` token-remap block in `public/analytics/command-center.css` (that IS the palette definition, exactly like `public/admin/admin.css`'s `[data-theme="dark"]` block).
- **CSS:** new files or append; never rewrite `public/tokens.css` / `portal.css` / `admin.css`.
- **Motion:** every animation/transition gated under `@media (prefers-reduced-motion: reduce)`.
- **Migration:** `033_analytics_command_center.sql` is additive (two columns on `analytics_snapshots`, no RLS change); applied manually at rollout. Confirm 033 is the next free number (`ls supabase/migrations/`).
- **Tests:** `node --test` via tsx, files match `lib/**/*.test.ts`; `import { test } from "node:test"; import assert from "node:assert/strict";`. Full gates per task: `npm test` + `npm run typecheck` green before each commit. A pre-existing flaky `lib/devagent/run.test.ts` may intermittently fail the full suite — re-run to confirm; analytics tests must be deterministic.
- **Commits:** one per task, `feat(analytics): <what>`, ending with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Concurrent-session hygiene:** `git add` only the files a task names — the tree has another session's uncommitted `lib/legal-page.ts`, `app/trust/`, `docs/*`. Never `git add -A`.

---

## Phase 1 — Foundations (data, geometry, AI briefing)

### Task 1: Migration 033 + additive snapshot fields + goal/briefing store persistence
**Files:**
- Create `supabase/migrations/033_analytics_command_center.sql`
- Modify `lib/analytics/snapshot.ts` — extend `SnapshotPayload` type with `yoy`/`paceToGoal`/`tileSparks`; add `opts?` param to `computeSnapshot` and **seed** the three new fields in its return; extend `SnapshotRow` with `briefing`/`goal`
- Modify `lib/analytics/store.ts` — `readSnapshot` selects/maps `briefing`+`goal_json`; `writeSnapshot` gains optional `briefing` + never writes `goal_json`; add `setClientGoal`
- Modify (test) `lib/analytics/snapshot.test.ts` — one new test for the seeded additive fields

**Interfaces:**
- Consumes: `StoredMetric`, `DataSourceRow` from `lib/analytics/types.ts`; `InsightCard` from `lib/analytics/insights.ts`; `supabaseAdmin` from `@/lib/supabase`.
- Produces (relied on by Tasks 3, 4 and later UI/route slices):
  - `SnapshotPayload` gains `yoy: { revenueYoY: number | null; ordersYoY: number | null }`, `paceToGoal: { target: number | null; mtd: number; projected: number; fraction: number; basis: "goal"|"yoy"|"trailing"|"none" }`, `tileSparks: { revenue: number[]; orders: number[]; avgOrderValue: number[]; activeCustomers: number[] }`
  - `computeSnapshot(metrics: StoredMetric[], sources: DataSourceRow[], now: Date, opts?: { goal?: Record<string, number> }): SnapshotPayload`
  - `SnapshotRow` gains `briefing: string; goal: Record<string, number>`
  - `readSnapshot(clientId: string): Promise<SnapshotRow | null>` (now populates `briefing`/`goal`)
  - `writeSnapshot(clientId: string, payload: SnapshotPayload, insights: InsightCard[] | null | undefined, briefing?: string): Promise<void>`
  - `setClientGoal(clientId: string, goal: Record<string, number>): Promise<void>`

Steps:

- [ ] Write the failing test. Append to `lib/analytics/snapshot.test.ts` (uses the existing `NOW`, `computeSnapshot`, `assert` already imported at the top of that file):
```ts
test("computeSnapshot seeds additive command-center fields (empty warehouse)", () => {
  const p = computeSnapshot([], [], NOW);
  assert.deepEqual(p.yoy, { revenueYoY: null, ordersYoY: null });
  assert.deepEqual(p.paceToGoal, { target: null, mtd: 0, projected: 0, fraction: 0, basis: "none" });
  assert.equal(p.tileSparks.revenue.length, 13);
  assert.equal(p.tileSparks.orders.length, 13);
  assert.equal(p.tileSparks.avgOrderValue.length, 13);
  assert.equal(p.tileSparks.activeCustomers.length, 13);
  assert.ok(p.tileSparks.revenue.every((v) => v === 0));
  assert.ok(p.tileSparks.orders.every((v) => v === 0));
});
```

- [ ] Run it: `node --import tsx --test lib/analytics/snapshot.test.ts` — expected FAIL: the new test throws `AssertionError` because `p.yoy` is `undefined` (`deepEqual(undefined, { revenueYoY: null, ordersYoY: null })`); the run reports `# fail 1` while the 8 pre-existing snapshot tests still pass.

- [ ] Create the migration `supabase/migrations/033_analytics_command_center.sql`:
```sql
-- ============================================================
-- 033_analytics_command_center.sql — Command Center additions
-- ============================================================
-- Additive columns on analytics_snapshots for the executive command center:
-- the AI-written briefing narrative and per-client monthly goal targets
-- (pace-to-goal reads goal_json.revenue). No new tables, no RLS change — the
-- existing "service role only" policy on analytics_snapshots covers both new
-- columns. Applied manually at rollout (convention).

ALTER TABLE analytics_snapshots ADD COLUMN briefing TEXT;
ALTER TABLE analytics_snapshots ADD COLUMN goal_json JSONB NOT NULL DEFAULT '{}'::jsonb;
```

- [ ] Implement the type + seed in `lib/analytics/snapshot.ts`. Replace the `SnapshotPayload` type block (currently lines 10–33) with the version below (adds `yoy`/`paceToGoal`/`tileSparks` before `sources`):
```ts
export type SnapshotPayload = {
  generatedAt: string;
  kpis: {
    revenueThisMonth: number;
    ordersThisMonth: number;
    avgOrderValue: number;
    activeCustomers: number;
    revenueMoM: number | null;
    ordersMoM: number | null;
  };
  trend: Array<{ month: string; revenue: number; orders: number }>;
  productMix: Array<{ name: string; revenue: number }>;
  statusMix: Array<{ name: string; count: number }>;
  topCompanies: Array<{ name: string; revenue: number; orders: number }>;
  topAgents: Array<{ name: string; revenue: number; orders: number }>;
  yoy: { revenueYoY: number | null; ordersYoY: number | null };
  paceToGoal: {
    target: number | null;
    mtd: number;
    projected: number;
    fraction: number;
    basis: "goal" | "yoy" | "trailing" | "none";
  };
  tileSparks: {
    revenue: number[];
    orders: number[];
    avgOrderValue: number[];
    activeCustomers: number[];
  };
  sources: Array<{
    id: string;
    label: string;
    provider: string;
    status: string;
    lastSyncAt: string | null;
    lastSyncError: string | null;
  }>;
};
```
Then replace the `SnapshotRow` type block (currently lines 35–40) with:
```ts
export type SnapshotRow = {
  client_id: string;
  payload: SnapshotPayload;
  insights: InsightCard[];
  briefing: string;
  goal: Record<string, number>;
  computed_at: string;
};
```
Then replace the entire `computeSnapshot` function (currently lines 59–167) with this seed version — identical body plus the new `opts` param and the three seeded return fields (`void opts;` keeps the param consumed; real computation lands in Task 3):
```ts
export function computeSnapshot(
  metrics: StoredMetric[],
  sources: DataSourceRow[],
  now: Date,
  opts?: { goal?: Record<string, number> },
): SnapshotPayload {
  void opts; // consumed by the pace-to-goal computation added in a later task
  // "2025-07" … "2026-07": oldest → newest, TREND_MONTHS entries.
  const months: string[] = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`);
  }
  const currentMonth = months[months.length - 1];
  const prevMonth = months[months.length - 2];
  const mixMonths = new Set(months.slice(-MIX_MONTHS));

  const monthRows = metrics.filter((m) => m.grain === "month");
  const monthOf = (m: StoredMetric) => m.period_start.slice(0, 7);
  const isUndimensioned = (m: StoredMetric) => Object.keys(m.dimension).length === 0;

  const sumUndim = (metric: string, month: string): number =>
    monthRows
      .filter((m) => m.metric === metric && isUndimensioned(m) && monthOf(m) === month)
      .reduce((acc, m) => acc + m.value, 0);

  // ── KPIs (current calendar month) ──────────────────────────────────────
  const revenueThisMonth = round2(sumUndim("orders.revenue", currentMonth));
  const ordersThisMonth = round2(sumUndim("orders.count", currentMonth));
  const avgOrderValue = ordersThisMonth > 0 ? round2(revenueThisMonth / ordersThisMonth) : 0;

  const activeCustomers = new Set(
    monthRows
      .filter(
        (m) => monthOf(m) === currentMonth && m.dimension.company && m.dimension.company !== OTHER,
      )
      .map((m) => m.dimension.company),
  ).size;

  const prevRevenue = sumUndim("orders.revenue", prevMonth);
  const prevOrders = sumUndim("orders.count", prevMonth);
  const revenueMoM = prevRevenue > 0 ? round4((revenueThisMonth - prevRevenue) / prevRevenue) : null;
  const ordersMoM = prevOrders > 0 ? round4((ordersThisMonth - prevOrders) / prevOrders) : null;

  // ── 13-month trend, zero-filled ────────────────────────────────────────
  const trend = months.map((month) => ({
    month,
    revenue: round2(sumUndim("orders.revenue", month)),
    orders: round2(sumUndim("orders.count", month)),
  }));

  // ── Dimensioned aggregates over the trailing MIX_MONTHS months ────────
  const aggregate = (metric: string, dim: string): Map<string, number> => {
    const out = new Map<string, number>();
    for (const m of monthRows) {
      if (m.metric !== metric) continue;
      if (!mixMonths.has(monthOf(m))) continue;
      const key = m.dimension[dim];
      if (!key) continue;
      out.set(key, (out.get(key) ?? 0) + m.value);
    }
    return out;
  };

  const productRevenue = aggregate("orders.revenue", "product");
  const productMix = [...productRevenue.entries()]
    .filter(([name]) => name !== OTHER)
    .sort((a, b) => b[1] - a[1])
    .map(([name, revenue]) => ({ name, revenue: round2(revenue) }));
  const otherRevenue = productRevenue.get(OTHER);
  if (otherRevenue !== undefined) productMix.push({ name: "Other", revenue: round2(otherRevenue) });

  const statusCounts = aggregate("orders.count", "status");
  const statusMix = [...statusCounts.entries()]
    .filter(([name]) => name !== OTHER)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count: round2(count) }));

  const topList = (dim: string): Array<{ name: string; revenue: number; orders: number }> => {
    const revenue = aggregate("orders.revenue", dim);
    const orders = aggregate("orders.count", dim);
    const names = new Set([...revenue.keys(), ...orders.keys()]);
    names.delete(OTHER);
    return [...names]
      .map((name) => ({
        name,
        revenue: round2(revenue.get(name) ?? 0),
        orders: round2(orders.get(name) ?? 0),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, TOP_N);
  };

  return {
    generatedAt: now.toISOString(),
    kpis: { revenueThisMonth, ordersThisMonth, avgOrderValue, activeCustomers, revenueMoM, ordersMoM },
    trend,
    productMix,
    statusMix,
    topCompanies: topList("company"),
    topAgents: topList("agent"),
    yoy: { revenueYoY: null, ordersYoY: null },
    paceToGoal: { target: null, mtd: 0, projected: 0, fraction: 0, basis: "none" },
    tileSparks: {
      revenue: trend.map((t) => t.revenue),
      orders: trend.map((t) => t.orders),
      avgOrderValue: months.map(() => 0),
      activeCustomers: months.map(() => 0),
    },
    sources: sources.map((s) => ({
      id: s.id,
      label: s.label,
      provider: s.provider,
      status: s.status,
      lastSyncAt: s.last_sync_at,
      lastSyncError: s.last_sync_error,
    })),
  };
}
```

- [ ] Implement store persistence in `lib/analytics/store.ts`. Replace the existing `readSnapshot` function (currently lines 143–157) with:
```ts
export async function readSnapshot(clientId: string): Promise<SnapshotRow | null> {
  const { data, error } = await supabaseAdmin
    .from("analytics_snapshots")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(`readSnapshot: ${error.message}`);
  if (!data) return null;
  const goalRaw = data.goal_json;
  return {
    client_id: String(data.client_id),
    payload: data.payload as SnapshotPayload,
    insights: (Array.isArray(data.insights) ? data.insights : []) as InsightCard[],
    briefing: typeof data.briefing === "string" ? data.briefing : "",
    goal:
      goalRaw && typeof goalRaw === "object" && !Array.isArray(goalRaw)
        ? (goalRaw as Record<string, number>)
        : {},
    computed_at: String(data.computed_at),
  };
}
```
Then replace the existing `writeSnapshot` function (currently lines 159–183, including its leading comment) with the version below. It drops the read-then-write and instead uses PostgREST partial-upsert semantics (columns absent from the payload are untouched on conflict, take defaults on first insert), which is exactly what preserves `goal_json` on every recompute:
```ts
// insights null|undefined = preserve existing cards (recompute refreshes the
// payload without clobbering the last good AI generation). briefing undefined =
// preserve the stored briefing; a string (incl. "") overwrites it. goal_json is
// NEVER written here, so an admin-set goal always survives a recompute (partial
// upsert leaves unlisted columns untouched on conflict; column default on first
// insert).
export async function writeSnapshot(
  clientId: string,
  payload: SnapshotPayload,
  insights: InsightCard[] | null | undefined,
  briefing?: string,
): Promise<void> {
  const row: Record<string, unknown> = {
    client_id: clientId,
    payload,
    computed_at: new Date().toISOString(),
  };
  if (insights != null) row.insights = insights;
  if (briefing !== undefined) row.briefing = briefing;
  const { error } = await supabaseAdmin
    .from("analytics_snapshots")
    .upsert(row, { onConflict: "client_id" });
  if (error) throw new Error(`writeSnapshot: ${error.message}`);
}

// Upsert ONLY goal_json for a client (partial upsert). On conflict the existing
// payload/insights/briefing are left untouched; on first insert a stub row is
// created (payload/insights/briefing take their column defaults). clientId must
// come from the admin [id] route param under requireAdmin() — never a body.
export async function setClientGoal(clientId: string, goal: Record<string, number>): Promise<void> {
  const { error } = await supabaseAdmin
    .from("analytics_snapshots")
    .upsert({ client_id: clientId, goal_json: goal }, { onConflict: "client_id" });
  if (error) throw new Error(`setClientGoal: ${error.message}`);
}
```

- [ ] Run the test again: `node --import tsx --test lib/analytics/snapshot.test.ts` — expected PASS: the new seed test is green and all pre-existing snapshot tests still pass (`# fail 0`).

- [ ] Verify types across all call sites: `npm run typecheck` — expected pass with no errors. Confirms the widened `writeSnapshot` insights param still accepts the existing 3-arg call in `lib/inngest/functions/analytics-sync.ts:119`, the new required `SnapshotRow` fields are only constructed in `readSnapshot`, and `report-pdf.tsx`/`chat.ts`/`digest.ts` (which only consume `SnapshotRow`) still compile.

- [ ] Commit: `git add supabase/migrations/033_analytics_command_center.sql lib/analytics/snapshot.ts lib/analytics/snapshot.test.ts lib/analytics/store.ts` then `git commit -m "feat(analytics): migration 033 + additive snapshot fields + goal/briefing store persistence"`.

### Task 2: ringArc / areaPath / brushWindow chart geometry
**Files:**
- Modify `lib/analytics/charts.ts` — add three exported pure functions (reusing the module-private `f`, `pointOnCircle`, `TAU`)
- Modify (test) `lib/analytics/charts.test.ts` — extend the import and add coverage

**Interfaces:**
- Consumes: module-private `f`, `pointOnCircle`, `TAU` already in `lib/analytics/charts.ts` (no new imports).
- Produces (relied on by `components/charts/Ring.tsx`, `components/charts/Sparkline.tsx`, `components/analytics/command-center/CcTrend.tsx`):
  - `ringArc(fraction: number, radius: number, thickness: number): string`
  - `areaPath(points: Array<{ x: number; y: number }>, baselineY: number): string`
  - `brushWindow(totalCount: number, fromFrac: number, toFrac: number): { startIndex: number; endIndex: number }`

Steps:

- [ ] Write the failing tests. Change the import line at the top of `lib/analytics/charts.test.ts` from `import { linePath, scaleLinear, donutSegments, niceTicks } from "./charts";` to:
```ts
import { linePath, scaleLinear, donutSegments, niceTicks, ringArc, areaPath, brushWindow } from "./charts";
```
Then append these tests:
```ts
test("ringArc: partial arc below 50% sets large-arc flag 0, starts at 12 o'clock", () => {
  assert.equal(ringArc(0.25, 50, 10), "M 0 -50 A 50 50 0 0 1 50 0 L 40 0 A 40 40 0 0 0 0 -40 Z");
});

test("ringArc: arc crossing 50% sets large-arc flag 1", () => {
  assert.equal(ringArc(0.75, 50, 10), "M 0 -50 A 50 50 0 1 1 -50 0 L -40 0 A 40 40 0 1 0 0 -40 Z");
});

test("ringArc: fraction >= 1 renders a full annulus (two subpaths, inner radius = R - thickness)", () => {
  const full = ringArc(1, 50, 10);
  assert.match(full, /Z M 40 0/);
  assert.equal(ringArc(1.5, 50, 10), full); // clamped to 1
});

test("ringArc: fraction <= 0 is empty", () => {
  assert.equal(ringArc(0, 50, 10), "");
  assert.equal(ringArc(-0.3, 50, 10), "");
});

test("areaPath: empty points → empty string", () => {
  assert.equal(areaPath([], 100), "");
});

test("areaPath: closes down to the baseline and back to the first x", () => {
  assert.equal(
    areaPath([{ x: 0, y: 10 }, { x: 5, y: 20 }, { x: 10, y: 0 }], 100),
    "M 0 10 L 5 20 L 10 0 L 10 100 L 0 100 Z",
  );
});

test("brushWindow: full 0..1 selection spans every index", () => {
  assert.deepEqual(brushWindow(13, 0, 1), { startIndex: 0, endIndex: 12 });
});

test("brushWindow: fractional selection rounds to inclusive indices", () => {
  assert.deepEqual(brushWindow(13, 0, 0.5), { startIndex: 0, endIndex: 6 });
});

test("brushWindow: reversed inputs are normalized so start <= end", () => {
  assert.deepEqual(brushWindow(13, 0.8, 0.2), { startIndex: 2, endIndex: 10 });
});

test("brushWindow: out-of-range fractions clamp to [0,1]", () => {
  assert.deepEqual(brushWindow(13, -0.5, 2), { startIndex: 0, endIndex: 12 });
});

test("brushWindow: empty or single-item series never produce a bad range", () => {
  assert.deepEqual(brushWindow(0, 0, 1), { startIndex: 0, endIndex: 0 });
  assert.deepEqual(brushWindow(1, 0.3, 0.9), { startIndex: 0, endIndex: 0 });
});
```

- [ ] Run it: `node --import tsx --test lib/analytics/charts.test.ts` — expected FAIL: `SyntaxError`/binding error because `ringArc`, `areaPath`, `brushWindow` are not exported from `./charts` (the import resolves to `undefined`, calling them throws `TypeError`); the run reports failures for the new tests while the existing chart tests still pass.

- [ ] Implement the three functions. Append to `lib/analytics/charts.ts` (after `niceTicks`, end of file):
```ts
/**
 * Gauge arc as a filled annulus wedge (like one donutSegments slice) sweeping
 * clockwise from 12 o'clock by `fraction` of a full turn. fraction clamps to
 * [0,1]; <=0 → "" (nothing to draw); >=1 → full ring (two-subpath annulus).
 * Outer radius = radius, inner radius = radius - thickness.
 */
export function ringArc(fraction: number, radius: number, thickness: number): string {
  const frac = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const R = radius;
  const r = Math.max(0, radius - thickness);
  if (frac <= 0) return "";
  if (frac >= 1) {
    return (
      `M ${f(R)} 0 A ${f(R)} ${f(R)} 0 1 1 ${f(-R)} 0 A ${f(R)} ${f(R)} 0 1 1 ${f(R)} 0 Z ` +
      `M ${f(r)} 0 A ${f(r)} ${f(r)} 0 1 0 ${f(-r)} 0 A ${f(r)} ${f(r)} 0 1 0 ${f(r)} 0 Z`
    );
  }
  const a0 = -Math.PI / 2; // 12 o'clock
  const sweep = frac * TAU;
  const a1 = a0 + sweep;
  const large = sweep > Math.PI ? 1 : 0;
  const o0 = pointOnCircle(a0, R);
  const o1 = pointOnCircle(a1, R);
  const i1 = pointOnCircle(a1, r);
  const i0 = pointOnCircle(a0, r);
  return (
    `M ${f(o0.x)} ${f(o0.y)} ` +
    `A ${f(R)} ${f(R)} 0 ${large} 1 ${f(o1.x)} ${f(o1.y)} ` +
    `L ${f(i1.x)} ${f(i1.y)} ` +
    `A ${f(r)} ${f(r)} 0 ${large} 0 ${f(i0.x)} ${f(i0.y)} Z`
  );
}

/**
 * Closed area under a polyline: the line across `points`, then down to
 * `baselineY` under the last point, back to `baselineY` under the first point,
 * and Z. "" for empty input.
 */
export function areaPath(points: Array<{ x: number; y: number }>, baselineY: number): string {
  if (points.length === 0) return "";
  const top = points.map((p, i) => `${i === 0 ? "M" : "L"} ${f(p.x)} ${f(p.y)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  return `${top} L ${f(last.x)} ${f(baselineY)} L ${f(first.x)} ${f(baselineY)} Z`;
}

/**
 * Map a normalized [0,1] brush selection to inclusive array indices over
 * `totalCount` items. Fractions clamp to [0,1], min/max are normalized so
 * startIndex <= endIndex, and indices clamp to [0, totalCount-1]. Empty series
 * → { 0, 0 }. Pure — the trend brush reslices client-side without refetching.
 */
export function brushWindow(
  totalCount: number,
  fromFrac: number,
  toFrac: number,
): { startIndex: number; endIndex: number } {
  if (totalCount <= 0) return { startIndex: 0, endIndex: 0 };
  const lastIndex = totalCount - 1;
  const clampFrac = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  const lo = clampFrac(Math.min(fromFrac, toFrac));
  const hi = clampFrac(Math.max(fromFrac, toFrac));
  let startIndex = Math.min(lastIndex, Math.max(0, Math.round(lo * lastIndex)));
  const endIndex = Math.min(lastIndex, Math.max(0, Math.round(hi * lastIndex)));
  if (startIndex > endIndex) startIndex = endIndex;
  return { startIndex, endIndex };
}
```

- [ ] Run it again: `node --import tsx --test lib/analytics/charts.test.ts` — expected PASS: all new geometry tests plus the pre-existing chart tests are green (`# fail 0`).

- [ ] Commit: `git add lib/analytics/charts.ts lib/analytics/charts.test.ts` then `git commit -m "feat(analytics): ringArc/areaPath/brushWindow chart geometry"`.

### Task 3: Snapshot yoy, pace-to-goal, per-KPI sparklines
**Files:**
- Modify `lib/analytics/snapshot.ts` — replace the Task 1 seed inside `computeSnapshot` with the real yoy / paceToGoal / tileSparks computation (consuming `opts.goal`)
- Modify (test) `lib/analytics/snapshot.test.ts` — add golden coverage (goal basis, fallback chain, yoy-missing, sparkline series, empty warehouse)

**Interfaces:**
- Consumes: `SnapshotPayload` shape + `computeSnapshot(..., opts?: { goal?: Record<string, number> })` declared in Task 1; module-private `round2`/`round4`/`pad2`/`OTHER`/`sumUndim`.
- Produces: same field names/signatures as Task 1 declared (`yoy`, `paceToGoal`, `tileSparks`), now fully computed — no signature change.

Steps:

- [ ] Write the failing golden tests. Append to `lib/analytics/snapshot.test.ts` (reuses the existing `row`, `source`, `NOW`, `computeSnapshot`, `assert`):
```ts
test("yoy compares against the same calendar month last year", () => {
  const rows = [
    row("orders.revenue", "2026-07-01", 100000),
    row("orders.count", "2026-07-01", 250),
    row("orders.revenue", "2025-07-01", 80000),
    row("orders.count", "2025-07-01", 200),
  ];
  const p = computeSnapshot(rows, [source()], NOW);
  assert.equal(p.yoy.revenueYoY, 0.25); // (100000-80000)/80000
  assert.equal(p.yoy.ordersYoY, 0.25); // (250-200)/200
});

test("yoy is null when the same month last year is missing or zero", () => {
  const rows = [
    row("orders.revenue", "2026-07-01", 100000),
    row("orders.count", "2026-07-01", 250),
  ];
  const p = computeSnapshot(rows, [source()], NOW);
  assert.equal(p.yoy.revenueYoY, null);
  assert.equal(p.yoy.ordersYoY, null);
});

test("paceToGoal uses the admin goal and a run-rate projection when a goal is set", () => {
  const rows = [
    row("orders.revenue", "2026-07-01", 100000),
    row("orders.count", "2026-07-01", 250),
  ];
  const p = computeSnapshot(rows, [source()], NOW, { goal: { revenue: 150000 } });
  assert.equal(p.paceToGoal.basis, "goal");
  assert.equal(p.paceToGoal.target, 150000);
  assert.equal(p.paceToGoal.mtd, 100000);
  assert.equal(p.paceToGoal.projected, 206666.67); // 100000 * 31 / 15 (day 15 of July)
  assert.equal(p.paceToGoal.fraction, 1.3778); // 206666.67 / 150000
});

test("paceToGoal falls back goal → yoy → trailing → none", () => {
  const base = [
    row("orders.revenue", "2026-07-01", 100000),
    row("orders.count", "2026-07-01", 250),
  ];

  const withYoY = computeSnapshot(
    [...base, row("orders.revenue", "2025-07-01", 90000)],
    [source()],
    NOW,
  );
  assert.equal(withYoY.paceToGoal.basis, "yoy");
  assert.equal(withYoY.paceToGoal.target, 90000);

  const withTrailing = computeSnapshot(
    [
      ...base,
      row("orders.revenue", "2026-06-01", 60000),
      row("orders.revenue", "2026-05-01", 30000),
      row("orders.revenue", "2026-04-01", 30000),
    ],
    [source()],
    NOW,
  );
  assert.equal(withTrailing.paceToGoal.basis, "trailing");
  assert.equal(withTrailing.paceToGoal.target, 40000); // (60000+30000+30000)/3

  const none = computeSnapshot(base, [source()], NOW);
  assert.equal(none.paceToGoal.basis, "none");
  assert.equal(none.paceToGoal.target, null);
  assert.equal(none.paceToGoal.fraction, 0);
});

test("tileSparks are 13-month per-KPI series, oldest first, derived from the trend", () => {
  const rows = [
    row("orders.revenue", "2026-07-01", 100000),
    row("orders.count", "2026-07-01", 250),
    row("orders.revenue", "2025-09-01", 152925),
    row("orders.count", "2025-09-01", 507),
    row("orders.count", "2026-07-01", 50, { company: "Acme Realty" }),
    row("orders.count", "2026-07-01", 40, { company: "Bluebird Homes" }),
    row("orders.count", "2026-07-01", 10, { company: "__other__" }),
  ];
  const p = computeSnapshot(rows, [source()], NOW);
  assert.equal(p.tileSparks.revenue.length, 13);
  assert.equal(p.tileSparks.orders.length, 13);
  assert.equal(p.tileSparks.avgOrderValue.length, 13);
  assert.equal(p.tileSparks.activeCustomers.length, 13);
  assert.equal(p.tileSparks.revenue[12], 100000); // current month = last entry
  assert.equal(p.tileSparks.orders[12], 250);
  assert.equal(p.tileSparks.avgOrderValue[12], 400); // 100000 / 250
  assert.equal(p.tileSparks.revenue[2], 152925); // 2025-09 = index 2
  assert.equal(p.tileSparks.avgOrderValue[2], 301.63); // 152925 / 507
  assert.equal(p.tileSparks.activeCustomers[12], 2); // Acme + Bluebird, __other__ excluded
  assert.equal(p.tileSparks.activeCustomers[0], 0); // 2025-07 has no company dims
});

test("empty warehouse yields none-basis pace and zeroed sparklines", () => {
  const p = computeSnapshot([], [], NOW);
  assert.deepEqual(p.yoy, { revenueYoY: null, ordersYoY: null });
  assert.deepEqual(p.paceToGoal, { target: null, mtd: 0, projected: 0, fraction: 0, basis: "none" });
  assert.ok(p.tileSparks.avgOrderValue.every((v) => v === 0));
  assert.ok(p.tileSparks.activeCustomers.every((v) => v === 0));
});
```

- [ ] Run it: `node --import tsx --test lib/analytics/snapshot.test.ts` — expected FAIL: the Task 1 seed returns `yoy` nulls, `paceToGoal` `{ basis: "none", … }`, and zeroed `avgOrderValue`/`activeCustomers` regardless of input, so the goal/yoy/trailing/sparkline assertions throw `AssertionError` (multiple `# fail`), while the Task 1 seed test and pre-existing tests stay green.

- [ ] Implement the real computation. In `lib/analytics/snapshot.ts`, first delete the `void opts;` line at the top of `computeSnapshot`. Then insert the following block immediately **after** the `const trend = months.map(...)` assignment and **before** the `// ── Dimensioned aggregates …` comment:
```ts
  // ── Year-over-year (same calendar month last year = months[0]) ─────────
  const yoyMonth = months[0];
  const prevYearRevenue = sumUndim("orders.revenue", yoyMonth);
  const prevYearOrders = sumUndim("orders.count", yoyMonth);
  const revenueYoY =
    prevYearRevenue > 0 ? round4((revenueThisMonth - prevYearRevenue) / prevYearRevenue) : null;
  const ordersYoY =
    prevYearOrders > 0 ? round4((ordersThisMonth - prevYearOrders) / prevYearOrders) : null;

  // ── Pace to goal: run-rate projection vs a target (goal→yoy→trailing→none)
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const dayOfMonth = now.getUTCDate();
  const mtd = revenueThisMonth;
  const projected = round2(dayOfMonth > 0 ? (mtd * daysInMonth) / dayOfMonth : mtd);

  const goalRevenue = opts?.goal?.revenue;
  const trailing3 = trend.slice(-4, -1); // the three completed months before current
  const trailing3Avg =
    trailing3.length > 0 ? trailing3.reduce((s, t) => s + t.revenue, 0) / trailing3.length : 0;

  let target: number | null;
  let basis: "goal" | "yoy" | "trailing" | "none";
  if (typeof goalRevenue === "number" && goalRevenue > 0) {
    target = round2(goalRevenue);
    basis = "goal";
  } else if (prevYearRevenue > 0) {
    target = round2(prevYearRevenue);
    basis = "yoy";
  } else if (trailing3Avg > 0) {
    target = round2(trailing3Avg);
    basis = "trailing";
  } else {
    target = null;
    basis = "none";
  }
  const fraction = target && target > 0 ? round4(projected / target) : 0;
  const paceToGoal = { target, mtd: round2(mtd), projected, fraction, basis };

  // ── Per-KPI 13-month sparkline series (oldest first) ───────────────────
  const tileSparks = {
    revenue: trend.map((t) => t.revenue),
    orders: trend.map((t) => t.orders),
    avgOrderValue: trend.map((t) => (t.orders > 0 ? round2(t.revenue / t.orders) : 0)),
    activeCustomers: months.map(
      (month) =>
        new Set(
          monthRows
            .filter(
              (m) => monthOf(m) === month && m.dimension.company && m.dimension.company !== OTHER,
            )
            .map((m) => m.dimension.company),
        ).size,
    ),
  };
```
Then replace the three seed lines in the `return {…}` object:
```ts
    yoy: { revenueYoY: null, ordersYoY: null },
    paceToGoal: { target: null, mtd: 0, projected: 0, fraction: 0, basis: "none" },
    tileSparks: {
      revenue: trend.map((t) => t.revenue),
      orders: trend.map((t) => t.orders),
      avgOrderValue: months.map(() => 0),
      activeCustomers: months.map(() => 0),
    },
```
with the computed values:
```ts
    yoy: { revenueYoY, ordersYoY },
    paceToGoal,
    tileSparks,
```

- [ ] Run it again: `node --import tsx --test lib/analytics/snapshot.test.ts` — expected PASS: the six new golden tests, the Task 1 seed test, and all pre-existing snapshot tests are green (`# fail 0`).

- [ ] Verify types: `npm run typecheck` — expected pass (the `computeSnapshot` return shape still matches `SnapshotPayload`).

- [ ] Commit: `git add lib/analytics/snapshot.ts lib/analytics/snapshot.test.ts` then `git commit -m "feat(analytics): snapshot yoy, pace-to-goal, per-KPI sparklines"`.

### Task 4: AI executive briefing generator + sync wiring + regenerate route
**Files:**
- Create `lib/analytics/briefing.ts` — mirrors `insights.ts` (pure input builder + parser, lazy anthropic call)
- Create (test) `lib/analytics/briefing.test.ts` — input-builder + parse/clamp/garbage coverage, no network
- Modify `lib/inngest/functions/analytics-sync.ts` — per-client snapshot step reads the goal, computes with it, generates the briefing, persists it
- Create `app/api/portal/analytics/briefing/regenerate/route.ts` — on-demand regenerate

**Interfaces:**
- Consumes: `SnapshotPayload` from `lib/analytics/snapshot.ts`; `readSnapshot`/`writeSnapshot`/`recordEvent` from `lib/analytics/store.ts` (Task 1); `anthropic` from `@/lib/anthropic` (lazy); `computeSnapshot` (test only); `withAuth` from `@workos-inc/authkit-nextjs`; `getPortalClientId` from `@/lib/portal-auth`.
- Produces (relied on by `components/analytics/command-center/CcBriefing.tsx` and the analytics page):
  - `BRIEFING_MODEL = "claude-sonnet-4-6"`
  - `buildBriefingInput(payload: SnapshotPayload): string`
  - `parseBriefing(raw: string): string`
  - `generateBriefing(payload: SnapshotPayload): Promise<string>`
  - route `POST /api/portal/analytics/briefing/regenerate` → `{ briefing: string }`

Steps:

- [ ] Write the failing test. Create `lib/analytics/briefing.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBriefingInput, parseBriefing } from "./briefing";
import { computeSnapshot } from "./snapshot";
import type { StoredMetric } from "./types";

const NOW = new Date("2026-07-15T12:00:00.000Z");

function row(
  metric: string,
  periodStart: string,
  value: number,
  dimension: Record<string, string> = {},
): StoredMetric {
  return {
    source_id: "s",
    metric,
    grain: "month",
    period_start: periodStart,
    period_end: periodStart,
    dimension,
    value,
  };
}

const PAYLOAD_ROWS: StoredMetric[] = [
  row("orders.revenue", "2026-07-01", 100000),
  row("orders.count", "2026-07-01", 250),
  row("orders.revenue", "2025-07-01", 80000),
  row("orders.count", "2025-07-01", 200),
  row("orders.revenue", "2026-06-01", 90000, { product: "Photos" }),
  row("orders.revenue", "2026-07-01", 40000, { company: "Acme Realty" }),
  row("orders.count", "2026-07-01", 60, { company: "Acme Realty" }),
];

test("buildBriefingInput is a pure fact sheet citing the real numbers", () => {
  const payload = computeSnapshot(PAYLOAD_ROWS, [], NOW, { goal: { revenue: 150000 } });
  const input = buildBriefingInput(payload);
  assert.match(input, /Revenue this month: \$100,000/);
  assert.match(input, /YoY \+25\.0%/);
  assert.match(input, /Pace to goal \(goal\)/);
  assert.match(input, /Largest customer .*Acme Realty/);
});

test("parseBriefing returns clean single-line prose unchanged", () => {
  assert.equal(
    parseBriefing("Revenue grew this month by ten percent."),
    "Revenue grew this month by ten percent.",
  );
});

test("parseBriefing strips code fences (with or without a language tag)", () => {
  assert.equal(parseBriefing("```\nRevenue grew.\n```"), "Revenue grew.");
  assert.equal(parseBriefing("```text\nRevenue grew.\n```"), "Revenue grew.");
});

test("parseBriefing strips a single wrapping pair of quotes", () => {
  assert.equal(parseBriefing('"Revenue grew this month."'), "Revenue grew this month.");
});

test("parseBriefing rejects JSON/array/markup garbage as empty string", () => {
  assert.equal(parseBriefing('{"title":"x"}'), "");
  assert.equal(parseBriefing("[1, 2, 3]"), "");
  assert.equal(parseBriefing("<p>hi</p>"), "");
});

test("parseBriefing treats empty/whitespace input as empty string", () => {
  assert.equal(parseBriefing(""), "");
  assert.equal(parseBriefing("   \n  "), "");
});

test("parseBriefing clamps to at most 6 sentences", () => {
  assert.equal(parseBriefing("A. B. C. D. E. F. G. H."), "A. B. C. D. E. F.");
});

test("parseBriefing clamps to at most 600 characters", () => {
  assert.equal(parseBriefing("x".repeat(700)).length, 600);
});
```

- [ ] Run it: `node --import tsx --test lib/analytics/briefing.test.ts` — expected FAIL: `Error: Cannot find module '…/lib/analytics/briefing'` because `briefing.ts` does not exist yet, so node:test fails to load the file.

- [ ] Implement the generator. Create `lib/analytics/briefing.ts`:
```ts
// lib/analytics/briefing.ts
//
// AI Executive Briefing: a compact, deterministic fact sheet from the snapshot
// (buildBriefingInput), rewritten by claude-sonnet-4-6 into a 4-6 sentence
// executive narrative citing the real numbers. parseBriefing strips fences /
// quotes, clamps length, and rejects non-prose garbage. Any failure degrades to
// "" — the card simply shows its empty state. The anthropic client is
// lazy-imported inside generateBriefing so the pure exports (buildBriefingInput,
// parseBriefing) are testable without ANTHROPIC_API_KEY. Mirrors insights.ts.

import type { SnapshotPayload } from "./snapshot";

export const BRIEFING_MODEL = "claude-sonnet-4-6";

const MAX_SENTENCES = 6;
const MAX_CHARS = 600;

function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtPct(r: number | null): string {
  if (r === null) return "n/a";
  return `${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}%`;
}

export function buildBriefingInput(payload: SnapshotPayload): string {
  const { kpis, yoy, paceToGoal, trend, productMix, topCompanies } = payload;
  const lines: string[] = [];
  lines.push(`As of: ${payload.generatedAt}`);
  lines.push(
    `Revenue this month: ${fmtMoney(kpis.revenueThisMonth)} (MoM ${fmtPct(kpis.revenueMoM)}, YoY ${fmtPct(yoy.revenueYoY)}).`,
  );
  lines.push(
    `Orders this month: ${kpis.ordersThisMonth} (MoM ${fmtPct(kpis.ordersMoM)}, YoY ${fmtPct(yoy.ordersYoY)}).`,
  );
  lines.push(`Average order value: ${fmtMoney(kpis.avgOrderValue)}.`);
  lines.push(`Active customers this month: ${kpis.activeCustomers}.`);
  if (paceToGoal.basis === "none" || paceToGoal.target === null) {
    lines.push("Pace to goal: no target available.");
  } else {
    lines.push(
      `Pace to goal (${paceToGoal.basis}): ${fmtMoney(paceToGoal.mtd)} month-to-date, projected ${fmtMoney(paceToGoal.projected)} against a target of ${fmtMoney(paceToGoal.target)} (${(paceToGoal.fraction * 100).toFixed(0)}% of target on current pace).`,
    );
  }
  const nonZero = trend.filter((t) => t.revenue > 0);
  if (nonZero.length >= 2) {
    const best = nonZero.reduce((a, b) => (b.revenue > a.revenue ? b : a));
    lines.push(`Best month in the trailing 13: ${best.month} at ${fmtMoney(best.revenue)}.`);
  }
  if (productMix.length > 0) {
    lines.push(
      `Top product by revenue (trailing 3 months): ${productMix[0].name} at ${fmtMoney(productMix[0].revenue)}.`,
    );
  }
  if (topCompanies.length > 0) {
    lines.push(
      `Largest customer (trailing 3 months): ${topCompanies[0].name} at ${fmtMoney(topCompanies[0].revenue)} across ${topCompanies[0].orders} orders.`,
    );
  }
  return lines.join("\n");
}

export function parseBriefing(raw: string): string {
  let text = (raw ?? "").trim();
  if (!text) return "";
  if (text.startsWith("```")) {
    text = text
      .replace(/^```(?:[a-z]*)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      text = text.slice(1, -1).trim();
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.startsWith("{") || text.startsWith("[") || text.startsWith("<")) return "";
  const parts = text.split(/(?<=[.!?])\s+/);
  if (parts.length > MAX_SENTENCES) {
    text = parts.slice(0, MAX_SENTENCES).join(" ").trim();
  }
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS).trim();
  return text;
}

const SYSTEM = `You are an executive analyst writing a short briefing for a business-analytics dashboard.

Rules:
- Use ONLY the facts provided. Never invent numbers, trends, or causes.
- Cite the actual numbers from the facts.
- Write a single paragraph of 4 to 6 plain sentences — an executive narrative of how the business is doing this month.
- Plain business language. No hype, no bullet points, no markdown, no headings, no lists, no advice beyond what the numbers show.

Return ONLY the paragraph text. No preamble, no quotes, no markdown fences.`;

export async function generateBriefing(payload: SnapshotPayload): Promise<string> {
  try {
    const { anthropic } = await import("@/lib/anthropic");
    const res = await anthropic.messages.create({
      model: BRIEFING_MODEL,
      max_tokens: 500,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Facts:\n${buildBriefingInput(payload)}\n\nWrite the executive briefing paragraph now.`,
        },
      ],
    });
    const rawText = res.content[0]?.type === "text" ? res.content[0].text : "";
    return parseBriefing(rawText);
  } catch {
    return "";
  }
}
```

- [ ] Run the test again: `node --import tsx --test lib/analytics/briefing.test.ts` — expected PASS: all input-builder and parser tests are green (`# fail 0`), with no `ANTHROPIC_API_KEY` needed (the anthropic client is never imported by the pure exports).

- [ ] Wire the briefing into the sync. In `lib/inngest/functions/analytics-sync.ts`, replace the entire snapshot step (currently lines 99–132: the `// One snapshot writer per client per run …` comment through the closing `});` of `await step.run(\`snapshot-${clientId}\`, …)`) with:
```ts
        // One snapshot writer per client per run — after all its source steps.
        await step.run(`snapshot-${clientId}`, async () => {
          const { listActiveSources, listMetricsForClient, readSnapshot, writeSnapshot, recordEvent } =
            await import("@/lib/analytics/store");
          const { computeSnapshot } = await import("@/lib/analytics/snapshot");
          const { generateInsights } = await import("@/lib/analytics/insights");
          const { generateBriefing } = await import("@/lib/analytics/briefing");
          const { logEvent } = await import("@/lib/logger");

          const now = new Date();
          const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1))
            .toISOString()
            .slice(0, 10);
          const [freshSources, metrics, existing] = await Promise.all([
            listActiveSources(clientId), // re-fetch: last_sync_at just changed
            listMetricsForClient(clientId, { grains: ["month"], from }),
            readSnapshot(clientId), // read the admin-set monthly goal
          ]);
          const payload = computeSnapshot(metrics, freshSources, now, { goal: existing?.goal ?? {} });
          const insights = await generateInsights(payload);
          const briefing = await generateBriefing(payload);
          // insights null = preserve existing cards (writeSnapshot contract).
          // briefing "" = generation skipped/failed → pass undefined so the last
          // good briefing is preserved rather than blanked.
          await writeSnapshot(
            clientId,
            payload,
            insights.length > 0 ? insights : null,
            briefing.length > 0 ? briefing : undefined,
          );
          await recordEvent(clientId, "sync.completed", "system", {
            sources: freshSources.length,
            metric_rows: metrics.length,
            insight_cards: insights.length,
            briefing: briefing.length > 0,
          });
          await logEvent({
            clientId,
            category: "analytics",
            message: `analytics sync completed — ${freshSources.length} source(s), ${metrics.length} month-grain rows`,
            metadata: { insight_cards: insights.length, briefing: briefing.length > 0 },
          });
          return { insights: insights.length, briefing: briefing.length > 0 };
        });
```

- [ ] Create the regenerate route `app/api/portal/analytics/briefing/regenerate/route.ts` (Next 16: `force-dynamic`; clientId derives from the session, never the body; never throws or leaks internals):
```ts
// app/api/portal/analytics/briefing/regenerate/route.ts
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getPortalClientId } from "@/lib/portal-auth";
import { readSnapshot, writeSnapshot, recordEvent } from "@/lib/analytics/store";
import { generateBriefing } from "@/lib/analytics/briefing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const { user } = await withAuth();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    // Tenant isolation: clientId derives from the session, NEVER the request.
    const clientId = await getPortalClientId(user.id);
    if (!clientId) return Response.json({ error: "No client" }, { status: 403 });

    const snapshot = await readSnapshot(clientId);
    if (!snapshot) return Response.json({ error: "No snapshot yet" }, { status: 404 });

    const briefing = await generateBriefing(snapshot.payload);
    // Preserve insights (null); persist the freshly generated briefing (even "").
    await writeSnapshot(clientId, snapshot.payload, null, briefing);
    await recordEvent(clientId, "briefing.regenerated", user.id, { ok: briefing.length > 0 });
    return Response.json({ briefing });
  } catch {
    return Response.json({ error: "Could not regenerate briefing" }, { status: 500 });
  }
}
```

- [ ] Verify: `npm run typecheck` — expected pass (the modified sync step and the new route resolve `generateBriefing`, the widened `writeSnapshot` signature, and `readSnapshot().goal`), then build the route: `npm run build` — expected to compile `app/api/portal/analytics/briefing/regenerate/route.ts` as a dynamic Route Handler with no errors. Manual check: `POST /api/portal/analytics/briefing/regenerate` with no session returns HTTP 401; with a portal session returns `{ "briefing": "…" }` (or `{ "briefing": "" }` when the model/key is unavailable — never a 500 stack).

- [ ] Commit: `git add lib/analytics/briefing.ts lib/analytics/briefing.test.ts lib/inngest/functions/analytics-sync.ts app/api/portal/analytics/briefing/regenerate/route.ts` then `git commit -m "feat(analytics): AI executive briefing generator + sync wiring + regenerate route"`.

---

## Phase 2 — Dark theme + chart components

### Task 5: `public/analytics/command-center.css` — dark executive theme

**Files:**
- Create: `public/analytics/command-center.css`
- Test: none (CSS only) — verified by `npm run typecheck` (unaffected) plus an inline `node -e` regex-check script (shown below)

**Interfaces:**
- Consumes: the semantic token names defined in `public/tokens.css` (`--color-bg`, `--color-bg-raised`, `--color-bg-sunken`, `--color-border`, `--color-text`, `--color-text-soft`, `--color-text-mute`, `--color-gold`, `--color-gold-dim`, `--color-sage`, `--color-sage-dim`, `--color-red`, `--color-red-dim`, `--color-blue`, `--color-blue-dim`, `--color-on-gold`, `--color-gold-text`, `--color-red-text`, `--focus-ring-color`) plus the universal scale tokens (`--sp-*`, `--r-*`, `--ease`, `--ease-out`, `--dur-fast`, `--dur`, `--dur-slow`); the dark-palette remap pattern demonstrated by `public/admin/admin.css`'s `[data-theme="dark"]` block.
- Produces: selector `.cc-root` (token remap + near-black background); layout classes `.cc-hero`, `.cc-grid`, `.cc-tile`, `.cc-briefing`, `.cc-ranked` / `.cc-ranked-row`, `.cc-deepdive`, `.cc-present` / `.cc-present-slide`, `.cc-live-dot`; motion utility `.cc-draw`; `@keyframes cc-draw`, `@keyframes cc-pulse`. Consumed by the analytics page + admin mirror + present page via `<link rel="stylesheet" href="/analytics/command-center.css">` — that wiring is **Task 11**, out of scope here; this task only creates the CSS.

**Steps:**

- [ ] Run the verification script first to confirm it starts red (file does not exist yet). Command:

```bash
node -e '
const fs = require("fs");
const css = fs.readFileSync("public/analytics/command-center.css", "utf8");
const rootMatch = css.match(/\.cc-root\s*\{([\s\S]*?)\n\}/);
const rootBlock = rootMatch ? rootMatch[1] : "";
const checks = [
  ["file readable", true],
  ["has @media (prefers-reduced-motion: reduce) block", /@media \(prefers-reduced-motion:\s*reduce\)\s*\{/.test(css)],
  [".cc-root block found", !!rootMatch],
  ["--color-bg defined inside .cc-root", /--color-bg:\s*#/.test(rootBlock)],
  ["--color-gold defined inside .cc-root", /--color-gold:\s*#/.test(rootBlock)],
  ["has .cc-hero class", /\.cc-hero\b/.test(css)],
  ["has .cc-tile class", /\.cc-tile\b/.test(css)],
  ["has .cc-grid class", /\.cc-grid\b/.test(css)],
];
let failed = false;
for (const [name, ok] of checks) {
  console.log((ok ? "PASS" : "FAIL") + " - " + name);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
'
```

  Expected failure: `Error: ENOENT: no such file or directory, open 'public/analytics/command-center.css'` (non-zero exit; the `readFileSync` throws before any check runs).

- [ ] Write `public/analytics/command-center.css`:

```css
/* ============================================================
   GB2G ANALYTICS — command-center.css
   Dark "executive command center" theme, scoped to `.cc-root`.
   Loaded AFTER tokens.css (+ portal.css/admin.css) on the analytics
   dashboard, its admin mirror, and the presentation route. Purely
   additive: remaps the semantic --color-* tokens inside `.cc-root`
   so every existing ds-chart-*/ds-*/stat-* component re-themes dark
   without any component code changes, then layers command-center-only
   layout classes + motion on top.

   This is the ONLY file allowed to contain literal dark hex values,
   and ONLY inside the `.cc-root { ... }` token-remap block below —
   everything else in this file (and every component) consumes those
   remapped var(--color-*) tokens.
   ============================================================ */

.cc-root {
  color-scheme: dark;

  /* Backgrounds — near-black base, lighter elevated surfaces */
  --color-bg: #06080a;
  --color-bg-raised: #12151b;
  --color-bg-sunken: #1a1e25;

  /* Borders */
  --color-border: #232a33;

  /* Text */
  --color-text: #f2ede0;
  --color-text-soft: #b7bcb0;
  --color-text-mute: #82898f;

  /* Accent — Gold (brightened for AA on near-black) */
  --color-gold: #e8c877;
  --color-gold-dim: rgba(232, 200, 119, 0.16);

  /* Accent — Sage */
  --color-sage: #b9d2ab;
  --color-sage-dim: rgba(185, 210, 171, 0.14);

  /* Accent — Red */
  --color-red: #ef9273;
  --color-red-dim: rgba(239, 146, 115, 0.14);

  /* Accent — Blue */
  --color-blue: #93c1e8;
  --color-blue-dim: rgba(147, 193, 232, 0.14);

  --color-on-gold: #14110a;
  --color-gold-text: var(--color-gold);
  --color-red-text: var(--color-red);
  --focus-ring-color: var(--color-gold);

  /* Base surface: near-black + faint grid + a top gold vignette */
  position: relative;
  background-color: var(--color-bg);
  background-image:
    radial-gradient(ellipse 900px 480px at 50% -12%, color-mix(in oklch, var(--color-gold) 12%, transparent), transparent 65%),
    repeating-linear-gradient(0deg, color-mix(in oklch, var(--color-text) 3%, transparent) 0 1px, transparent 1px 64px),
    repeating-linear-gradient(90deg, color-mix(in oklch, var(--color-text) 3%, transparent) 0 1px, transparent 1px 64px);
  color: var(--color-text);
}

/* ============================================================
   LAYOUT — hero / KPI grid / briefing / ranked lists / deep-dive / present
   ============================================================ */

.cc-hero {
  position: relative;
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: var(--sp-6);
  padding: var(--sp-8) var(--sp-6);
  border-radius: var(--r-lg);
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border);
  box-shadow:
    0 0 0 1px color-mix(in oklch, var(--color-gold) 10%, transparent) inset,
    0 24px 60px -32px color-mix(in oklch, var(--color-gold) 35%, transparent);
  overflow: hidden;
}
.cc-hero::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 600px 300px at 15% 0%, color-mix(in oklch, var(--color-gold) 16%, transparent), transparent 70%);
  pointer-events: none;
}

.cc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--sp-4);
}

.cc-tile {
  position: relative;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--r-md);
  padding: var(--sp-5);
  transition:
    transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.cc-tile:hover,
.cc-tile:focus-within {
  transform: translateY(-3px);
  border-color: color-mix(in oklch, var(--color-gold) 45%, var(--color-border));
  box-shadow: 0 16px 32px -20px color-mix(in oklch, var(--color-gold) 45%, transparent);
}

.cc-briefing {
  position: relative;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border);
  border-left: 2px solid var(--color-gold);
  border-radius: var(--r-lg);
  padding: var(--sp-6);
  box-shadow: 0 0 24px -12px color-mix(in oklch, var(--color-gold) 30%, transparent);
}

.cc-ranked {
  display: flex;
  flex-direction: column;
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--r-md);
  overflow: hidden;
}
.cc-ranked-row {
  display: grid;
  grid-template-columns: 28px 1.6fr 1fr 80px;
  gap: var(--sp-3);
  align-items: center;
  padding: var(--sp-3) var(--sp-4);
  border-top: 1px solid var(--color-border);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.cc-ranked-row:first-child { border-top: none; }
.cc-ranked-row:hover,
.cc-ranked-row:focus-visible {
  background: color-mix(in oklch, var(--color-gold) 8%, transparent);
}

.cc-deepdive {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}

.cc-present {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-8);
  padding: var(--sp-12);
  text-align: center;
}
.cc-present-slide {
  transition: opacity var(--dur-slow) var(--ease);
}

/* Small "· live" pulse dot next to "Data as of <sync>" */
.cc-live-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-sage);
  animation: cc-pulse 2.2s ease-in-out infinite;
}

/* ============================================================
   MOTION
   ============================================================ */

/* Chart draw-in: paths render with pathLength={1} so a normalized
   0..1 dasharray/dashoffset animates the stroke regardless of the
   path's real geometric length. */
.cc-draw {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: cc-draw 1.1s var(--ease-out) forwards;
}

@keyframes cc-draw {
  to { stroke-dashoffset: 0; }
}

@keyframes cc-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--color-sage) 55%, transparent); }
  50% { box-shadow: 0 0 0 6px color-mix(in oklch, var(--color-sage) 0%, transparent); }
}

@media (prefers-reduced-motion: reduce) {
  .cc-tile { transition: none; }
  .cc-tile:hover,
  .cc-tile:focus-within { transform: none; }
  .cc-ranked-row { transition: none; }
  .cc-present-slide { transition: none; }
  .cc-draw { animation: none; transition: none; stroke-dashoffset: 0; }
  .cc-live-dot { animation: none; box-shadow: none; }
}

@media (max-width: 700px) {
  .cc-hero { grid-template-columns: 1fr; }
}
```

- [ ] Run the verification script again (same `node -e` script). Expected output (exit 0):

```
PASS - file readable
PASS - has @media (prefers-reduced-motion: reduce) block
PASS - .cc-root block found
PASS - --color-bg defined inside .cc-root
PASS - --color-gold defined inside .cc-root
PASS - has .cc-hero class
PASS - has .cc-tile class
PASS - has .cc-grid class
```

- [ ] Confirm nothing typechecked was touched. Command: `npm run typecheck`. Expected: exit 0.

- [ ] Confirm zero hex outside the `.cc-root` block (the only place literal hex is allowed). Command:

```bash
awk '/^\.cc-root \{/{p=1; print; next} p && /^\}/{p=0; next} !p{print}' public/analytics/command-center.css | grep -nE '#[0-9a-fA-F]{3,6}'
```

  Expected: no output, exit code 1.

- [ ] Commit. `git add public/analytics/command-center.css` then `git commit -m "feat(analytics): dark command-center theme — .cc-root token remap + layout classes"` (end the message with the Co-Authored-By trailer).

---

### Task 6: Enhanced Sparkline + Ring + CcTrend chart components

**Files:**
- Modify: `components/charts/Sparkline.tsx`
- Create: `components/charts/Ring.tsx`
- Create: `components/analytics/command-center/CcTrend.tsx`
- Test: none new — no pure helper is introduced (see the explicit note below); `lib/analytics/charts.ts` / `charts.test.ts` are untouched. Sparkline/Ring/CcTrend are UI, verified via `npm run typecheck` + a hex-literal grep.

**Interfaces:**
- Consumes from `lib/analytics/charts.ts`: existing `linePath(points: Array<{x:number;y:number}>): string`, `scaleLinear(domainMax: number, rangePx: number): (v: number) => number`, `niceTicks(max: number, count: number): number[]`, `CHART_COLORS: string[]`; Task 2's `ringArc(fraction: number, radius: number, thickness: number): string`, `areaPath(points: Array<{x:number;y:number}>, baselineY: number): string`, `brushWindow(totalCount: number, fromFrac: number, toFrac: number): { startIndex: number; endIndex: number }`.
- Produces:
  - `export type SparklineProps = { points: number[]; ariaLabel: string; width?: number; height?: number; fill?: boolean; dot?: boolean }`, `Sparkline(props: SparklineProps)`
  - `export type RingProps = { fraction: number; label: string; value: string; ariaLabel: string }`, `Ring(props: RingProps)`
  - `export type CcTrendProps = { trend: Array<{ month: string; revenue: number; orders: number }>; ariaLabel: string }`, `CcTrend(props: CcTrendProps)`

**Steps:**

- [ ] Modify `components/charts/Sparkline.tsx` to add optional `fill`/`dot`, keeping the default-args render byte-identical to the current file (when both are omitted the only rendered element remains the single `<path className="ds-chart-line">`):

```tsx
// components/charts/Sparkline.tsx
import { linePath, areaPath, scaleLinear, CHART_COLORS } from "@/lib/analytics/charts";

export type SparklineProps = {
  points: number[];
  ariaLabel: string;
  width?: number;
  height?: number;
  fill?: boolean;
  dot?: boolean;
};

export function Sparkline({ points, ariaLabel, width = 120, height = 32, fill = false, dot = false }: SparklineProps) {
  const scale = scaleLinear(Math.max(1, ...points), height - 4);
  const n = points.length;
  const pix = points.map((v, i) => ({
    x: n <= 1 ? 1 : (i / (n - 1)) * (width - 2) + 1,
    y: height - 2 - scale(v),
  }));
  const last = pix[pix.length - 1];
  return (
    <svg className="ds-chart ds-chart--spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
      {fill && pix.length > 0 && <path className="ds-chart-area" d={areaPath(pix, height - 2)} fill="var(--color-gold-dim)" />}
      <path className="ds-chart-line" d={linePath(pix)} stroke={CHART_COLORS[0]} />
      {dot && last && <circle cx={last.x} cy={last.y} r={2.5} fill={CHART_COLORS[0]} stroke="var(--color-bg-raised)" strokeWidth={1} />}
    </svg>
  );
}
```

- [ ] Create `components/charts/Ring.tsx` (server; radial pace-to-goal gauge — `ringArc(1, …)` draws the faint full-ring track, `ringArc(clamped, …)` draws the gold progress arc round-capped):

```tsx
// components/charts/Ring.tsx
import { ringArc } from "@/lib/analytics/charts";

export type RingProps = { fraction: number; label: string; value: string; ariaLabel: string };

const RADIUS = 64;
const THICKNESS = 12;
const SIZE = (RADIUS + THICKNESS) * 2;
const CENTER = SIZE / 2;

export function Ring({ fraction, label, value, ariaLabel }: RingProps) {
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const track = ringArc(1, RADIUS, THICKNESS);
  const arc = ringArc(clamped, RADIUS, THICKNESS);
  return (
    <figure className="ds-chart-fig cc-ring">
      <svg className="ds-chart cc-ring-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMidYMid meet">
        <g transform={`translate(${CENTER} ${CENTER})`}>
          {track && <path d={track} fill="none" stroke="var(--color-border)" strokeWidth={THICKNESS} />}
          {arc && <path d={arc} fill="none" stroke="var(--color-gold)" strokeWidth={THICKNESS} strokeLinecap="round" />}
        </g>
      </svg>
      <figcaption className="cc-ring-caption">
        <span className="cc-ring-value">{value}</span>
        <span className="cc-ring-label">{label}</span>
      </figcaption>
    </figure>
  );
}
```

  Note: `.cc-ring*` are styling hooks only; their CSS is added by the hero-integration task (Task 7/10 area). This task is typecheck + hex-grep verified, not visually verified.

- [ ] Create `components/analytics/command-center/CcTrend.tsx` (`"use client"` — the brush is interactive local state, no refetch):

```tsx
"use client";
// components/analytics/command-center/CcTrend.tsx
import { useId, useState } from "react";
import { areaPath, linePath, scaleLinear, niceTicks, brushWindow, CHART_COLORS } from "@/lib/analytics/charts";

export type CcTrendProps = {
  trend: Array<{ month: string; revenue: number; orders: number }>;
  ariaLabel: string;
};

const W = 640, H = 260, L = 56, R = 56, T = 16, B = 30;
const PW = W - L - R;
const PH = H - T - B;

function xAt(i: number, n: number): number {
  if (n <= 1) return L;
  return L + (i / (n - 1)) * PW;
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

export function CcTrend({ trend, ariaLabel }: CcTrendProps) {
  const uid = useId();
  const [fromFrac, setFromFrac] = useState(0);
  const [toFrac, setToFrac] = useState(1);

  if (trend.length === 0) {
    return <p className="cc-trend-empty">No trend data yet.</p>;
  }

  const win = brushWindow(trend.length, fromFrac, toFrac);
  const visible = trend.slice(win.startIndex, win.endIndex + 1);
  const n = visible.length;

  const revenuePoints = visible.map((t) => t.revenue);
  const ordersPoints = visible.map((t) => t.orders);

  const revenueTicks = niceTicks(Math.max(1, ...revenuePoints), 4);
  const revenueTop = revenueTicks[revenueTicks.length - 1] || 1;
  const revenueScale = scaleLinear(revenueTop, PH);
  const revenuePix = visible.map((t, i) => ({ x: xAt(i, n), y: T + PH - revenueScale(t.revenue) }));
  const revenueLine = linePath(revenuePix);
  const revenueArea = areaPath(revenuePix, T + PH);

  const ordersTicks = niceTicks(Math.max(1, ...ordersPoints), 4);
  const ordersTop = ordersTicks[ordersTicks.length - 1] || 1;
  const ordersScale = scaleLinear(ordersTop, PH);
  const ordersPix = visible.map((t, i) => ({ x: xAt(i, n), y: T + PH - ordersScale(t.orders) }));
  const ordersLine = linePath(ordersPix);

  const gradientId = `${uid}-revenue-fill`;
  const fromId = `${uid}-from`;
  const toId = `${uid}-to`;

  return (
    <figure className="ds-chart-fig cc-trend">
      <svg className="ds-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-gold)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-gold)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {revenueTicks.map((t, i) => {
          const y = T + PH - revenueScale(t);
          return (
            <g key={`rg${i}`}>
              <line className="ds-chart-grid" x1={L} y1={y} x2={L + PW} y2={y} />
              <text className="ds-chart-label" x={L - 6} y={y + 3} textAnchor="end">{formatCompact(t)}</text>
            </g>
          );
        })}
        {ordersTicks.map((t, i) => {
          const y = T + PH - (t / ordersTop) * PH;
          return <text key={`og${i}`} className="ds-chart-label" x={L + PW + 6} y={y + 3} textAnchor="start">{formatCompact(t)}</text>;
        })}
        {revenueArea && <path d={revenueArea} fill={`url(#${gradientId})`} stroke="none" />}
        {revenueLine && <path className="ds-chart-line cc-draw" d={revenueLine} stroke={CHART_COLORS[0]} pathLength={1} />}
        {ordersLine && <path className="ds-chart-line cc-draw" d={ordersLine} stroke={CHART_COLORS[2]} strokeDasharray="4 3" pathLength={1} />}
        {visible.map((t, i) => (
          <text key={`x${i}`} className="ds-chart-label" x={xAt(i, n)} y={H - 8} textAnchor="middle">{t.month}</text>
        ))}
      </svg>
      <figcaption className="ds-chart-legend">
        <span className="ds-chart-legend-item"><span className="ds-chart-swatch" style={{ background: CHART_COLORS[0] }} />Revenue</span>
        <span className="ds-chart-legend-item"><span className="ds-chart-swatch" style={{ background: CHART_COLORS[2] }} />Orders</span>
      </figcaption>
      <div className="cc-trend-brush">
        <label className="cc-trend-brush-label" htmlFor={fromId}>
          Window start
          <input id={fromId} type="range" min={0} max={100} step={1} value={Math.round(fromFrac * 100)}
            onChange={(e) => { const v = Number(e.target.value) / 100; setFromFrac(Math.min(v, toFrac)); }}
            aria-label="Trend window start" />
        </label>
        <label className="cc-trend-brush-label" htmlFor={toId}>
          Window end
          <input id={toId} type="range" min={0} max={100} step={1} value={Math.round(toFrac * 100)}
            onChange={(e) => { const v = Number(e.target.value) / 100; setToFrac(Math.max(v, fromFrac)); }}
            aria-label="Trend window end" />
        </label>
        <span className="cc-trend-brush-range">{visible[0]?.month ?? ""} – {visible[n - 1]?.month ?? ""}</span>
      </div>
    </figure>
  );
}
```

- [ ] Explicit helper decision: NO new pure helper is factored into `lib/analytics/charts.ts`. `xAt(i,n)` and `formatCompact(n)` stay local to `CcTrend.tsx` (mirroring the existing local, non-exported `xAt` in `components/charts/LineChart.tsx`) — component-specific pixel/format glue, not reusable geometry. `charts.ts` / `charts.test.ts` untouched.

- [ ] Typecheck all three files (the real correctness gate — `Ring`/`CcTrend` call Task 2's `ringArc`/`areaPath`/`brushWindow`, so signature mismatches fail here). Command: `npm run typecheck`. Expected: exit 0.

- [ ] Grep for hex literals across the three files. Command:

```bash
grep -nE '#[0-9a-fA-F]{3,6}' components/charts/Sparkline.tsx components/charts/Ring.tsx components/analytics/command-center/CcTrend.tsx
```

  Expected: no output, exit code 1.

- [ ] Commit. `git add components/charts/Sparkline.tsx components/charts/Ring.tsx components/analytics/command-center/CcTrend.tsx` then `git commit -m "feat(analytics): sparkline fill/dot, radial pace-to-goal gauge, area+brush trend"` (with the Co-Authored-By trailer).


---

## Phase 3 — Command-center UI composition

### Task 7: `cc-format` pure helpers + `CcHero` (server hero band)

**Files:**
- Create `lib/analytics/cc-format.ts` (pure presentation helpers for the command-center)
- Create `lib/analytics/cc-format.test.ts` (node:test coverage for those helpers)
- Create `components/analytics/command-center/CcHero.tsx` (server component)

**Interfaces:**
- Consumes: `SnapshotPayload` (with additive `yoy`/`paceToGoal`/`tileSparks` from the snapshot slice) from `@/lib/analytics/snapshot`; `fmtCurrency`, `fmtDelta` from `@/lib/analytics/format`; `Ring` (props `{ fraction: number; label: string; value: string; ariaLabel: string }`) from `@/components/charts/Ring` (charts slice); enhanced `Sparkline` (props `{ points: number[]; ariaLabel: string; width?: number; height?: number; fill?: boolean; dot?: boolean }`) from `@/components/charts/Sparkline` (charts slice).
- Produces: `pacePercent(fraction: number): string`; `paceBasisLabel(basis: SnapshotPayload["paceToGoal"]["basis"]): string`; `barFraction(value: number, top: number): number`; `splitFormatted(format: (n: number) => string, value: number): { prefix: string; core: string }`; `CcHero({ payload }: { payload: SnapshotPayload }): JSX.Element`.

- [ ] Write the failing test file `lib/analytics/cc-format.test.ts`:

```ts
// lib/analytics/cc-format.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pacePercent, paceBasisLabel, barFraction, splitFormatted } from "./cc-format";
import { fmtCurrency, fmtInt } from "./format";

test("pacePercent: rounds a 0..1 fraction to whole percent", () => {
  assert.equal(pacePercent(0.833), "83%");
  assert.equal(pacePercent(0), "0%");
  assert.equal(pacePercent(1), "100%");
});

test("pacePercent: clamps out-of-range and non-finite to 0..100%", () => {
  assert.equal(pacePercent(1.4), "100%");
  assert.equal(pacePercent(-0.5), "0%");
  assert.equal(pacePercent(NaN), "0%");
});

test("paceBasisLabel: maps each basis to its caption", () => {
  assert.equal(paceBasisLabel("goal"), "of monthly goal");
  assert.equal(paceBasisLabel("yoy"), "vs. same month last year");
  assert.equal(paceBasisLabel("trailing"), "vs. trailing 3-mo avg");
  assert.equal(paceBasisLabel("none"), "no goal set");
});

test("barFraction: value as clamped share of the top value", () => {
  assert.equal(barFraction(50, 100), 0.5);
  assert.equal(barFraction(100, 100), 1);
  assert.equal(barFraction(0, 100), 0);
});

test("barFraction: guards zero/negative/non-finite inputs and over-100%", () => {
  assert.equal(barFraction(10, 0), 0);
  assert.equal(barFraction(10, -5), 0);
  assert.equal(barFraction(NaN, 100), 0);
  assert.equal(barFraction(200, 100), 1);
});

test("splitFormatted: currency splits into $ prefix + toLocaleString core", () => {
  assert.deepEqual(splitFormatted(fmtCurrency, 100054.3), { prefix: "$", core: "100,054" });
});

test("splitFormatted: integer format has no prefix", () => {
  assert.deepEqual(splitFormatted(fmtInt, 286), { prefix: "", core: "286" });
});

test("splitFormatted: core matches the count-up landing value (Math.round + grouping)", () => {
  const { core } = splitFormatted(fmtCurrency, 349.83);
  assert.equal(core, Math.round(349.83).toLocaleString("en-US"));
});
```

- [ ] Run it and watch it fail: `node --import tsx --test lib/analytics/cc-format.test.ts`
  Expected failure: the run aborts loading the suite with `Cannot find module '.../lib/analytics/cc-format'` (ERR_MODULE_NOT_FOUND) — the impl file does not exist yet.

- [ ] Write the minimal implementation `lib/analytics/cc-format.ts`:

```ts
// lib/analytics/cc-format.ts
// Pure presentation helpers for the command-center UI (no React, no DOM).
// Tested in cc-format.test.ts. Colors/markup live in the components; this file
// is math + string shaping only.

import type { SnapshotPayload } from "./snapshot";

/** Ring/label percent from a 0..1 fraction; clamps and rounds to a whole %. */
export function pacePercent(fraction: number): string {
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  return `${Math.round(f * 100)}%`;
}

/** Caption describing what the pace-to-goal ring is measured against. */
export function paceBasisLabel(basis: SnapshotPayload["paceToGoal"]["basis"]): string {
  switch (basis) {
    case "goal":
      return "of monthly goal";
    case "yoy":
      return "vs. same month last year";
    case "trailing":
      return "vs. trailing 3-mo avg";
    default:
      return "no goal set";
  }
}

/** Inline-bar width fraction 0..1 for a ranked row: value as share of the top value. */
export function barFraction(value: number, top: number): number {
  if (!(top > 0) || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value / top));
}

/**
 * Split a formatter's output into a leading non-digit prefix (e.g. "$") and the
 * numeric core, so an integer count-up (CounterAnimation writes
 * `Math.round(target).toLocaleString()`) can restore the exact static display
 * without clobbering the currency symbol. Rounds first so the core matches the
 * animation's landing value.
 */
export function splitFormatted(
  format: (n: number) => string,
  value: number,
): { prefix: string; core: string } {
  const full = format(Math.round(value));
  const i = full.search(/[0-9]/);
  if (i < 0) return { prefix: "", core: full };
  return { prefix: full.slice(0, i), core: full.slice(i) };
}
```

- [ ] Run again and watch it pass: `node --import tsx --test lib/analytics/cc-format.test.ts`
  Expected: all 8 tests pass (`# pass 8`, `# fail 0`).

- [ ] Write the server component `components/analytics/command-center/CcHero.tsx`:

```tsx
// components/analytics/command-center/CcHero.tsx
import type { SnapshotPayload } from "@/lib/analytics/snapshot";
import { Sparkline } from "@/components/charts/Sparkline";
import { Ring } from "@/components/charts/Ring";
import { fmtCurrency, fmtDelta } from "@/lib/analytics/format";
import { splitFormatted, pacePercent, paceBasisLabel } from "@/lib/analytics/cc-format";

function Chip({ ratio, label }: { ratio: number | null; label: string }) {
  const d = fmtDelta(ratio);
  return (
    <span className={`ds-kpi-delta ds-kpi-delta--${d.tone} cc-chip`}>
      <span aria-hidden>{d.arrow}</span> {d.text} <span className="cc-chip-lbl">{label}</span>
    </span>
  );
}

export function CcHero({ payload }: { payload: SnapshotPayload }) {
  const { kpis, yoy, paceToGoal, tileSparks } = payload;
  const { prefix, core } = splitFormatted(fmtCurrency, kpis.revenueThisMonth);
  const pct = pacePercent(paceToGoal.fraction);
  const basisLabel = paceBasisLabel(paceToGoal.basis);
  return (
    <section
      className="cc-hero"
      aria-label={`Revenue this month ${fmtCurrency(kpis.revenueThisMonth)}`}
    >
      <div className="cc-hero-main">
        <div className="cc-hero-label">revenue · this month</div>
        <div className="cc-hero-value">
          {prefix ? <span className="cc-hero-affix" aria-hidden>{prefix}</span> : null}
          <span className="stat-num cc-hero-num" data-count={String(Math.round(kpis.revenueThisMonth))}>
            {core}
          </span>
        </div>
        <div className="cc-hero-chips">
          <Chip ratio={kpis.revenueMoM} label="MoM" />
          <Chip ratio={yoy.revenueYoY} label="YoY" />
        </div>
        <div className="cc-hero-spark">
          <Sparkline
            points={tileSparks.revenue}
            ariaLabel="Revenue over the trailing 13 months"
            width={420}
            height={64}
            fill
            dot
          />
        </div>
      </div>
      <div className="cc-hero-ring">
        <Ring
          fraction={paceToGoal.fraction}
          value={pct}
          label={basisLabel}
          ariaLabel={`Pace to goal: ${pct} ${basisLabel}`}
        />
      </div>
    </section>
  );
}
```

- [ ] Verify types compile: `npm run typecheck`
  Expected: exits 0 (no errors). Confirms `CcHero` consumes `SnapshotPayload.{yoy,paceToGoal,tileSparks}`, `Ring`, and the enhanced `Sparkline` with matching prop shapes.

- [ ] Verify no literal hex leaked into the component (colors must be semantic tokens only): `grep -nE '#[0-9a-fA-F]{3,8}' components/analytics/command-center/CcHero.tsx`
  Expected: no matches (empty output). Manual render check: `CcHero` renders one `<section class="cc-hero">` with a giant north-star revenue (`$` in a separate `cc-hero-affix` span so the `.stat-num[data-count]` count-up restores `$100,054` exactly), a MoM + YoY chip pair, an underlaid filled 13-month sparkline, and a pace-to-goal `Ring` on the right.

- [ ] Commit: `git add lib/analytics/cc-format.ts lib/analytics/cc-format.test.ts components/analytics/command-center/CcHero.tsx && git commit -m "feat(analytics): cc-format pure helpers + CcHero north-star band"`

---

### Task 8: `CcKpiTile` (server) + `CcBriefing` (client)

**Files:**
- Create `components/analytics/command-center/CcKpiTile.tsx` (server component)
- Create `components/analytics/command-center/CcBriefing.tsx` (`"use client"`)

**Interfaces:**
- Consumes: `splitFormatted` from `@/lib/analytics/cc-format` (Task 7); `fmtDelta` from `@/lib/analytics/format`; enhanced `Sparkline` from `@/components/charts/Sparkline`; `useToast` from `@/components/ui` (returns `{ toast, success, error, info, undo, dismiss }`); `POST /api/portal/analytics/briefing/regenerate` returning `{ briefing: string }` (routes slice).
- Produces: `CcKpiTile({ label, value, delta, deltaLabel, spark, format }: { label: string; value: number; delta: number | null; deltaLabel: string; spark: number[]; format: (n: number) => string }): JSX.Element`; `CcBriefing({ briefing, clientId, onFollowUp }: { briefing: string; clientId?: string; onFollowUp?: (text: string) => void }): JSX.Element`.

- [ ] Write the server component `components/analytics/command-center/CcKpiTile.tsx`:

```tsx
// components/analytics/command-center/CcKpiTile.tsx
import { Sparkline } from "@/components/charts/Sparkline";
import { fmtDelta } from "@/lib/analytics/format";
import { splitFormatted } from "@/lib/analytics/cc-format";

export function CcKpiTile({
  label,
  value,
  delta,
  deltaLabel,
  spark,
  format,
}: {
  label: string;
  value: number;
  delta: number | null;
  deltaLabel: string;
  spark: number[];
  format: (n: number) => string;
}) {
  const { prefix, core } = splitFormatted(format, value);
  const d = fmtDelta(delta);
  return (
    <div className="cc-tile">
      <div className="cc-tile-top">
        <span className="cc-tile-label">{label}</span>
        <span className={`ds-kpi-delta ds-kpi-delta--${d.tone}`}>
          <span aria-hidden>{d.arrow}</span> {d.text}
        </span>
      </div>
      <div className="cc-tile-value">
        {prefix ? <span className="cc-tile-affix" aria-hidden>{prefix}</span> : null}
        <span className="stat-num cc-tile-num" data-count={String(Math.round(value))}>
          {core}
        </span>
      </div>
      <div className="cc-tile-foot">
        <Sparkline points={spark} ariaLabel={`${label} trend`} width={140} height={34} fill dot />
        <span className="cc-tile-delta-label">{deltaLabel}</span>
      </div>
    </div>
  );
}
```

- [ ] Write the client component `components/analytics/command-center/CcBriefing.tsx`:

```tsx
// components/analytics/command-center/CcBriefing.tsx
"use client";
import { useState } from "react";
import { useToast } from "@/components/ui";

export function CcBriefing({
  briefing,
  clientId,
  onFollowUp,
}: {
  briefing: string;
  clientId?: string;
  onFollowUp?: (text: string) => void;
}) {
  const [text, setText] = useState(briefing);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function regenerate() {
    setBusy(true);
    try {
      const res = await fetch("/api/portal/analytics/briefing/regenerate", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { briefing?: string };
      if (data.briefing && data.briefing.length > 0) {
        setText(data.briefing);
        toast.success("Briefing updated.");
      } else {
        toast.info("Briefing will appear after your next sync.");
      }
    } catch {
      toast.error("Could not regenerate the briefing right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cc-briefing" aria-label="AI executive briefing">
      <div className="cc-briefing-head">
        <h2 className="cc-briefing-title">AI Briefing</h2>
        <span className="cc-live-dot" aria-hidden />
      </div>
      {text ? (
        <p className="cc-briefing-body">{text}</p>
      ) : (
        <p className="cc-briefing-empty">Briefing will appear after your next sync.</p>
      )}
      <div className="cc-briefing-actions">
        {clientId ? (
          <button type="button" className="cc-btn" onClick={regenerate} disabled={busy}>
            {busy ? "Regenerating…" : "Regenerate"}
          </button>
        ) : null}
        {onFollowUp && text ? (
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => onFollowUp(text)}
          >
            Ask a follow-up →
          </button>
        ) : null}
      </div>
    </section>
  );
}
```

- [ ] Verify types compile: `npm run typecheck`
  Expected: exits 0. Confirms `CcKpiTile`'s `format` prop threads through `splitFormatted`, and `CcBriefing` uses the `useToast` API (`toast.success/info/error`) correctly. Note: the briefing text is rendered as a plain React child (`{text}`) — auto-escaped, no `dangerouslySetInnerHTML`.

- [ ] Verify no literal hex in either file: `grep -nE '#[0-9a-fA-F]{3,8}' components/analytics/command-center/CcKpiTile.tsx components/analytics/command-center/CcBriefing.tsx`
  Expected: no matches. Manual render check: `CcKpiTile` shows label + delta chip, a count-up value (currency prefix preserved via `cc-tile-affix`), and an inline filled sparkline. `CcBriefing` shows the narrative paragraph with a live-dot header; the Regenerate button appears only when `clientId` is passed (portal surface), and posts to the regenerate route with no body (route derives the client from the session — never the body). The follow-up button appears only when an `onFollowUp` handler and text both exist.

- [ ] Commit: `git add components/analytics/command-center/CcKpiTile.tsx components/analytics/command-center/CcBriefing.tsx && git commit -m "feat(analytics): CcKpiTile sparkline tile + CcBriefing regenerate card"`

---

### Task 9: `CcRankedList` (client) + `CcDeepDive` (client drawer)

**Files:**
- Create `components/analytics/command-center/CcRankedList.tsx` (`"use client"`)
- Create `components/analytics/command-center/CcDeepDive.tsx` (`"use client"`)

**Interfaces:**
- Consumes: `barFraction` from `@/lib/analytics/cc-format` (Task 7, already node:tested); `fmtCurrency`, `fmtInt` from `@/lib/analytics/format`; enhanced `Sparkline` from `@/components/charts/Sparkline`; `Drawer` from `@/components/ui`; `GET /api/portal/analytics/entity?dim=&name=` returning `{ dim: string; name: string; months: Array<{ month: string; revenue: number; orders: number }>; totals: { revenue: number; orders: number } }` (routes slice).
- Produces: `type RankedRow = { name: string; value: number; spark?: number[] }`; `type RankedSelection = { dim: "company" | "product" | "agent"; name: string }`; `CcRankedList({ title, dim, rows, onSelect }): JSX.Element`; `CcDeepDive({ selection, onClose }: { selection: RankedSelection | null; onClose: () => void }): JSX.Element`.

- [ ] Write the client component `components/analytics/command-center/CcRankedList.tsx`:

```tsx
// components/analytics/command-center/CcRankedList.tsx
"use client";
import { Sparkline } from "@/components/charts/Sparkline";
import { fmtCurrency } from "@/lib/analytics/format";
import { barFraction } from "@/lib/analytics/cc-format";

export type RankedRow = { name: string; value: number; spark?: number[] };
export type RankedSelection = { dim: "company" | "product" | "agent"; name: string };

export function CcRankedList({
  title,
  dim,
  rows,
  onSelect,
}: {
  title: string;
  dim: "company" | "product" | "agent";
  rows: RankedRow[];
  onSelect: (sel: RankedSelection) => void;
}) {
  const top = rows.length > 0 ? rows[0].value : 0;
  return (
    <div className="cc-ranked">
      <h2 className="cc-ranked-title">{title}</h2>
      {rows.length === 0 ? (
        <div className="cc-ranked-empty">No data yet</div>
      ) : (
        <ol className="cc-ranked-list">
          {rows.map((row, i) => (
            <li key={row.name} className="cc-ranked-item">
              <button
                type="button"
                className="cc-ranked-row"
                onClick={() => onSelect({ dim, name: row.name })}
              >
                <span className="cc-ranked-rank" aria-hidden>{i + 1}</span>
                <span className="cc-ranked-name" title={row.name}>{row.name}</span>
                <span className="cc-ranked-bar" aria-hidden>
                  <span
                    className="cc-ranked-bar-fill"
                    style={{ width: `${Math.round(barFraction(row.value, top) * 100)}%` }}
                  />
                </span>
                {row.spark && row.spark.length > 1 ? (
                  <span className="cc-ranked-spark" aria-hidden>
                    <Sparkline points={row.spark} ariaLabel="" width={72} height={22} />
                  </span>
                ) : null}
                <span className="cc-ranked-value">{fmtCurrency(row.value)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
```

- [ ] Write the client component `components/analytics/command-center/CcDeepDive.tsx`:

```tsx
// components/analytics/command-center/CcDeepDive.tsx
"use client";
import { useEffect, useState } from "react";
import { Drawer } from "@/components/ui";
import { Sparkline } from "@/components/charts/Sparkline";
import { fmtCurrency, fmtInt } from "@/lib/analytics/format";
import type { RankedSelection } from "./CcRankedList";

type EntitySeries = {
  dim: string;
  name: string;
  months: Array<{ month: string; revenue: number; orders: number }>;
  totals: { revenue: number; orders: number };
};

export function CcDeepDive({
  selection,
  onClose,
}: {
  selection: RankedSelection | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<EntitySeries | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!selection) {
      setData(null);
      setState("idle");
      return;
    }
    let alive = true;
    setState("loading");
    setData(null);
    const url = `/api/portal/analytics/entity?dim=${encodeURIComponent(selection.dim)}&name=${encodeURIComponent(selection.name)}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: EntitySeries) => {
        if (alive) {
          setData(d);
          setState("idle");
        }
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [selection]);

  const months = data?.months ?? [];
  const hasData = months.some((m) => m.revenue > 0 || m.orders > 0);

  return (
    <Drawer
      open={selection !== null}
      onClose={onClose}
      title={selection?.name ?? "Details"}
      className="cc-deepdive"
    >
      {state === "loading" ? (
        <p className="cc-deepdive-empty">Loading…</p>
      ) : state === "error" || !data || !hasData ? (
        <p className="cc-deepdive-empty">No breakdown data yet for this source.</p>
      ) : (
        <div className="cc-deepdive-body">
          <div className="cc-deepdive-totals">
            <div className="cc-deepdive-stat">
              <div className="cc-deepdive-num">{fmtCurrency(data.totals.revenue)}</div>
              <div className="cc-deepdive-lbl">revenue · trailing 13 mo</div>
            </div>
            <div className="cc-deepdive-stat">
              <div className="cc-deepdive-num">{fmtInt(data.totals.orders)}</div>
              <div className="cc-deepdive-lbl">orders · trailing 13 mo</div>
            </div>
          </div>
          <Sparkline
            points={months.map((m) => m.revenue)}
            ariaLabel={`Revenue trend for ${data.name}`}
            width={320}
            height={72}
            fill
            dot
          />
        </div>
      )}
    </Drawer>
  );
}
```

- [ ] Verify types compile: `npm run typecheck`
  Expected: exits 0. Confirms `CcRankedList` consumes the tested `barFraction`, `CcDeepDive` consumes the `Drawer` props (`open`/`onClose`/`title`/`className`) and the entity route's `{ dim, name, months, totals }` shape, and `RankedRow`/`RankedSelection` are exported for Task 10.

- [ ] Verify no literal hex in either file: `grep -nE '#[0-9a-fA-F]{3,8}' components/analytics/command-center/CcRankedList.tsx components/analytics/command-center/CcDeepDive.tsx`
  Expected: no matches (the only inline `style` is `width: N%`, not a color). Manual render check: each `CcRankedList` row is a `<button>` firing `onSelect({dim,name})`, with rank number, name, an inline share-of-top bar (`cc-ranked-bar-fill` width = `barFraction`), an optional mini sparkline (rendered only when a `spark` series is present — fail-soft, since the snapshot carries no per-entity trajectory yet), and the currency value. `CcDeepDive` opens the `Drawer` when `selection !== null`, lazily fetches the entity series on selection change (aborting stale responses via the `alive` flag), and degrades to "No breakdown data yet for this source." on error/empty.

- [ ] Commit: `git add components/analytics/command-center/CcRankedList.tsx components/analytics/command-center/CcDeepDive.tsx && git commit -m "feat(analytics): CcRankedList clickable rows + CcDeepDive drawer drill-through"`

---

### Task 10: `CcExplore` wrapper + restructure `AnalyticsDashboard` into the 3 zones

**Files:**
- Create `components/analytics/command-center/CcExplore.tsx` (`"use client"`)
- Modify `components/analytics/AnalyticsDashboard.tsx` — full rewrite: wrap in `<div className="cc-root …">`, render `<CounterAnimation/>`, restructure into Overview (`CcHero` + `CcBriefing` + `CcKpiTile` row) → Explore (`CcTrend` + product/status mix + `CcExplore`), keep `InsightCards`/`SourceHealth`; keep the `{ snapshot: SnapshotRow; surface: "portal" | "admin" }` signature.
- Modify `app/(portal)/analytics/page.tsx` — remove its now-duplicate `<CounterAnimation/>` render and its import (the counter now lives inside `AnalyticsDashboard`, so both the portal page and the admin mirror get it exactly once).

**Interfaces:**
- Consumes: `SnapshotRow`/`SnapshotPayload` (with `tileSparks`, and `SnapshotRow.briefing`) from `@/lib/analytics/snapshot`; `CounterAnimation` from `@/app/(portal)/dashboard/CounterAnimation`; `CcHero` (Task 7), `CcBriefing`/`CcKpiTile` (Task 8), `CcRankedList`/`CcDeepDive` types (Task 9); `CcTrend` (props `{ trend: SnapshotPayload["trend"]; ariaLabel: string }`) from `@/components/analytics/command-center/CcTrend` (CC-trend slice); `BarChart`/`Donut` from `@/components/charts/*`; `fmtCompactCurrency`/`fmtCurrency`/`fmtInt` from `@/lib/analytics/format`.
- Produces: `CcExplore({ companies, products, agents }: { companies: RankedRow[]; products: RankedRow[]; agents: RankedRow[] }): JSX.Element`; the restructured `AnalyticsDashboard({ snapshot, surface }): JSX.Element` (unchanged public signature).

- [ ] Write the client wrapper `components/analytics/command-center/CcExplore.tsx` (holds selected-entity state so `AnalyticsDashboard` stays a server component):

```tsx
// components/analytics/command-center/CcExplore.tsx
"use client";
import { useState } from "react";
import { CcRankedList, type RankedRow, type RankedSelection } from "./CcRankedList";
import { CcDeepDive } from "./CcDeepDive";

export function CcExplore({
  companies,
  products,
  agents,
}: {
  companies: RankedRow[];
  products: RankedRow[];
  agents: RankedRow[];
}) {
  const [selection, setSelection] = useState<RankedSelection | null>(null);
  return (
    <div className="cc-explore">
      <div className="cc-ranked-grid">
        <CcRankedList title="Top companies" dim="company" rows={companies} onSelect={setSelection} />
        <CcRankedList title="Top products" dim="product" rows={products} onSelect={setSelection} />
        <CcRankedList title="Top agents" dim="agent" rows={agents} onSelect={setSelection} />
      </div>
      <CcDeepDive selection={selection} onClose={() => setSelection(null)} />
    </div>
  );
}
```

- [ ] Rewrite `components/analytics/AnalyticsDashboard.tsx` to the 3-zone command center (full new file):

```tsx
// components/analytics/AnalyticsDashboard.tsx
import type { SnapshotRow } from "@/lib/analytics/snapshot";
import { CounterAnimation } from "@/app/(portal)/dashboard/CounterAnimation";
import { CcHero } from "./command-center/CcHero";
import { CcBriefing } from "./command-center/CcBriefing";
import { CcKpiTile } from "./command-center/CcKpiTile";
import { CcTrend } from "./command-center/CcTrend";
import { CcExplore } from "./command-center/CcExplore";
import { BarChart } from "@/components/charts/BarChart";
import { Donut } from "@/components/charts/Donut";
import { InsightCards } from "./InsightCards";
import { SourceHealth } from "./SourceHealth";
import { fmtCompactCurrency, fmtCurrency, fmtInt } from "@/lib/analytics/format";

export function AnalyticsDashboard({ snapshot, surface }: { snapshot: SnapshotRow; surface: "portal" | "admin" }) {
  const p = snapshot.payload;
  const companies = p.topCompanies.map((c) => ({ name: c.name, value: c.revenue }));
  const products = p.productMix.filter((m) => m.name !== "Other").map((m) => ({ name: m.name, value: m.revenue }));
  const agents = p.topAgents.map((a) => ({ name: a.name, value: a.revenue }));

  return (
    <div className={`cc-root ds-analytics ds-analytics--${surface}`}>
      <CounterAnimation />

      {/* Zone 1 — Overview: what an exec sees in 3 seconds */}
      <section className="cc-overview">
        <CcHero payload={p} />
        <CcBriefing
          briefing={snapshot.briefing ?? ""}
          clientId={surface === "portal" ? snapshot.client_id : undefined}
        />
        <div className="cc-tile-row">
          <CcKpiTile
            label="orders · this month"
            value={p.kpis.ordersThisMonth}
            delta={p.kpis.ordersMoM}
            deltaLabel="vs last month"
            spark={p.tileSparks.orders}
            format={fmtInt}
          />
          <CcKpiTile
            label="avg order value"
            value={p.kpis.avgOrderValue}
            delta={null}
            deltaLabel="per order this month"
            spark={p.tileSparks.avgOrderValue}
            format={fmtCurrency}
          />
          <CcKpiTile
            label="active customers"
            value={p.kpis.activeCustomers}
            delta={null}
            deltaLabel="ordered this month"
            spark={p.tileSparks.activeCustomers}
            format={fmtInt}
          />
        </div>
      </section>

      {/* Zone 2 — Explore: the area+brush trend, mix, and ranked lists */}
      <section className="cc-explore-zone">
        <CcTrend trend={p.trend} ariaLabel={`Revenue and orders over the last ${p.trend.length} months`} />
        <div className="cc-mix-row">
          <div className="cc-panel">
            <h2 className="section-title">Revenue by product</h2>
            <BarChart
              bars={p.productMix.map((m) => ({ label: m.name, value: m.revenue }))}
              format={fmtCompactCurrency}
              ariaLabel="Revenue by product"
            />
          </div>
          <div className="cc-panel">
            <h2 className="section-title">Orders by status</h2>
            <Donut
              segments={p.statusMix.map((s) => ({ label: s.name, value: s.count }))}
              ariaLabel="Orders by status"
            />
          </div>
        </div>
        {/* Zone 3 — Deep-dive lives inside CcExplore (drawer opens on row click) */}
        <CcExplore companies={companies} products={products} agents={agents} />
      </section>

      <InsightCards cards={snapshot.insights ?? []} computedAt={snapshot.computed_at} />
      <SourceHealth sources={p.sources} computedAt={snapshot.computed_at} />
    </div>
  );
}
```

- [ ] Remove the duplicate counter import from `app/(portal)/analytics/page.tsx` (line 7):

  Replace:
  ```tsx
  import { CounterAnimation } from "../dashboard/CounterAnimation";
  ```
  with nothing (delete the line). `AnalyticsDashboard` now owns the count-up so it fires once on both the portal page and the admin mirror.

- [ ] Remove the duplicate counter render from `app/(portal)/analytics/page.tsx` (the `<CounterAnimation />` on line ~30):

  Replace:
  ```tsx
    return (
      <>
        <CounterAnimation />
        <div className="page-header">
  ```
  with:
  ```tsx
    return (
      <>
        <div className="page-header">
  ```

- [ ] Verify types compile: `npm run typecheck`
  Expected: exits 0. Confirms `AnalyticsDashboard` keeps its `{ snapshot; surface }` signature, `CcExplore` receives `RankedRow[]` arrays, `CcTrend` receives `{ trend; ariaLabel }`, and the portal page no longer references the removed import.

- [ ] Verify the route builds: `npm run build`
  Expected: build succeeds and the output route table lists `/analytics` (portal) and the `/clients/[id]/analytics` admin mirror as compiled routes with no errors. Both render `AnalyticsDashboard`, so both now include the count-up exactly once.

- [ ] Verify no literal hex in the new/changed component files: `grep -nE '#[0-9a-fA-F]{3,8}' components/analytics/command-center/CcExplore.tsx components/analytics/AnalyticsDashboard.tsx`
  Expected: no matches. 3-zone render description: (1) **Overview** — `.cc-root` remaps every semantic `--color-*` token to the dark executive palette; inside it, `CcHero` (north-star revenue count-up + MoM/YoY chips + underlaid sparkline + pace-to-goal ring), `CcBriefing` (narrative + Regenerate on portal only), and a `cc-tile-row` of three `CcKpiTile`s (orders/AOV/active customers). (2) **Explore** — `CcTrend` (dual-series area+line with client-side brush), the product `BarChart` + status `Donut` mix row, and `CcExplore` (three clickable `CcRankedList`s). (3) **Deep-dive** — the `Drawer` inside `CcExplore` opens on a ranked-row click and fetches that entity's series. `InsightCards` + `SourceHealth` retain the freshness/health footer.

- [ ] Commit: `git add components/analytics/command-center/CcExplore.tsx components/analytics/AnalyticsDashboard.tsx "app/(portal)/analytics/page.tsx" && git commit -m "feat(analytics): restructure AnalyticsDashboard into cc-root Overview/Explore/Deep-dive"`

---

## Phase 4 — Routes, presentation mode, admin, verification

### Task 11: Entity drill-through route + pure series builder + command-center.css links

**Files:**
- Create `lib/analytics/entity.ts`
- Create `lib/analytics/entity.test.ts`
- Create `app/api/portal/analytics/entity/route.ts`
- Modify `app/(portal)/analytics/page.tsx` — inject the `<link rel="stylesheet" href="/analytics/command-center.css" />` as the first child of the returned fragment (React 19 hoists it into `<head>`; scopes the dark theme to this surface via the `.cc-root` wrapper that `AnalyticsDashboard` supplies).
- Modify `app/(admin)/clients/[id]/analytics/page.tsx` — inject the same `<link>` as the first child of the returned fragment.

**Interfaces:**
- **Consumes:** `queryMetrics(clientId: string, q: { metric: string; grain: Grain; from: string; to: string; dimension?: Record<string,string> }): Promise<StoredMetric[]>` from `@/lib/analytics/store`; `withAuth()` from `@workos-inc/authkit-nextjs`; `getPortalClientId(userId: string): Promise<string | null>` from `@/lib/portal-auth`; `StoredMetric` from `@/lib/analytics/types`.
- **Produces:** `buildEntitySeries(rows: StoredMetric[], months: string[]): EntitySeries`; `trailingMonthKeys(now: Date, count: number): string[]`; `type EntitySeries = { months: Array<{ month: string; revenue: number; orders: number }>; totals: { revenue: number; orders: number } }`; the `GET /api/portal/analytics/entity` handler returning `{ dim, name, months, totals }` (consumed by `CcDeepDive` in an earlier component slice).

Steps:

- [ ] Write the failing test file `lib/analytics/entity.test.ts` with this exact content:

```ts
// lib/analytics/entity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEntitySeries, trailingMonthKeys } from "./entity";
import type { StoredMetric } from "./types";

function m(metric: string, period_start: string, value: number): StoredMetric {
  return {
    source_id: "s1",
    metric,
    grain: "month",
    period_start,
    period_end: period_start,
    dimension: { company: "Acme" },
    value,
  };
}

test("trailingMonthKeys: oldest→newest, count entries, ends at now's UTC month", () => {
  const keys = trailingMonthKeys(new Date("2026-07-15T12:00:00Z"), 13);
  assert.equal(keys.length, 13);
  assert.equal(keys[0], "2025-07");
  assert.equal(keys[12], "2026-07");
});

test("trailingMonthKeys: wraps the year boundary correctly", () => {
  const keys = trailingMonthKeys(new Date("2026-01-10T00:00:00Z"), 3);
  assert.deepEqual(keys, ["2025-11", "2025-12", "2026-01"]);
});

test("buildEntitySeries: empty rows → every month zero-filled, zero totals", () => {
  const months = ["2026-05", "2026-06", "2026-07"];
  const s = buildEntitySeries([], months);
  assert.deepEqual(s.months, [
    { month: "2026-05", revenue: 0, orders: 0 },
    { month: "2026-06", revenue: 0, orders: 0 },
    { month: "2026-07", revenue: 0, orders: 0 },
  ]);
  assert.deepEqual(s.totals, { revenue: 0, orders: 0 });
});

test("buildEntitySeries: revenue + count rows land in the right month + totals", () => {
  const months = ["2026-06", "2026-07"];
  const rows = [
    m("orders.revenue", "2026-06-01", 1000),
    m("orders.count", "2026-06-01", 10),
    m("orders.revenue", "2026-07-01", 2000),
    m("orders.count", "2026-07-01", 20),
  ];
  const s = buildEntitySeries(rows, months);
  assert.deepEqual(s.months, [
    { month: "2026-06", revenue: 1000, orders: 10 },
    { month: "2026-07", revenue: 2000, orders: 20 },
  ]);
  assert.deepEqual(s.totals, { revenue: 3000, orders: 30 });
});

test("buildEntitySeries: multiple rows in one month are summed", () => {
  const months = ["2026-07"];
  const rows = [
    m("orders.revenue", "2026-07-01", 500),
    m("orders.revenue", "2026-07-01", 250),
  ];
  const s = buildEntitySeries(rows, months);
  assert.equal(s.months[0].revenue, 750);
  assert.equal(s.totals.revenue, 750);
});

test("buildEntitySeries: rows outside the window and non-month grain are ignored", () => {
  const months = ["2026-07"];
  const rows: StoredMetric[] = [
    m("orders.revenue", "2020-01-01", 9999),                         // out of window
    { ...m("orders.revenue", "2026-07-01", 100), grain: "week" },     // wrong grain
    m("orders.revenue", "2026-07-01", 100),                          // counted
  ];
  const s = buildEntitySeries(rows, months);
  assert.equal(s.months[0].revenue, 100);
});
```

- [ ] Run `node --import tsx --test lib/analytics/entity.test.ts` — expect FAILURE: the run aborts loading the file with `Error: Cannot find module './entity'` (implementation does not exist yet).

- [ ] Write the implementation file `lib/analytics/entity.ts` with this exact content:

```ts
// lib/analytics/entity.ts
// Pure helpers for the drill-through entity route (app/api/portal/analytics/
// entity). No DB, no React — unit-tested in entity.test.ts.
import type { StoredMetric } from "./types";

export type EntitySeries = {
  months: Array<{ month: string; revenue: number; orders: number }>;
  totals: { revenue: number; orders: number };
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Ordered YYYY-MM keys, oldest→newest, ending at `now`'s UTC month. */
export function trailingMonthKeys(now: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`);
  }
  return out;
}

/**
 * Zero-filled monthly revenue+orders series for one dimensioned entity.
 * `rows` may mix orders.revenue and orders.count month rows; anything whose
 * month is not in `months`, or that is not month-grain, is ignored.
 */
export function buildEntitySeries(rows: StoredMetric[], months: string[]): EntitySeries {
  const rev = new Map<string, number>();
  const ord = new Map<string, number>();
  for (const r of rows) {
    if (r.grain !== "month") continue;
    const mk = r.period_start.slice(0, 7);
    if (r.metric === "orders.revenue") rev.set(mk, (rev.get(mk) ?? 0) + r.value);
    else if (r.metric === "orders.count") ord.set(mk, (ord.get(mk) ?? 0) + r.value);
  }
  const series = months.map((month) => ({
    month,
    revenue: round2(rev.get(month) ?? 0),
    orders: round2(ord.get(month) ?? 0),
  }));
  const totals = series.reduce(
    (a, mo) => ({ revenue: round2(a.revenue + mo.revenue), orders: round2(a.orders + mo.orders) }),
    { revenue: 0, orders: 0 },
  );
  return { months: series, totals };
}
```

- [ ] Run `node --import tsx --test lib/analytics/entity.test.ts` — expect PASS: `# tests 6`, `# pass 6`, `# fail 0`.

- [ ] Write the route handler `app/api/portal/analytics/entity/route.ts` with this exact content (pure logic already covered by entity.test.ts; handler is thin wiring + validation):

```ts
// app/api/portal/analytics/entity/route.ts
import { NextRequest } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getPortalClientId } from "@/lib/portal-auth";
import { queryMetrics } from "@/lib/analytics/store";
import { buildEntitySeries, trailingMonthKeys } from "@/lib/analytics/entity";

export const dynamic = "force-dynamic";

const DIMS = new Set(["company", "product", "status", "agent"]);

export async function GET(req: NextRequest) {
  const { user } = await withAuth();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Tenant isolation: clientId derives from the session, NEVER the query.
  const clientId = await getPortalClientId(user.id);
  if (!clientId) return Response.json({ error: "No client" }, { status: 401 });

  const dim = req.nextUrl.searchParams.get("dim") ?? "";
  const name = req.nextUrl.searchParams.get("name") ?? "";
  if (!DIMS.has(dim)) {
    return Response.json({ error: "dim must be one of company|product|status|agent" }, { status: 400 });
  }
  if (name.length < 1 || name.length > 120) {
    return Response.json({ error: "name must be 1-120 characters" }, { status: 400 });
  }

  const months = trailingMonthKeys(new Date(), 13);
  const from = `${months[0]}-01`;
  const to = `${months[months.length - 1]}-01`;
  const dimension = { [dim]: name };

  try {
    // queryMetrics is client-scoped (.eq('client_id', clientId)) and capped 500.
    const [rev, cnt] = await Promise.all([
      queryMetrics(clientId, { metric: "orders.revenue", grain: "month", from, to, dimension }),
      queryMetrics(clientId, { metric: "orders.count", grain: "month", from, to, dimension }),
    ]);
    const { months: series, totals } = buildEntitySeries([...rev, ...cnt], months);
    return Response.json({ dim, name, months: series, totals });
  } catch (err) {
    // Fail-soft: the deep-dive panel renders its empty state on an empty series.
    console.error("[analytics/entity]", err);
    return Response.json({ dim, name, months: [], totals: { revenue: 0, orders: 0 } });
  }
}
```

- [ ] Edit `app/(portal)/analytics/page.tsx` to add the stylesheet link. Replace:

```tsx
  return (
    <>
      <CounterAnimation />
```

with:

```tsx
  return (
    <>
      <link rel="stylesheet" href="/analytics/command-center.css" />
      <CounterAnimation />
```

- [ ] Edit `app/(admin)/clients/[id]/analytics/page.tsx` to add the stylesheet link. Replace:

```tsx
  return (
    <>
      <div className="admin-page-header">
```

with:

```tsx
  return (
    <>
      <link rel="stylesheet" href="/analytics/command-center.css" />
      <div className="admin-page-header">
```

- [ ] Verify: run `npm run typecheck` — expect no errors. Concrete check: `npm run dev` in one shell, then `curl -s "http://localhost:3000/api/portal/analytics/entity?dim=company&name=Acme"` — expect a JSON body `{"error":"Unauthorized"}` with HTTP 401 (route is wired and returns JSON, never a stack trace); and `curl -s "http://localhost:3000/api/portal/analytics/entity?dim=bogus&name=x"` after signin returns `{"error":"dim must be one of company|product|status|agent"}` (400). (Full dark-theme link render is confirmed under a signed-in browser in Task 14.)

- [ ] Commit: `git add lib/analytics/entity.ts lib/analytics/entity.test.ts app/api/portal/analytics/entity/route.ts "app/(portal)/analytics/page.tsx" "app/(admin)/clients/[id]/analytics/page.tsx"` then `git commit -m "feat(analytics): entity drill-through route + pure series builder + command-center css links"`.

---

### Task 12: Full-screen presentation mode (CcPresent + present routes)

**Files:**
- Create `lib/analytics/present.ts`
- Create `lib/analytics/present.test.ts`
- Create `components/analytics/command-center/CcPresent.tsx` (`"use client"`)
- Create `app/(portal)/analytics/present/page.tsx` (server; gated identically to the dashboard)
- Create `app/(admin)/clients/[id]/analytics/present/page.tsx` (server admin mirror)
- Modify `app/(portal)/analytics/page.tsx` — add a "Present ↗" link inside the existing `.ds-analytics-actions` row.
- Modify `app/(admin)/clients/[id]/analytics/page.tsx` — add a "Present ↗" link into the mirror's `.admin-page-header`.

**Interfaces:**
- **Consumes:** `SnapshotPayload` from `@/lib/analytics/snapshot` (with the additive `yoy: { revenueYoY: number | null; ordersYoY: number | null }` field added in the snapshot slice); `readSnapshot(clientId: string): Promise<SnapshotRow | null>` from `@/lib/analytics/store` (SnapshotRow gains `briefing: string` per the store slice); `listActiveSources(clientId?: string): Promise<DataSourceRow[]>`; `getPortalClientId`; `withAuth`.
- **Produces:** `buildPresentSlides(payload: SnapshotPayload, briefing: string): PresentSlide[]`; the `PresentSlide` discriminated union; `CcPresent(props: { payload: SnapshotPayload; briefing: string })`.

Steps:

- [ ] Write the failing test file `lib/analytics/present.test.ts` with this exact content:

```ts
// lib/analytics/present.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPresentSlides } from "./present";
import type { SnapshotPayload } from "./snapshot";

function payloadOf(over: Partial<SnapshotPayload> = {}): SnapshotPayload {
  return {
    generatedAt: "2026-07-08T00:00:00.000Z",
    kpis: {
      revenueThisMonth: 100000,
      ordersThisMonth: 286,
      avgOrderValue: 349.65,
      activeCustomers: 42,
      revenueMoM: 0.12,
      ordersMoM: -0.03,
    },
    trend: [],
    productMix: [],
    statusMix: [],
    topCompanies: [{ name: "Acme", revenue: 50000, orders: 120 }],
    topAgents: [],
    sources: [],
    yoy: { revenueYoY: 0.25, ordersYoY: null },
    paceToGoal: { target: 150000, mtd: 100000, projected: 145000, fraction: 0.66, basis: "goal" },
    tileSparks: { revenue: [1, 2, 3], orders: [1, 2, 3], avgOrderValue: [1, 2, 3], activeCustomers: [1, 2, 3] },
    ...over,
  };
}

test("buildPresentSlides: full payload + briefing → northstar, movers, briefing, companies in order", () => {
  const slides = buildPresentSlides(payloadOf(), "Revenue is up.");
  assert.deepEqual(slides.map((s) => s.kind), ["northstar", "movers", "briefing", "companies"]);
});

test("buildPresentSlides: northstar is always first and carries the month revenue", () => {
  const slides = buildPresentSlides(payloadOf(), "");
  assert.equal(slides[0].kind, "northstar");
  if (slides[0].kind === "northstar") assert.equal(slides[0].value, 100000);
});

test("buildPresentSlides: empty briefing omits the briefing slide", () => {
  const slides = buildPresentSlides(payloadOf(), "");
  assert.equal(slides.some((s) => s.kind === "briefing"), false);
  assert.deepEqual(slides.map((s) => s.kind), ["northstar", "movers", "companies"]);
});

test("buildPresentSlides: whitespace-only briefing is treated as empty", () => {
  const slides = buildPresentSlides(payloadOf(), "   \n  ");
  assert.equal(slides.some((s) => s.kind === "briefing"), false);
});

test("buildPresentSlides: no top companies omits the companies slide", () => {
  const slides = buildPresentSlides(payloadOf({ topCompanies: [] }), "hi");
  assert.deepEqual(slides.map((s) => s.kind), ["northstar", "movers", "briefing"]);
});

test("buildPresentSlides: movers include revenue MoM, orders MoM, and revenue YoY", () => {
  const slides = buildPresentSlides(payloadOf(), "");
  const movers = slides.find((s) => s.kind === "movers");
  assert.ok(movers && movers.kind === "movers");
  if (movers.kind === "movers") {
    assert.deepEqual(movers.items.map((i) => i.label), ["Revenue MoM", "Orders MoM", "Revenue YoY"]);
    assert.deepEqual(movers.items.map((i) => i.delta), [0.12, -0.03, 0.25]);
  }
});
```

- [ ] Run `node --import tsx --test lib/analytics/present.test.ts` — expect FAILURE: `Error: Cannot find module './present'`.

- [ ] Write the implementation file `lib/analytics/present.ts` with this exact content:

```ts
// lib/analytics/present.ts
// Pure slide-sequence builder for the full-screen presentation mode
// (components/analytics/command-center/CcPresent). No React — unit-tested.
import type { SnapshotPayload } from "./snapshot";

export type PresentSlide =
  | { kind: "northstar"; label: string; value: number; momLabel: string }
  | { kind: "movers"; items: Array<{ label: string; delta: number | null }> }
  | { kind: "briefing"; text: string }
  | { kind: "companies"; rows: Array<{ name: string; revenue: number }> };

/**
 * The ordered highlight reel: north-star → movers → briefing → top companies.
 * The briefing slide is omitted when there is no briefing text; the companies
 * slide is omitted when there are no ranked companies. North-star is always
 * present, so the reel is never empty.
 */
export function buildPresentSlides(payload: SnapshotPayload, briefing: string): PresentSlide[] {
  const slides: PresentSlide[] = [];
  const mom = payload.kpis.revenueMoM;

  slides.push({
    kind: "northstar",
    label: "Revenue this month",
    value: payload.kpis.revenueThisMonth,
    momLabel: mom === null ? "no prior month" : `${mom >= 0 ? "+" : ""}${Math.round(mom * 100)}% MoM`,
  });

  slides.push({
    kind: "movers",
    items: [
      { label: "Revenue MoM", delta: payload.kpis.revenueMoM },
      { label: "Orders MoM", delta: payload.kpis.ordersMoM },
      { label: "Revenue YoY", delta: payload.yoy.revenueYoY },
    ],
  });

  const text = briefing.trim();
  if (text.length > 0) slides.push({ kind: "briefing", text });

  if (payload.topCompanies.length > 0) {
    slides.push({
      kind: "companies",
      rows: payload.topCompanies.map((c) => ({ name: c.name, revenue: c.revenue })),
    });
  }

  return slides;
}
```

- [ ] Run `node --import tsx --test lib/analytics/present.test.ts` — expect PASS: `# tests 6`, `# pass 6`, `# fail 0`.

- [ ] Write the client component `components/analytics/command-center/CcPresent.tsx` with this exact content (colors are semantic `var(--color-*)` tokens only — no hex; the token values are remapped by the dark palette inside the `.cc-root` ancestor supplied by the present pages; briefing text is React-escaped, no `dangerouslySetInnerHTML`):

```tsx
"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { buildPresentSlides, type PresentSlide } from "@/lib/analytics/present";
import type { SnapshotPayload } from "@/lib/analytics/snapshot";

const ADVANCE_MS = 7000;

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtPct(delta: number | null): string {
  if (delta === null) return "—";
  return `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}%`;
}

const wrap: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 200,
  background: "var(--color-bg)", color: "var(--color-text)",
  display: "flex", flexDirection: "column",
};
const stage: CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
  textAlign: "center", padding: "6vh 8vw",
};
const eyebrow: CSSProperties = {
  fontSize: "1.4rem", letterSpacing: "0.18em", textTransform: "uppercase",
  color: "var(--color-text-mute)", marginBottom: "2rem",
};
const bigNum: CSSProperties = {
  fontSize: "clamp(3rem, 12vw, 9rem)", fontWeight: 600, color: "var(--color-gold)", lineHeight: 1,
};
const sub: CSSProperties = { fontSize: "1.6rem", color: "var(--color-text-soft)", marginTop: "1.5rem" };
const bar: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 14,
  padding: "18px", borderTop: "1px solid var(--color-border)",
};
const btn: CSSProperties = {
  background: "var(--color-bg-raised)", color: "var(--color-text)",
  border: "1px solid var(--color-border)", borderRadius: 8, padding: "6px 14px",
  fontSize: 15, cursor: "pointer",
};

export function CcPresent({ payload, briefing }: { payload: SnapshotPayload; briefing: string }) {
  const router = useRouter();
  const slides = buildPresentSlides(payload, briefing);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(false);

  const go = useCallback(
    (dir: 1 | -1) => setIndex((i) => (i + dir + slides.length) % slides.length),
    [slides.length],
  );

  // Read the reduced-motion preference before the auto-advance effect runs.
  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") router.back();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") { e.preventDefault(); setPaused((p) => !p); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, router]);

  useEffect(() => {
    if (paused || reduced.current || slides.length <= 1) return;
    const t = setTimeout(() => go(1), ADVANCE_MS);
    return () => clearTimeout(t);
  }, [index, paused, go, slides.length]);

  const slide = slides[index];

  return (
    <div className="cc-present" style={wrap} role="region" aria-roledescription="carousel" aria-label="Analytics presentation">
      <div style={stage} aria-live="polite">
        <Slide slide={slide} />
      </div>
      <div style={bar}>
        <button type="button" style={btn} onClick={() => go(-1)} aria-label="Previous slide">‹ Prev</button>
        <span aria-hidden="true" style={{ color: "var(--color-text-mute)", fontVariantNumeric: "tabular-nums" }}>
          {index + 1} / {slides.length}
        </span>
        <button type="button" style={btn} onClick={() => setPaused((p) => !p)} aria-label={paused ? "Resume auto-advance" : "Pause auto-advance"}>
          {paused ? "▶ Play" : "⏸ Pause"}
        </button>
        <button type="button" style={btn} onClick={() => go(1)} aria-label="Next slide">Next ›</button>
        <button type="button" style={btn} onClick={() => router.back()} aria-label="Exit presentation">Esc — Exit</button>
      </div>
    </div>
  );
}

function Slide({ slide }: { slide: PresentSlide }) {
  switch (slide.kind) {
    case "northstar":
      return (
        <div>
          <div style={eyebrow}>{slide.label}</div>
          <div style={bigNum}>{fmtMoney(slide.value)}</div>
          <div style={sub}>{slide.momLabel}</div>
        </div>
      );
    case "movers":
      return (
        <div style={{ minWidth: "min(560px, 80vw)" }}>
          <div style={eyebrow}>Top movers</div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "1.2rem" }}>
            {slide.items.map((it) => (
              <li key={it.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "2rem" }}>
                <span style={{ color: "var(--color-text-soft)" }}>{it.label}</span>
                <strong style={{ color: it.delta === null ? "var(--color-text-mute)" : it.delta >= 0 ? "var(--color-sage)" : "var(--color-red)" }}>
                  {fmtPct(it.delta)}
                </strong>
              </li>
            ))}
          </ul>
        </div>
      );
    case "briefing":
      return (
        <div style={{ maxWidth: "min(900px, 82vw)" }}>
          <div style={eyebrow}>AI Briefing</div>
          <p style={{ fontSize: "clamp(1.4rem, 3.2vw, 2.4rem)", lineHeight: 1.5, color: "var(--color-text)" }}>{slide.text}</p>
        </div>
      );
    case "companies":
      return (
        <div style={{ minWidth: "min(560px, 80vw)" }}>
          <div style={eyebrow}>Top companies</div>
          <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "1rem" }}>
            {slide.rows.map((r, i) => (
              <li key={r.name} style={{ display: "flex", justifyContent: "space-between", fontSize: "1.9rem" }}>
                <span style={{ color: "var(--color-text-soft)" }}>{i + 1}. {r.name}</span>
                <strong style={{ color: "var(--color-gold)" }}>{fmtMoney(r.revenue)}</strong>
              </li>
            ))}
          </ol>
        </div>
      );
  }
}
```

- [ ] Write the portal present page `app/(portal)/analytics/present/page.tsx` with this exact content (same auth + active-source gate as the dashboard; wraps in `.cc-root` and loads the dark theme):

```tsx
// app/(portal)/analytics/present/page.tsx
import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { getPortalClientId } from "@/lib/portal-auth";
import { listActiveSources, readSnapshot } from "@/lib/analytics/store";
import { CcPresent } from "@/components/analytics/command-center/CcPresent";

export const dynamic = "force-dynamic";

export default async function AnalyticsPresentPage() {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/analytics/present");

  const clientId = await getPortalClientId(user.id);
  if (!clientId) redirect("/auth/no-account");

  // Same activation gate as /analytics.
  const sources = await listActiveSources(clientId);
  if (sources.length === 0) redirect("/dashboard");

  const snapshot = await readSnapshot(clientId);
  if (!snapshot) redirect("/analytics");

  return (
    <div className="cc-root">
      <link rel="stylesheet" href="/analytics/command-center.css" />
      <CcPresent payload={snapshot.payload} briefing={snapshot.briefing ?? ""} />
    </div>
  );
}
```

- [ ] Write the admin mirror present page `app/(admin)/clients/[id]/analytics/present/page.tsx` with this exact content:

```tsx
// app/(admin)/clients/[id]/analytics/present/page.tsx
import { readSnapshot } from "@/lib/analytics/store";
import { CcPresent } from "@/components/analytics/command-center/CcPresent";
import { EmptyState } from "@/components/ui";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPresent({ params }: Params) {
  const { id } = await params;
  const snapshot = await readSnapshot(id);

  if (!snapshot) {
    return (
      <EmptyState
        title="No snapshot yet"
        body="This client has no computed analytics snapshot yet. Run a sync from the client page first."
      />
    );
  }

  return (
    <div className="cc-root">
      <link rel="stylesheet" href="/analytics/command-center.css" />
      <CcPresent payload={snapshot.payload} briefing={snapshot.briefing ?? ""} />
    </div>
  );
}
```

- [ ] Edit `app/(portal)/analytics/page.tsx` to add the Present link. Replace:

```tsx
          <div className="ds-analytics-actions">
            <a className="ds-btn ds-btn--ghost ds-btn--sm" href="/api/portal/analytics/export?format=csv&table=trend">Export CSV</a>
            <a className="ds-btn ds-btn--ghost ds-btn--sm" href="/api/portal/analytics/export?format=pdf">Export PDF</a>
          </div>
```

with:

```tsx
          <div className="ds-analytics-actions">
            <a className="ds-btn ds-btn--ghost ds-btn--sm" href="/api/portal/analytics/export?format=csv&table=trend">Export CSV</a>
            <a className="ds-btn ds-btn--ghost ds-btn--sm" href="/api/portal/analytics/export?format=pdf">Export PDF</a>
            <a className="ds-btn ds-btn--ghost ds-btn--sm" href="/analytics/present">Present ↗</a>
          </div>
```

- [ ] Edit `app/(admin)/clients/[id]/analytics/page.tsx` to add the Present link to the mirror header. Replace:

```tsx
      <div className="admin-page-header">
        <div>
          <a href={`/clients/${id}`} className="back-link">← Back to client</a>
          <h1>Analytics</h1>
        </div>
      </div>
```

with:

```tsx
      <div className="admin-page-header">
        <div>
          <a href={`/clients/${id}`} className="back-link">← Back to client</a>
          <h1>Analytics</h1>
        </div>
        <a className="admin-card-action" href={`/clients/${id}/analytics/present`}>Present ↗</a>
      </div>
```

- [ ] Verify: run `npm run typecheck` — expect no errors. Confirm `proxy.ts` `config.matcher` already covers the nested routes: `/analytics/:path*` matches `/analytics/present` and `/clients/:path*` matches `/clients/[id]/analytics/present` (no proxy change needed). Concrete manual check with `npm run dev` + a signed-in browser: navigate to `/analytics/present` → full-screen near-black stage renders; press `→`/`←` to change slides, `Space` toggles the Pause label, `Esc` returns to `/analytics`; enable OS "Reduce motion" and reload → slides no longer auto-advance (manual nav still works).

- [ ] Commit: `git add lib/analytics/present.ts lib/analytics/present.test.ts components/analytics/command-center/CcPresent.tsx "app/(portal)/analytics/present/page.tsx" "app/(admin)/clients/[id]/analytics/present/page.tsx" "app/(portal)/analytics/page.tsx" "app/(admin)/clients/[id]/analytics/page.tsx"` then `git commit -m "feat(analytics): full-screen presentation mode (CcPresent + present routes)"`.

---

### Task 13: Admin monthly revenue goal (route + validator + manager field)

**Files:**
- Create `lib/analytics/goal.ts`
- Create `lib/analytics/goal.test.ts`
- Create `app/api/admin/clients/[id]/analytics/goal/route.ts`
- Modify `app/(admin)/clients/[id]/AnalyticsManager.tsx` — add `initialGoalRevenue` prop, goal state, a `saveGoal` handler, and a "Monthly revenue goal ($)" input row.
- Modify `app/(admin)/clients/[id]/page.tsx` — read the current goal via `readSnapshot(id)` and pass `initialGoalRevenue` into `AnalyticsManager`.

**Interfaces:**
- **Consumes:** `setClientGoal(clientId: string, goal: Record<string, number>): Promise<void>` from `@/lib/analytics/store` (store slice — upserts `goal_json` only, preserving payload/insights/briefing); `recordEvent(clientId, kind, actor, payload?)`; `requireAdmin(): Promise<AdminGuardResult>`; `readSnapshot(clientId): Promise<SnapshotRow | null>` (SnapshotRow gains `goal: Record<string, number>` per the store slice).
- **Produces:** `validateGoalPatch(body: unknown): { ok: true; value: { revenue: number } } | { ok: false; reason: string }`; the `PATCH /api/admin/clients/[id]/analytics/goal` handler returning `{ ok, goal }`; `AnalyticsManager` prop `initialGoalRevenue: number | null`.

Steps:

- [ ] Write the failing test file `lib/analytics/goal.test.ts` with this exact content:

```ts
// lib/analytics/goal.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGoalPatch } from "./goal";

test("validateGoalPatch: accepts a positive number, rounding to cents", () => {
  const v = validateGoalPatch({ revenue: 150000.005 });
  assert.ok(v.ok);
  if (v.ok) assert.equal(v.value.revenue, 150000.01);
});

test("validateGoalPatch: accepts zero", () => {
  const v = validateGoalPatch({ revenue: 0 });
  assert.ok(v.ok);
  if (v.ok) assert.equal(v.value.revenue, 0);
});

test("validateGoalPatch: rejects a negative number", () => {
  assert.equal(validateGoalPatch({ revenue: -1 }).ok, false);
});

test("validateGoalPatch: rejects a non-number revenue", () => {
  assert.equal(validateGoalPatch({ revenue: "100" }).ok, false);
});

test("validateGoalPatch: rejects NaN and Infinity", () => {
  assert.equal(validateGoalPatch({ revenue: NaN }).ok, false);
  assert.equal(validateGoalPatch({ revenue: Infinity }).ok, false);
});

test("validateGoalPatch: rejects a null body or a missing revenue field", () => {
  assert.equal(validateGoalPatch(null).ok, false);
  assert.equal(validateGoalPatch({}).ok, false);
});
```

- [ ] Run `node --import tsx --test lib/analytics/goal.test.ts` — expect FAILURE: `Error: Cannot find module './goal'`.

- [ ] Write the implementation file `lib/analytics/goal.ts` with this exact content:

```ts
// lib/analytics/goal.ts
// Pure validation for the admin monthly-goal PATCH
// (app/api/admin/clients/[id]/analytics/goal). No DB — unit-tested.

export type GoalPatch =
  | { ok: true; value: { revenue: number } }
  | { ok: false; reason: string };

/**
 * Accepts { revenue: number } where revenue is finite and >= 0, rounded to
 * cents. Rejects missing/non-object bodies, non-number/NaN/Infinity/negative
 * revenue.
 */
export function validateGoalPatch(body: unknown): GoalPatch {
  if (typeof body !== "object" || body === null) {
    return { ok: false, reason: "body must be an object" };
  }
  const revenue = (body as { revenue?: unknown }).revenue;
  if (typeof revenue !== "number" || !Number.isFinite(revenue)) {
    return { ok: false, reason: "revenue must be a finite number" };
  }
  if (revenue < 0) {
    return { ok: false, reason: "revenue must be >= 0" };
  }
  return { ok: true, value: { revenue: Math.round(revenue * 100) / 100 } };
}
```

- [ ] Run `node --import tsx --test lib/analytics/goal.test.ts` — expect PASS: `# tests 6`, `# pass 6`, `# fail 0`.

- [ ] Write the route handler `app/api/admin/clients/[id]/analytics/goal/route.ts` with this exact content (`requireAdmin`, params awaited, tenant-scoped by the `[id]` param, never throws):

```ts
// app/api/admin/clients/[id]/analytics/goal/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { validateGoalPatch } from "@/lib/analytics/goal";
import { setClientGoal, recordEvent } from "@/lib/analytics/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = validateGoalPatch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: 400 });

  try {
    // setClientGoal upserts goal_json only, preserving payload/insights/briefing.
    await setClientGoal(id, { revenue: parsed.value.revenue });
    await recordEvent(id, "goal.set", guard.user.email, { revenue: parsed.value.revenue });
    return NextResponse.json({ ok: true, goal: { revenue: parsed.value.revenue } });
  } catch (err) {
    console.error("[analytics/goal]", err);
    return NextResponse.json({ error: "Failed to save goal" }, { status: 500 });
  }
}
```

- [ ] Edit `app/(admin)/clients/[id]/AnalyticsManager.tsx` — widen the Props type. Replace:

```tsx
type Props = { clientId: string; initialSources: Source[]; digestEnabled: boolean };
```

with:

```tsx
type Props = { clientId: string; initialSources: Source[]; digestEnabled: boolean; initialGoalRevenue: number | null };
```

- [ ] Edit `app/(admin)/clients/[id]/AnalyticsManager.tsx` — destructure the new prop and add goal state. Replace:

```tsx
export function AnalyticsManager({ clientId, initialSources, digestEnabled }: Props) {
  const [sources, setSources] = useState<Source[]>(initialSources);
  const [digest, setDigest] = useState(digestEnabled);
```

with:

```tsx
export function AnalyticsManager({ clientId, initialSources, digestEnabled, initialGoalRevenue }: Props) {
  const [sources, setSources] = useState<Source[]>(initialSources);
  const [digest, setDigest] = useState(digestEnabled);
  const [goalRevenue, setGoalRevenue] = useState(initialGoalRevenue != null ? String(initialGoalRevenue) : "");
```

- [ ] Edit `app/(admin)/clients/[id]/AnalyticsManager.tsx` — add the `saveGoal` handler after `toggleDigest`. Replace:

```tsx
  async function toggleDigest(next: boolean) {
    setDigest(next);
    const res = await fetch(`/api/admin/clients/${clientId}/analytics/digest`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    if (!res.ok) { setDigest(!next); flash("Failed to update digest", "err"); }
  }
```

with:

```tsx
  async function toggleDigest(next: boolean) {
    setDigest(next);
    const res = await fetch(`/api/admin/clients/${clientId}/analytics/digest`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    if (!res.ok) { setDigest(!next); flash("Failed to update digest", "err"); }
  }

  async function saveGoal() {
    const n = Number(goalRevenue);
    if (!Number.isFinite(n) || n < 0) { flash("Goal must be a number ≥ 0", "err"); return; }
    setBusy("goal");
    const res = await fetch(`/api/admin/clients/${clientId}/analytics/goal`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revenue: n }),
    });
    setBusy(null);
    flash(res.ok ? "Monthly goal saved" : "Failed to save goal", res.ok ? "ok" : "err");
  }
```

- [ ] Edit `app/(admin)/clients/[id]/AnalyticsManager.tsx` — add the goal input row just before the digest/sync footer. Replace:

```tsx
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={digest} onChange={(e) => toggleDigest(e.target.checked)} />
          <span>Weekly email digest</span>
        </label>
```

with:

```tsx
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <div style={{ flex: "0 0 200px" }}>
          <label>Monthly revenue goal ($)</label>
          <input
            className="admin-input"
            style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }}
            type="number"
            min={0}
            step={1000}
            value={goalRevenue}
            onChange={(e) => setGoalRevenue(e.target.value)}
            placeholder="150000"
          />
        </div>
        <button className="admin-btn admin-btn-sm" disabled={busy === "goal"} onClick={saveGoal}>{busy === "goal" ? "Saving…" : "Save goal"}</button>
        <span style={{ fontSize: 11, color: "var(--text-mute)" }}>Powers the hero pace-to-goal ring. Blank / 0 → falls back to last-year pace.</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={digest} onChange={(e) => toggleDigest(e.target.checked)} />
          <span>Weekly email digest</span>
        </label>
```

- [ ] Edit `app/(admin)/clients/[id]/page.tsx` — import `readSnapshot`. Replace:

```tsx
import { hasStoredTokens } from "@/lib/analytics/oauth";
```

with:

```tsx
import { hasStoredTokens } from "@/lib/analytics/oauth";
import { readSnapshot } from "@/lib/analytics/store";
```

- [ ] Edit `app/(admin)/clients/[id]/page.tsx` — read the current goal snapshot after the client fetch. Replace:

```tsx
  if (!client) notFound();
```

with:

```tsx
  if (!client) notFound();

  // Current monthly goal (drives the AnalyticsManager goal field + hero ring).
  const goalSnap = await readSnapshot(id).catch(() => null);
```

- [ ] Edit `app/(admin)/clients/[id]/page.tsx` — pass `initialGoalRevenue` to `AnalyticsManager`. Replace:

```tsx
            initialSources={(dataSources ?? []).map(({ secret_enc, ...s }) => ({
              ...s,
              has_secret: secret_enc != null,
              has_tokens: hasStoredTokens(secret_enc),
            }))}
            digestEnabled={client.analytics_digest_enabled ?? true}
          />
```

with:

```tsx
            initialSources={(dataSources ?? []).map(({ secret_enc, ...s }) => ({
              ...s,
              has_secret: secret_enc != null,
              has_tokens: hasStoredTokens(secret_enc),
            }))}
            digestEnabled={client.analytics_digest_enabled ?? true}
            initialGoalRevenue={typeof goalSnap?.goal?.revenue === "number" ? goalSnap.goal.revenue : null}
          />
```

- [ ] Verify: run `npm run typecheck` — expect no errors. Concrete manual check with `npm run dev` + a signed-in admin browser: open `/clients/<id>`, enter `150000` in "Monthly revenue goal ($)", click "Save goal" → flash "Monthly goal saved" (PATCH returns HTTP 200 `{ ok: true, goal: { revenue: 150000 } }`); reload the page → the field re-populates from `goalSnap.goal.revenue`. Negative/blank input flashes the validation error and issues no PATCH.

- [ ] Commit: `git add lib/analytics/goal.ts lib/analytics/goal.test.ts "app/api/admin/clients/[id]/analytics/goal/route.ts" "app/(admin)/clients/[id]/AnalyticsManager.tsx" "app/(admin)/clients/[id]/page.tsx"` then `git commit -m "feat(analytics): admin monthly revenue goal (route + validator + manager field)"`.

---

### Task 14: Final verification (whole command-center increment)

**Files:** none created/modified — this task runs verification commands and a manual E2E pass over the merged feature. No commit (nothing to add).

**Interfaces:** Consumes the full feature surface produced across all slices (charts additions, snapshot additions, briefing, store additions, CSS, components, routes, present mode, admin goal). Produces nothing.

Steps:

- [ ] Run the full pure-logic suite: `npm test` — expect green, including the new `lib/analytics/entity.test.ts` (6), `lib/analytics/present.test.ts` (6), `lib/analytics/goal.test.ts` (6), plus the earlier-slice `charts.test.ts` (ringArc/areaPath/brushWindow), `snapshot.test.ts` (yoy/paceToGoal/tileSparks), and `briefing.test.ts` (buildBriefingInput/parseBriefing) cases. If `lib/devagent`-related tests flake (known-flaky, network/timing — unrelated to this feature), re-run or scope to the feature with `node --import tsx --test 'lib/analytics/*.test.ts'` and confirm `# fail 0` there.

- [ ] Run `npm run typecheck` — expect zero TypeScript errors across the new routes, pages, and components.

- [ ] Run `npm run build` with the existing placeholder `.env.local` present — expect "Compiled successfully" and the route manifest to list the four new endpoints/pages: `ƒ /api/portal/analytics/entity`, `ƒ /api/admin/clients/[id]/analytics/goal`, `ƒ /analytics/present`, `ƒ /clients/[id]/analytics/present` (all dynamic). Pure exports are lazy-imported, so the build needs no live `ANTHROPIC_API_KEY`.

- [ ] Tenant-isolation audit — run `grep -n "getPortalClientId\|requireAdmin\|client_id\|\.eq(" app/api/portal/analytics/entity/route.ts app/api/admin/clients/[id]/analytics/goal/route.ts` and confirm: the entity route derives `clientId` from `getPortalClientId(user.id)` (never from `dim`/`name`/query) and every warehouse read goes through client-scoped `queryMetrics`; the goal route is gated by `requireAdmin()` and scopes writes to the awaited `[id]` param via `setClientGoal`. Confirm neither route reads a client id from the request body. Also confirm the regenerate route (earlier slice) derives `clientId` from `getPortalClientId` — `grep -n "getPortalClientId" app/api/portal/analytics/briefing/regenerate/route.ts`.

- [ ] CSS-on-three-surfaces check — run `grep -rn "analytics/command-center.css" "app/(portal)/analytics/page.tsx" "app/(admin)/clients/[id]/analytics/page.tsx" "app/(portal)/analytics/present/page.tsx" "app/(admin)/clients/[id]/analytics/present/page.tsx"` and confirm the `<link rel="stylesheet" href="/analytics/command-center.css" />` appears on the portal dashboard, the admin mirror, and both present pages. Confirm `public/analytics/command-center.css` exists (produced by the CSS slice) so the href resolves.

- [ ] Reduced-motion check — run `grep -n "prefers-reduced-motion" public/analytics/command-center.css` and confirm every keyframe/animation is disabled inside `@media (prefers-reduced-motion: reduce)`. Confirm `CcPresent` gates its auto-advance timer on `window.matchMedia("(prefers-reduced-motion: reduce)").matches` (grep `components/analytics/command-center/CcPresent.tsx`).

- [ ] Zero-hex check — run `grep -rnE "#[0-9a-fA-F]{3,8}" components/charts components/analytics/command-center` and confirm NO matches (all colors are `var(--color-*)` tokens). The only file permitted to contain literal dark hexes is `public/analytics/command-center.css` (the `.cc-root` token-remap block, which is the palette definition) — it is intentionally excluded from this grep.

- [ ] Migration-additive check — run `cat supabase/migrations/033_analytics_command_center.sql` and confirm it contains only `ALTER TABLE analytics_snapshots ADD COLUMN briefing TEXT;` and `ALTER TABLE analytics_snapshots ADD COLUMN goal_json JSONB NOT NULL DEFAULT '{}'::jsonb;` — no new tables, no RLS/policy changes, no data mutation. (Applied manually at rollout, not in CI.)

- [ ] Manual E2E checklist (dev run, signed in):
  1. Admin `/clients/<id>`: set "Monthly revenue goal ($)" → save → PATCH 200; reload re-populates the field.
  2. Trigger a sync (Sync now) or run the sync fn → snapshot recomputes with `goal` preserved; hero pace-to-goal ring reflects the goal; AI briefing text appears.
  3. Portal `/analytics`: page renders in the dark `.cc-root` theme; Overview (hero + briefing + KPI tiles) → Explore (trend + mix + ranked lists) present; click a ranked-list row → `CcDeepDive` drawer fetches `/api/portal/analytics/entity?dim=…&name=…` and shows the entity trend, or a graceful "No breakdown data yet" empty state (fail-soft).
  4. `CcBriefing` Regenerate → POSTs `/api/portal/analytics/briefing/regenerate`, updates the card; empty briefing shows the "appears after your next sync" state.
  5. `/analytics/present`: full-screen dark reel auto-cycles north-star → movers → briefing → top companies; `←`/`→` navigate, `Space` pauses, `Esc` exits to `/analytics`; with OS reduce-motion on, no auto-advance.
  6. Admin mirror `/clients/<id>/analytics` and `/clients/<id>/analytics/present` render identically to the portal, gated by `requireAdmin` via the admin layout.