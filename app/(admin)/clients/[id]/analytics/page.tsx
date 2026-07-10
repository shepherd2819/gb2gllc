// app/(admin)/clients/[id]/analytics/page.tsx
import { readSnapshot } from "@/lib/analytics/store";
import { hasComputedSnapshot } from "@/lib/analytics/snapshot";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { EmptyState } from "@/components/ui";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsMirror({ params }: Params) {
  const { id } = await params;
  const snapshot = await readSnapshot(id);

  return (
    <>
      <link rel="stylesheet" href="/analytics/command-center.css" />
      <div className="admin-page-header">
        <div>
          <a href={`/clients/${id}`} className="back-link">← Back to client</a>
          <h1>Analytics</h1>
        </div>
        <a className="admin-card-action" href={`/clients/${id}/analytics/present`}>Present ↗</a>
      </div>
      {!hasComputedSnapshot(snapshot) ? (
        <EmptyState
          title="No snapshot yet"
          body="This client has no computed analytics snapshot. Add a source and run a sync from the client page."
        />
      ) : (
        <AnalyticsDashboard snapshot={snapshot} surface="admin" />
      )}
    </>
  );
}
