// app/(admin)/AdminSidebar.tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buildNav, isNavActive, type NavItem } from "@/lib/admin-nav";
import type { AgentStatus } from "@/lib/agent-status";
import { GROUPED_AGENTS } from "./agents/agents-manifest";
import { AdminThemeToggle } from "./AdminThemeToggle";

const NAV_SECTIONS = buildNav(GROUPED_AGENTS);

export function AdminSidebar({
  statuses,
  ticketCount,
}: {
  statuses: Record<string, AgentStatus>;
  ticketCount: number;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggleCollapsed() {
    const el = document.documentElement;
    if (el.getAttribute("data-rail") === "collapsed") {
      el.removeAttribute("data-rail");
      localStorage.setItem("gb2g_admin_rail", "open");
    } else {
      el.setAttribute("data-rail", "collapsed");
      localStorage.setItem("gb2g_admin_rail", "collapsed");
    }
  }

  return (
    <>
      <button className="shell-menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open navigation">☰</button>
      {mobileOpen && <div className="shell-backdrop" onClick={() => setMobileOpen(false)} />}

      <aside className={`shell-rail${mobileOpen ? " is-open" : ""}`}>
        <div className="shell-rail-top">
          <Link href="/admin" className="admin-mark" onClick={() => setMobileOpen(false)}>
            gb<span className="a2">2</span>g<span className="admin-badge">admin</span>
          </Link>
          <button
            className="shell-rail-search"
            onClick={() => { setMobileOpen(false); window.dispatchEvent(new Event("gb2g:open-palette")); }}
          >
            <span className="shell-rail-glyph">⌕</span>
            <span className="shell-rail-search-text">Search</span>
            <kbd>⌘K</kbd>
          </button>
        </div>

        <nav className="shell-rail-nav">
          {NAV_SECTIONS.map((section) => (
            <div key={section.key}>
              {section.heading && <div className="shell-rail-heading">{section.heading}</div>}
              {section.groups.map((group, gi) => (
                <div key={gi}>
                  {group.label && <div className="shell-rail-sublabel">{group.label}</div>}
                  {group.items.map((item) => (
                    <RailItem
                      key={item.href}
                      item={item}
                      active={isNavActive(pathname, item.href)}
                      status={item.agentSlug ? statuses[item.agentSlug] : undefined}
                      count={item.badgeKey === "tickets" ? ticketCount : 0}
                      onNavigate={() => setMobileOpen(false)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </nav>

        <div className="shell-rail-foot">
          <button className="shell-rail-collapse" onClick={toggleCollapsed} aria-label="Toggle sidebar width">⟨⟩</button>
          <AdminThemeToggle />
          <a href="/auth/signout" className="admin-signout">Sign out</a>
        </div>
      </aside>
    </>
  );
}

function RailItem({
  item, active, status, count, onNavigate,
}: {
  item: NavItem;
  active: boolean;
  status: AgentStatus | undefined;
  count: number;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={item.href}
      className={`shell-rail-item${active ? " is-active" : ""}`}
      title={item.title ?? item.label}
      transitionTypes={["nav-section"]}
      onClick={onNavigate}
    >
      <span className="shell-rail-glyph">{item.glyph}</span>
      <span className="shell-rail-label">{item.label}</span>
      {count > 0 && <span className="shell-badge">{count}</span>}
      {item.agentSlug && <AgentDot status={status} />}
    </Link>
  );
}

function AgentDot({ status }: { status: AgentStatus | undefined }) {
  if (!status) return <span className="shell-dot is-unconfigured" aria-label="not configured" />;
  if (status.badge && status.badge !== "0") return <span className="shell-badge">{status.badge}</span>;
  return <span className={`shell-dot is-${status.state}`} aria-label={status.state} />;
}
