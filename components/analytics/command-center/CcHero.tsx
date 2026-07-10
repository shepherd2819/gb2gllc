// components/analytics/command-center/CcHero.tsx
import type { SnapshotPayload } from "@/lib/analytics/snapshot";
import { Sparkline } from "@/components/charts/Sparkline";
import { Ring } from "@/components/charts/Ring";
import { fmtCurrency, fmtDelta } from "@/lib/analytics/format";
import { splitFormatted, pacePercent, paceBasisLabel } from "@/lib/analytics/cc-format";

function Chip({ ratio, label }: { ratio: number | null; label: string }) {
  const d = fmtDelta(ratio);
  return (
    <span className={`ds-kpi-delta ds-kpi-delta--${d.tone} cc-chip`}>
      <span aria-hidden>{d.arrow}</span> {d.text} <span className="cc-chip-lbl">{label}</span>
    </span>
  );
}

export function CcHero({ payload }: { payload: SnapshotPayload }) {
  const { kpis, yoy, paceToGoal, tileSparks } = payload;
  const { prefix, core } = splitFormatted(fmtCurrency, kpis.revenueThisMonth);
  const pct = pacePercent(paceToGoal.fraction);
  const basisLabel = paceBasisLabel(paceToGoal.basis);
  return (
    <section
      className="cc-hero"
      aria-label={`Revenue this month ${fmtCurrency(kpis.revenueThisMonth)}`}
    >
      <div className="cc-hero-main">
        <div className="cc-hero-label">revenue · this month</div>
        <div className="cc-hero-value">
          {prefix ? <span className="cc-hero-affix" aria-hidden>{prefix}</span> : null}
          <span className="stat-num cc-hero-num" data-count={String(Math.round(kpis.revenueThisMonth))}>
            {core}
          </span>
        </div>
        <div className="cc-hero-chips">
          <Chip ratio={kpis.revenueMoM} label="MoM" />
          <Chip ratio={yoy.revenueYoY} label="YoY" />
        </div>
        <div className="cc-hero-spark">
          <Sparkline
            points={tileSparks.revenue}
            ariaLabel="Revenue over the trailing 13 months"
            width={420}
            height={64}
            fill
            dot
          />
        </div>
      </div>
      <div className="cc-hero-ring">
        <Ring
          fraction={paceToGoal.fraction}
          value={pct}
          label={basisLabel}
          ariaLabel={`Pace to goal: ${pct} ${basisLabel}`}
        />
      </div>
    </section>
  );
}
