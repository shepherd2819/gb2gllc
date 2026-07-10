// components/charts/Ring.tsx
import { ringArc } from "@/lib/analytics/charts";

export type RingProps = { fraction: number; label: string; value: string; ariaLabel: string };

const RADIUS = 64;
const THICKNESS = 12;
const SIZE = (RADIUS + THICKNESS) * 2;
const CENTER = SIZE / 2;

export function Ring({ fraction, label, value, ariaLabel }: RingProps) {
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const track = ringArc(1, RADIUS, THICKNESS);
  const arc = ringArc(clamped, RADIUS, THICKNESS);
  return (
    <figure className="ds-chart-fig cc-ring">
      <svg className="ds-chart cc-ring-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMidYMid meet">
        <g transform={`translate(${CENTER} ${CENTER})`}>
          {track && <path d={track} fill="none" stroke="var(--color-border)" strokeWidth={THICKNESS} />}
          {arc && <path d={arc} fill="none" stroke="var(--color-gold)" strokeWidth={THICKNESS} strokeLinecap="round" />}
        </g>
      </svg>
      <figcaption className="cc-ring-caption">
        <span className="cc-ring-value">{value}</span>
        <span className="cc-ring-label">{label}</span>
      </figcaption>
    </figure>
  );
}
