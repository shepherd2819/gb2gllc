// components/analytics/command-center/CcKpiTile.tsx
import { Sparkline } from "@/components/charts/Sparkline";
import { fmtDelta } from "@/lib/analytics/format";
import { splitFormatted } from "@/lib/analytics/cc-format";

export function CcKpiTile({
  label,
  value,
  delta,
  deltaLabel,
  spark,
  format,
}: {
  label: string;
  value: number;
  delta: number | null;
  deltaLabel: string;
  spark: number[];
  format: (n: number) => string;
}) {
  const { prefix, core } = splitFormatted(format, value);
  const d = fmtDelta(delta);
  return (
    <div className="cc-tile">
      <div className="cc-tile-top">
        <span className="cc-tile-label">{label}</span>
        <span className={`ds-kpi-delta ds-kpi-delta--${d.tone}`}>
          <span aria-hidden>{d.arrow}</span> {d.text}
        </span>
      </div>
      <div className="cc-tile-value">
        {prefix ? <span className="cc-tile-affix" aria-hidden>{prefix}</span> : null}
        <span className="stat-num cc-tile-num" data-count={String(Math.round(value))}>
          {core}
        </span>
      </div>
      <div className="cc-tile-foot">
        <Sparkline points={spark} ariaLabel={`${label} trend`} width={140} height={34} fill dot />
        <span className="cc-tile-delta-label">{deltaLabel}</span>
      </div>
    </div>
  );
}
