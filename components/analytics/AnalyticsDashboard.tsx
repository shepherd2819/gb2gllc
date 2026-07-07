// components/analytics/AnalyticsDashboard.tsx
import type { SnapshotRow } from "@/lib/analytics/snapshot";
import { KpiHero } from "./KpiHero";
import { InsightCards } from "./InsightCards";
import { SourceHealth } from "./SourceHealth";
import { DataTable } from "./DataTable";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { Donut } from "@/components/charts/Donut";
import { fmtCompactCurrency, fmtMonthLabel } from "@/lib/analytics/format";

export function AnalyticsDashboard({ snapshot, surface }: { snapshot: SnapshotRow; surface: "portal" | "admin" }) {
  const p = snapshot.payload;
  const xLabels = p.trend.map((t) => fmtMonthLabel(t.month));
  return (
    <div className={`ds-analytics ds-analytics--${surface}`}>
      <KpiHero kpis={p.kpis} />

      <section className="ds-analytics-block">
        <h2 className="section-title">Revenue &amp; orders · {p.trend.length} months</h2>
        <div className="ds-chart-card">
          <LineChart
            xLabels={xLabels}
            primary={{ label: "Revenue", points: p.trend.map((t) => t.revenue), format: fmtCompactCurrency }}
            secondary={{ label: "Orders", points: p.trend.map((t) => t.orders) }}
            ariaLabel={`Revenue and orders over the last ${p.trend.length} months`}
          />
        </div>
      </section>

      <div className="ds-analytics-two">
        <section className="ds-analytics-block">
          <h2 className="section-title">Revenue by product</h2>
          <div className="ds-chart-card">
            <BarChart bars={p.productMix.map((m) => ({ label: m.name, value: m.revenue }))} format={fmtCompactCurrency} ariaLabel="Revenue by product" />
          </div>
        </section>
        <section className="ds-analytics-block">
          <h2 className="section-title">Orders by status</h2>
          <div className="ds-chart-card">
            <Donut segments={p.statusMix.map((s) => ({ label: s.name, value: s.count }))} ariaLabel="Orders by status" />
          </div>
        </section>
      </div>

      <div className="ds-analytics-two">
        <section className="ds-analytics-block"><DataTable title="Top companies" rows={p.topCompanies} /></section>
        <section className="ds-analytics-block"><DataTable title="Top agents" rows={p.topAgents} /></section>
      </div>

      <InsightCards cards={snapshot.insights ?? []} computedAt={snapshot.computed_at} />
      <SourceHealth sources={p.sources} computedAt={snapshot.computed_at} />
    </div>
  );
}
