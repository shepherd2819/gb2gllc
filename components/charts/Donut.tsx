// components/charts/Donut.tsx
import { donutSegments, CHART_COLORS } from "@/lib/analytics/charts";

export type DonutProps = {
  segments: Array<{ label: string; value: number }>;
  ariaLabel: string;
  format?: (n: number) => string;
};

const W = 320, H = 220, CX = 108, CY = 110, RADIUS = 88, THICK = 30;

export function Donut({ segments, ariaLabel, format }: DonutProps) {
  const fmt = format ?? ((v: number) => String(Math.round(v)));
  const paths = donutSegments(segments, RADIUS, THICK);
  const positive = segments.filter((s) => s.value > 0);
  return (
    <figure className="ds-chart-fig ds-chart-fig--donut">
      <svg className="ds-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMidYMid meet">
        <g transform={`translate(${CX} ${CY})`}>
          {paths.map((p, i) => (
            <path key={i} d={p.d} fill={CHART_COLORS[i % CHART_COLORS.length]} fillRule="evenodd" />
          ))}
        </g>
      </svg>
      <figcaption className="ds-chart-legend ds-chart-legend--stack">
        {positive.map((s, i) => (
          <span key={i} className="ds-chart-legend-item">
            <span className="ds-chart-swatch" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            {s.label} · {fmt(s.value)}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
