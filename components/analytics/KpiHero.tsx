// components/analytics/KpiHero.tsx
import type { SnapshotPayload } from "@/lib/analytics/snapshot";
import { fmtCurrency, fmtInt, fmtDelta } from "@/lib/analytics/format";

function Delta({ ratio }: { ratio: number | null }) {
  const d = fmtDelta(ratio);
  return (
    <span className={`ds-kpi-delta ds-kpi-delta--${d.tone}`}>
      <span aria-hidden>{d.arrow}</span> {d.text}
    </span>
  );
}

export function KpiHero({ kpis }: { kpis: SnapshotPayload["kpis"] }) {
  return (
    <div className="stat-grid">
      <div className="stat-card stat-hero">
        <div className="stat-num">{fmtCurrency(kpis.revenueThisMonth)}</div>
        <div className="stat-label">revenue · this month</div>
        <div className="stat-sub"><Delta ratio={kpis.revenueMoM} /> vs last month</div>
      </div>
      <div className="stat-card">
        <div className="stat-num" data-count={String(kpis.ordersThisMonth)}>{fmtInt(kpis.ordersThisMonth)}</div>
        <div className="stat-label">orders · this month</div>
        <div className="stat-sub"><Delta ratio={kpis.ordersMoM} /> vs last month</div>
      </div>
      <div className="stat-card">
        <div className="stat-num">{fmtCurrency(kpis.avgOrderValue)}</div>
        <div className="stat-label">avg order value</div>
        <div className="stat-sub">per order this month</div>
      </div>
      <div className="stat-card">
        <div className="stat-num" data-count={String(kpis.activeCustomers)}>{fmtInt(kpis.activeCustomers)}</div>
        <div className="stat-label">active customers</div>
        <div className="stat-sub">ordered this month</div>
      </div>
    </div>
  );
}
