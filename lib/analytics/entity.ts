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
