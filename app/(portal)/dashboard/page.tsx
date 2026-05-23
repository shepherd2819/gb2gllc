import { withAuth } from "@workos-inc/authkit-nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { CounterAnimation } from "./CounterAnimation";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { fetchWeeklyMetrics } from "@/lib/chatbot";
import { getPortalClientId } from "@/lib/portal-auth";

async function getClientData(workosUserId: string) {
  const clientId = await getPortalClientId(workosUserId);
  if (!clientId) return null;

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name, company, created_at, chatbot_bot_id, chatbot_agent_name")
    .eq("id", clientId)
    .single();

  if (!client) return null;

  const [
    { data: products },
    { data: stewardMetrics },
    { data: atriumStages },
    { data: tickets },
    { data: rawAnnouncements },
    { data: dismissals },
    { count: markLookupCount },
    { data: stewardAssignments },
  ] = await Promise.all([
    supabaseAdmin.from("client_products").select("*").eq("client_id", client.id).eq("active", true),
    supabaseAdmin.from("steward_metrics").select("*").eq("client_id", client.id),
    supabaseAdmin.from("atrium_progress").select("*").eq("client_id", client.id).order("stage"),
    supabaseAdmin.from("tickets").select("status").eq("client_id", client.id),
    supabaseAdmin.from("announcements").select("id, title, body, type").or(`client_id.eq.${client.id},client_id.is.null`).order("created_at", { ascending: false }),
    supabaseAdmin.from("announcement_dismissals").select("announcement_id").eq("client_id", client.id),
    supabaseAdmin
      .from("mark_lookups")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id),
    supabaseAdmin
      .from("client_steward_assignments")
      .select("id, preset_id, active")
      .eq("client_id", client.id)
      .eq("active", true),
  ]);

  const dismissedIds = new Set((dismissals ?? []).map(d => d.announcement_id));
  const announcements = (rawAnnouncements ?? []).filter(a => !dismissedIds.has(a.id));

  // Live Herald metrics from chatbot.com (last 7 days). Falls back to zeros on failure.
  let herald = { messages: 0, hours: 0, tasks: 0, conversations: 0 };
  if (client.chatbot_bot_id) {
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      const m = await fetchWeeklyMetrics(client.chatbot_bot_id, start, end);
      // Hours saved: rough estimate = 2 min per resolved conversation
      const hours = (m.conversations * 2) / 60;
      herald = {
        conversations: m.conversations,
        messages: m.messages,
        hours,
        tasks: m.conversations,
      };
    } catch (e) {
      console.error("[dashboard] herald metrics fetch failed", e);
    }
  }

  const baseSteward = (stewardMetrics ?? []).reduce(
    (acc, row) => ({
      hours: acc.hours + Number(row.hours_saved ?? 0),
      tasks: acc.tasks + (row.tasks_completed ?? 0),
    }),
    { hours: 0, tasks: 0 }
  );

  // Mark lookups (all-time). Each sqft lookup ≈ 5 min of manual research saved.
  const markCount = markLookupCount ?? 0;
  const markHours = (markCount * 5) / 60;

  const byAgent: Array<{ id: string; name: string; icon: string; tasks: number; hours: number }> = [];
  if (markCount > 0) byAgent.push({ id: "mark", name: "Mark", icon: "🏠", tasks: markCount, hours: markHours });

  const steward = {
    hours: baseSteward.hours + markHours,
    tasks: baseSteward.tasks + markCount,
    byAgent,
  };

  const totalHours = herald.hours + steward.hours;
  const daysActive = Math.floor(
    (Date.now() - new Date(client.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );
  const openTickets = (tickets ?? []).filter((t) => t.status !== "resolved").length;
  const hasActiveSteward = (stewardAssignments ?? []).length > 0;

  return { client, products: products ?? [], herald, steward, totalHours, daysActive, atriumStages: atriumStages ?? [], openTickets, announcements, hasActiveSteward };
}

export default async function DashboardPage() {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin");

  const data = await getClientData(user.id);
  if (!data) redirect("/auth/no-account");

  const { client, products, herald, steward, totalHours, daysActive, atriumStages, openTickets, announcements, hasActiveSteward } = data;
  const hasHerald  = products.some((p) => p.product === "herald");
  const hasAtrium  = products.some((p) => p.product === "atrium");
  // Show Steward card if they have the product OR an active assignment (e.g., Mark)
  const hasSteward = products.some((p) => p.product === "steward") || hasActiveSteward;
  const heraldName = client.chatbot_agent_name?.trim() || "Herald";
  const atriumCompleted = atriumStages.filter((s) => s.completed).length;
  const atriumTotal = atriumStages.length || 5;
  const atriumPct = Math.round((atriumCompleted / atriumTotal) * 100);
  const hourValue = Math.round(totalHours * 45);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <CounterAnimation />
      <AnnouncementBanner announcements={announcements} />

      <div className="dash-hero">
        <div className="dash-greeting">
          <span className="dash-greeting-label">{greeting},</span>
          <h1 className="dash-name">{client.name?.split(" ")[0] || client.company}.</h1>
        </div>
        <p className="dash-sub">
          Your AI has been running for <strong>{daysActive} day{daysActive !== 1 ? "s" : ""}</strong>. Here is what it built while you weren&apos;t watching.
        </p>
      </div>

      <div className="stat-grid">
        <div className="stat-card stat-hero">
          <div className="stat-num" data-count={totalHours.toFixed(1)}>{totalHours.toFixed(1)}</div>
          <div className="stat-label">hours saved</div>
          <div className="stat-sub">&asymp; ${hourValue.toLocaleString()} in staff time</div>
        </div>
        {hasHerald && (
          <div className="stat-card">
            <div className="stat-num" data-count={String(herald.messages)}>{herald.messages.toLocaleString()}</div>
            <div className="stat-label">conversations handled</div>
            <div className="stat-sub">by Herald &middot; no wait, no script</div>
          </div>
        )}
        {(hasHerald || hasSteward) && (
          <div className="stat-card">
            <div className="stat-num" data-count={String(herald.tasks + steward.tasks)}>{(herald.tasks + steward.tasks).toLocaleString()}</div>
            <div className="stat-label">tasks completed</div>
            <div className="stat-sub">while you slept</div>
          </div>
        )}
        <div className="stat-card">
          <div className="stat-num">{daysActive}</div>
          <div className="stat-label">days running</div>
          <div className="stat-sub">no sick days, no PTO</div>
        </div>
      </div>

      <div className="product-section">
        <h2 className="section-title">Your products</h2>
        <div className="product-grid">

          {hasHerald && (
            <div className="product-card">
              <div className="product-card-head">
                <span className="product-name">
                  {heraldName}
                  {client.chatbot_agent_name && (
                    <span style={{ fontSize: 11, color: "var(--text-mute, #8A8C85)", marginLeft: 6, fontWeight: 400, fontFamily: "var(--mono, monospace)" }}>
                      / Herald
                    </span>
                  )}
                </span>
                <span className="product-badge active">Active</span>
              </div>
              <p className="product-desc">AI agent handling conversations 24/7</p>
              <div className="product-stats-row">
                <div className="product-stat"><span className="ps-num">{(herald.conversations ?? herald.messages).toLocaleString()}</span><span className="ps-label">conversations · last 7d</span></div>
                <div className="product-stat"><span className="ps-num">{herald.messages.toLocaleString()}</span><span className="ps-label">messages</span></div>
                <div className="product-stat"><span className="ps-num">{herald.hours.toFixed(1)}h</span><span className="ps-label">saved</span></div>
              </div>
            </div>
          )}

          {hasSteward && (
            <div className="product-card">
              <div className="product-card-head">
                <span className="product-name">Steward</span>
                <span className="product-badge active">Active</span>
              </div>
              <p className="product-desc">AI employees running your internal ops</p>
              <div className="product-stats-row">
                <div className="product-stat"><span className="ps-num">{steward.tasks.toLocaleString()}</span><span className="ps-label">tasks done</span></div>
                <div className="product-stat"><span className="ps-num">{steward.hours.toFixed(1)}h</span><span className="ps-label">saved</span></div>
              </div>
              {(steward.byAgent ?? []).length > 0 && (
                <details className="agent-breakdown">
                  <summary>By agent</summary>
                  <div className="agent-breakdown-list">
                    {steward.byAgent!.map((a) => (
                      <div key={a.id} className="agent-breakdown-row">
                        <span className="ab-name">{a.icon} {a.name}</span>
                        <span className="ab-stats">
                          {a.tasks.toLocaleString()} {a.tasks === 1 ? "task" : "tasks"} · {a.hours.toFixed(1)}h
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {hasAtrium && (
            <div className="product-card">
              <div className="product-card-head">
                <span className="product-name">Atrium</span>
                <span className="product-badge in-progress">In progress</span>
              </div>
              <p className="product-desc">Your site is being built</p>
              <div className="atrium-progress-wrap">
                <div className="atrium-bar-track">
                  <div className="atrium-bar-fill" style={{ width: `${atriumPct}%` }}></div>
                </div>
                <span className="atrium-pct">{atriumPct}%</span>
              </div>
              {atriumStages.length > 0 && (
                <div className="atrium-stages">
                  {atriumStages.map((s) => (
                    <div key={s.id} className={"atrium-stage" + (s.completed ? " done" : "")}>
                      <span className="stage-dot">{s.completed ? "✓" : "○"}</span>
                      <span className="stage-label">{s.label}</span>
                      {s.note && <span className="stage-note">{s.note}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      <div className="quick-actions">
        <a href="/connections" className="qa-card">
          <span className="qa-icon">&#9097;</span>
          <span className="qa-label">Manage connections</span>
          <span className="qa-arrow">&rarr;</span>
        </a>
        <a href="/tickets" className={"qa-card" + (openTickets > 0 ? " qa-alert" : "")}>
          <span className="qa-icon">&#9678;</span>
          <span className="qa-label">Support{openTickets > 0 ? ` · ${openTickets} open` : ""}</span>
          <span className="qa-arrow">&rarr;</span>
        </a>
        <a href="/account" className="qa-card">
          <span className="qa-icon">&#9671;</span>
          <span className="qa-label">Account settings</span>
          <span className="qa-arrow">&rarr;</span>
        </a>
      </div>
    </>
  );
}
