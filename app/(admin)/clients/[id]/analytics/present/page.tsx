// app/(admin)/clients/[id]/analytics/present/page.tsx
import { readSnapshot } from "@/lib/analytics/store";
import { CcPresent } from "@/components/analytics/command-center/CcPresent";
import { EmptyState } from "@/components/ui";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPresent({ params }: Params) {
  const { id } = await params;
  const snapshot = await readSnapshot(id);

  if (!snapshot) {
    return (
      <EmptyState
        title="No snapshot yet"
        body="This client has no computed analytics snapshot yet. Run a sync from the client page first."
      />
    );
  }

  return (
    <div className="cc-root">
      <link rel="stylesheet" href="/analytics/command-center.css" />
      <CcPresent payload={snapshot.payload} briefing={snapshot.briefing ?? ""} />
    </div>
  );
}
