// components/charts/Sparkline.tsx
import { linePath, scaleLinear, CHART_COLORS } from "@/lib/analytics/charts";

export type SparklineProps = { points: number[]; ariaLabel: string; width?: number; height?: number };

export function Sparkline({ points, ariaLabel, width = 120, height = 32 }: SparklineProps) {
  const scale = scaleLinear(Math.max(1, ...points), height - 4);
  const n = points.length;
  const pix = points.map((v, i) => ({
    x: n <= 1 ? 1 : (i / (n - 1)) * (width - 2) + 1,
    y: height - 2 - scale(v),
  }));
  return (
    <svg className="ds-chart ds-chart--spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
      <path className="ds-chart-line" d={linePath(pix)} stroke={CHART_COLORS[0]} />
    </svg>
  );
}
