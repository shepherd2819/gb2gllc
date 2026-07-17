// components/analytics/AnalyticsDashboard.tsx
import type { SnapshotRow } from "@/lib/analytics/snapshot";
import { CounterAnimation } from "@/app/(portal)/dashboard/CounterAnimation";
import { CcAmbient } from "./command-center/CcAmbient";
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

export function AnalyticsDashboard({ snapshot, surface, forceDark }: { snapshot: SnapshotRow; surface: "portal" | "admin"; forceDark?: boolean }) {
  const p = snapshot.payload;
  const companies = p.topCompanies.map((c) => ({ name: c.name, value: c.revenue }));
  const products = p.productMix.filter((m) => m.name !== "Other").map((m) => ({ name: m.name, value: m.revenue }));
  const agents = p.topAgents.map((a) => ({ name: a.name, value: a.revenue }));

  return (
    <div className={`cc-root cc-live${forceDark ? " cc-root--dark" : ""} ds-analytics ds-analytics--${surface}`}>
      <CcAmbient />
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
