"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { GROUPED_AGENTS, type AgentManifestEntry } from "./agents-manifest";

export type AgentStatus = {
  state: "live" | "idle" | "paused" | "unconfigured";  // live = connected + recent activity; idle = connected but quiet; paused = explicitly paused; unconfigured = nothing connected
  badge?: string | null;                                // e.g. "3" for pending count
};

export function AgentsSidebar({ statuses }: { statuses: Record<string, AgentStatus> }) {
  const pathname = usePathname();
  // Highlight the agent whose slug appears in the current path.
  // e.g. /agents/iris/abc123 → iris is active.
  const activeSlug = pathname.split("/")[2] ?? "";

  return (
    <aside className="agents-rail">
      <Link
        href="/agents"
        className={`agents-rail-overview${activeSlug === "" || activeSlug === undefined ? " is-active" : ""}`}
      >
        <span className="agents-rail-glyph">⌂</span>
        <span className="agents-rail-name">All agents</span>
      </Link>

      {GROUPED_AGENTS.map((group) => (
        <div key={group.group} className="agents-rail-group">
          <div className="agents-rail-group-label">{group.label}</div>
          {group.agents.map((a) => (
            <RailItem
              key={a.slug}
              agent={a}
              active={activeSlug === a.slug}
              status={statuses[a.slug]}
            />
          ))}
        </div>
      ))}
    </aside>
  );
}

function RailItem({ agent, active, status }: { agent: AgentManifestEntry; active: boolean; status: AgentStatus | undefined }) {
  return (
    <Link
      href={`/agents/${agent.slug}`}
      className={`agents-rail-item${active ? " is-active" : ""}`}
    >
      <span className="agents-rail-glyph">{agent.glyph}</span>
      <span className="agents-rail-text">
        <span className="agents-rail-name">{agent.name}</span>
        <span className="agents-rail-tagline">{agent.tagline}</span>
      </span>
      <StatusDot status={status} />
      <span className="agents-rail-tooltip" role="tooltip">{agent.description}</span>
    </Link>
  );
}

function StatusDot({ status }: { status: AgentStatus | undefined }) {
  if (!status) return <span className="agents-rail-dot is-unconfigured" aria-label="not configured" />;
  if (status.badge && status.badge !== "0") {
    return <span className="agents-rail-badge">{status.badge}</span>;
  }
  return <span className={`agents-rail-dot is-${status.state}`} aria-label={status.state} />;
}
