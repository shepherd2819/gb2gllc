// components/charts/LineChart.tsx
import { linePath, scaleLinear, niceTicks, CHART_COLORS } from "@/lib/analytics/charts";

export type LineChartProps = {
  xLabels: string[];
  primary: { label: string; points: number[]; format?: (n: number) => string };
  secondary?: { label: string; points: number[]; format?: (n: number) => string };
  ariaLabel: string;
};

const W = 640, H = 220, L = 52, R = 52, T = 14, B = 26;
const PW = W - L - R;
const PH = H - T - B;

function xAt(i: number, n: number): number {
  if (n <= 1) return L;
  return L + (i / (n - 1)) * PW;
}

export function LineChart({ xLabels, primary, secondary, ariaLabel }: LineChartProps) {
  const pFmt = primary.format ?? ((x: number) => String(Math.round(x)));
  const pTicks = niceTicks(Math.max(1, ...primary.points), 4);
  const pTop = pTicks[pTicks.length - 1] || 1;
  const pScale = scaleLinear(pTop, PH);
  const n = primary.points.length;

  const pPix = primary.points.map((v, i) => ({ x: xAt(i, n), y: T + PH - pScale(v) }));
  const pLine = linePath(pPix);
  const pArea = pPix.length
    ? `${pLine} L ${pPix[pPix.length - 1].x} ${T + PH} L ${pPix[0].x} ${T + PH} Z`
    : "";

  let sFmt = (x: number) => String(Math.round(x));
  let sTicks: number[] = [];
  let sTop = 1;
  let sPix: Array<{ x: number; y: number }> = [];
  if (secondary) {
    sFmt = secondary.format ?? sFmt;
    sTicks = niceTicks(Math.max(1, ...secondary.points), 4);
    sTop = sTicks[sTicks.length - 1] || 1;
    const sScale = scaleLinear(sTop, PH);
    const sn = secondary.points.length;
    sPix = secondary.points.map((v, i) => ({ x: xAt(i, sn), y: T + PH - sScale(v) }));
  }

  return (
    <figure className="ds-chart-fig">
      <svg className="ds-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMidYMid meet">
        {pTicks.map((t, i) => {
          const y = T + PH - pScale(t);
          return (
            <g key={`g${i}`}>
              <line className="ds-chart-grid" x1={L} y1={y} x2={L + PW} y2={y} />
              <text className="ds-chart-label" x={L - 6} y={y + 3} textAnchor="end">{pFmt(t)}</text>
            </g>
          );
        })}
        {secondary && sTicks.map((t, i) => {
          const y = T + PH - (t / sTop) * PH;
          return <text key={`s${i}`} className="ds-chart-label" x={L + PW + 6} y={y + 3} textAnchor="start">{sFmt(t)}</text>;
        })}
        {pArea && <path className="ds-chart-area" d={pArea} fill={CHART_COLORS[0]} />}
        {pLine && <path className="ds-chart-line" d={pLine} stroke={CHART_COLORS[0]} />}
        {secondary && sPix.length > 0 && <path className="ds-chart-line" d={linePath(sPix)} stroke={CHART_COLORS[2]} strokeDasharray="4 3" />}
        {xLabels.map((lbl, i) => (
          <text key={`x${i}`} className="ds-chart-label" x={xAt(i, xLabels.length)} y={H - 8} textAnchor="middle">{lbl}</text>
        ))}
      </svg>
      <figcaption className="ds-chart-legend">
        <span className="ds-chart-legend-item"><span className="ds-chart-swatch" style={{ background: CHART_COLORS[0] }} />{primary.label}</span>
        {secondary && <span className="ds-chart-legend-item"><span className="ds-chart-swatch" style={{ background: CHART_COLORS[2] }} />{secondary.label}</span>}
      </figcaption>
    </figure>
  );
}
