// components/analytics/SourceHealth.tsx
import { StatusPill } from "@/components/ui";
import type { SnapshotPayload } from "@/lib/analytics/snapshot";

export function SourceHealth({ sources, computedAt }: { sources: SnapshotPayload["sources"]; computedAt: string }) {
  const asOf = new Date(computedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <section className="ds-analytics-block">
      <div className="ds-source-health-head">
        <h2 className="section-title">Data sources</h2>
        <span className="ds-source-asof">Data as of {asOf}</span>
      </div>
      <div className="ds-source-list">
        {sources.map((s) => (
          <div key={s.id} className="ds-source-row">
            <div className="ds-source-main">
              <span className="ds-source-label">{s.label}</span>
              <span className="ds-source-provider">{s.provider}</span>
            </div>
            <div className="ds-source-meta">
              {s.lastSyncError ? <span className="ds-source-err" title={s.lastSyncError}>{s.lastSyncError}</span> : null}
              <span className="ds-source-sync">
                {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never"}
              </span>
              <StatusPill status={s.status} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
