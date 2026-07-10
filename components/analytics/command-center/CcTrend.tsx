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
