// components/charts/BarChart.tsx
import { scaleLinear, niceTicks, CHART_COLORS } from "@/lib/analytics/charts";

export type BarChartProps = {
  bars: Array<{ label: string; value: number }>;
  ariaLabel: string;
  format?: (n: number) => string;
};

const W = 640, H = 220, L = 52, R = 12, T = 14, B = 40;
const PW = W - L - R;
const PH = H - T - B;

export function BarChart({ bars, ariaLabel, format }: BarChartProps) {
  const fmt = format ?? ((v: number) => String(Math.round(v)));
  const ticks = niceTicks(Math.max(1, ...bars.map((b) => b.value)), 4);
  const top = ticks[ticks.length - 1] || 1;
  const scale = scaleLinear(top, PH);
  const n = Math.max(1, bars.length);
  const band = PW / n;
  const barW = Math.min(48, band * 0.6);

  return (
    <figure className="ds-chart-fig">
      <svg className="ds-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMidYMid meet">
        {ticks.map((t, i) => {
          const y = T + PH - scale(t);
          return (
            <g key={`g${i}`}>
              <line className="ds-chart-grid" x1={L} y1={y} x2={L + PW} y2={y} />
              <text className="ds-chart-label" x={L - 6} y={y + 3} textAnchor="end">{fmt(t)}</text>
            </g>
          );
        })}
        {bars.map((b, i) => {
          const h = scale(b.value);
          const x = L + i * band + (band - barW) / 2;
          const y = T + PH - h;
          const label = b.label.length > 10 ? `${b.label.slice(0, 9)}…` : b.label;
          return (
            <g key={`b${i}`}>
              <rect x={x} y={y} width={barW} height={Math.max(0, h)} rx={3} fill={CHART_COLORS[0]} />
              <text className="ds-chart-label" x={x + barW / 2} y={H - 22} textAnchor="middle">{label}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
