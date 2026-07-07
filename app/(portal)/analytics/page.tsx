// app/(portal)/analytics/page.tsx
import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { getPortalClientId } from "@/lib/portal-auth";
import { listActiveSources, readSnapshot, getOrCreateConversation, listMessages } from "@/lib/analytics/store";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { CounterAnimation } from "../dashboard/CounterAnimation";
import { ChatPanel } from "./ChatPanel";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/analytics");

  const clientId = await getPortalClientId(user.id);
  if (!clientId) redirect("/auth/no-account");

  // Activation gate: no active source → analytics is not turned on for this client.
  const sources = await listActiveSources(clientId);
  if (sources.length === 0) redirect("/dashboard");

  const snapshot = await readSnapshot(clientId);
  const conversation = await getOrCreateConversation(clientId, user.id);
  const history = await listMessages(conversation.id, clientId);

  return (
    <>
      <CounterAnimation />
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
        <p className="page-sub">Your business, synced and summarized.</p>
      </div>

      {!snapshot ? (
        <EmptyState
          title="First sync pending"
          body="We're pulling your data now. Your dashboard appears here as soon as the first sync finishes — usually within a few minutes."
        />
      ) : (
        <>
          <div className="ds-analytics-actions">
            <a className="ds-btn ds-btn--ghost ds-btn--sm" href="/api/portal/analytics/export?format=csv&table=trend">Export CSV</a>
            <a className="ds-btn ds-btn--ghost ds-btn--sm" href="/api/portal/analytics/export?format=pdf">Export PDF</a>
          </div>
          <AnalyticsDashboard snapshot={snapshot} surface="portal" />
          <ChatPanel conversationId={conversation.id} initialMessages={history} />
        </>
      )}
    </>
  );
}
