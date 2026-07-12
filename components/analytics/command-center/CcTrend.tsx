"use client";
// components/analytics/command-center/CcTrend.tsx
import { useId, useState } from "react";
import { areaPath, linePath, scaleLinear, niceTicks, brushWindow, CHART_COLORS } from "@/lib/analytics/charts";
import { fmtCurrency } from "@/lib/analytics/format";

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
  const strokeId = `${uid}-revenue-stroke`;
  const fromId = `${uid}-from`;
  const toId = `${uid}-to`;

  // Radar-ping markers: the peak-revenue month within the visible (brushed)
  // window, and the last (current/most-recent) visible month. Both reuse the
  // revenue line's own scale math so they sit exactly on the drawn path.
  let peakIndex = 0;
  for (let i = 1; i < n; i++) {
    if (visible[i].revenue > visible[peakIndex].revenue) peakIndex = i;
  }
  const nowIndex = n - 1;
  const peakPoint = revenuePix[peakIndex];
  const nowPoint = revenuePix[nowIndex];
  const isSamePoint = nowIndex === peakIndex;

  return (
    <figure className="ds-chart-fig cc-trend">
      <svg className="ds-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-gold)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-gold)" stopOpacity="0" />
          </linearGradient>
          {/* Cyan → magenta electrified stroke, left to right along the line. */}
          <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-gold)" />
            <stop offset="100%" stopColor="var(--color-blue)" />
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
        {revenueLine && (
          <path
            className="ds-chart-line cc-draw cc-trend-glow"
            d={revenueLine}
            stroke={`url(#${strokeId})`}
            pathLength={1}
          />
        )}
        {ordersLine && <path className="ds-chart-line cc-draw" d={ordersLine} stroke={CHART_COLORS[2]} strokeDasharray="4 3" pathLength={1} />}
        <g className="cc-ping-group cc-ping-group--peak">
          <circle className="cc-ping cc-ping--peak" cx={peakPoint.x} cy={peakPoint.y} r={6} />
          <circle cx={peakPoint.x} cy={peakPoint.y} r={5.5} style={{ fill: "var(--color-amber)" }} />
          <text
            className="ds-chart-label"
            x={peakPoint.x}
            y={peakPoint.y - 14}
            textAnchor="middle"
            style={{ fill: "var(--color-amber)" }}
          >
            {`PEAK · ${fmtCurrency(visible[peakIndex].revenue)}`}
          </text>
        </g>
        <g className="cc-ping-group cc-ping-group--now">
          <circle className="cc-ping cc-ping--now" cx={nowPoint.x} cy={nowPoint.y} r={6} />
          <circle cx={nowPoint.x} cy={nowPoint.y} r={6} style={{ fill: "var(--color-gold)" }} />
          <text
            className="ds-chart-label"
            x={nowPoint.x}
            y={nowPoint.y - 14 - (isSamePoint ? 12 : 0)}
            textAnchor="middle"
            style={{ fill: "var(--color-gold)" }}
          >
            {`MTD · ${fmtCurrency(visible[nowIndex].revenue)}`}
          </text>
        </g>
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
