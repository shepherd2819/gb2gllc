// components/analytics/DataTable.tsx
import { fmtCurrency, fmtInt } from "@/lib/analytics/format";

export function DataTable({ title, rows }: { title: string; rows: Array<{ name: string; revenue: number; orders: number }> }) {
  return (
    <div className="ds-dt">
      <div className="ds-dt-head">
        <span className="ds-dt-h ds-dt-h--name">{title}</span>
        <span className="ds-dt-h ds-dt-h--num">Revenue</span>
        <span className="ds-dt-h ds-dt-h--num">Orders</span>
      </div>
      {rows.length === 0 ? (
        <div className="ds-dt-empty">No data yet</div>
      ) : (
        rows.map((r, i) => (
          <div key={i} className="ds-dt-row">
            <span className="ds-dt-name" title={r.name}>{r.name}</span>
            <span className="ds-dt-num">{fmtCurrency(r.revenue)}</span>
            <span className="ds-dt-num">{fmtInt(r.orders)}</span>
          </div>
        ))
      )}
    </div>
  );
}
