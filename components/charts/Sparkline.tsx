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
