import { fetchAgentStatuses } from "@/lib/agent-status";
import { AgentsSidebar } from "./AgentsSidebar";

export const dynamic = "force-dynamic";

export default async function AgentsLayout({ children }: { children: React.ReactNode }) {
  const statuses = await fetchAgentStatuses();
  return (
    <div className="agents-shell">
      <AgentsSidebar statuses={statuses} />
      <div className="agents-content">{children}</div>
    </div>
  );
}
