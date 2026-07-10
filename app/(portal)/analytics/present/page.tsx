// app/(portal)/analytics/present/page.tsx
import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { getPortalClientId } from "@/lib/portal-auth";
import { listActiveSources, readSnapshot } from "@/lib/analytics/store";
import { CcPresent } from "@/components/analytics/command-center/CcPresent";

export const dynamic = "force-dynamic";

export default async function AnalyticsPresentPage() {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/analytics/present");

  const clientId = await getPortalClientId(user.id);
  if (!clientId) redirect("/auth/no-account");

  // Same activation gate as /analytics.
  const sources = await listActiveSources(clientId);
  if (sources.length === 0) redirect("/dashboard");

  const snapshot = await readSnapshot(clientId);
  if (!snapshot) redirect("/analytics");

  return (
    <div className="cc-root">
      <link rel="stylesheet" href="/analytics/command-center.css" />
      <CcPresent payload={snapshot.payload} briefing={snapshot.briefing ?? ""} />
    </div>
  );
}
