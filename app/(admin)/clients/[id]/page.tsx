import { supabaseAdmin } from "@/lib/supabase";
import { notFound } from "next/navigation";
import { ClientControls } from "./ClientControls";
import { AtriumManager } from "./AtriumManager";
import { EditClientForm } from "./EditClientForm";
import { AnnouncementManager } from "./AnnouncementManager";
import { StewardManager } from "./StewardManager";
import { HeraldManager } from "./HeraldManager";
import { MayaManager } from "./MayaManager";
import { ReeseManager } from "./ReeseManager";
import { DevAgentManager } from "./DevAgentManager";
import { SendInviteButton } from "./SendInviteButton";
import { ContractManager } from "./ContractManager";
import { HollisManager } from "./HollisManager";
import { AnalyticsManager } from "./AnalyticsManager";
import { HubspotSyncManager } from "./HubspotSyncManager";
import { countSyncStats } from "@/lib/hubspot-sync/store";
import { hasStoredTokens } from "@/lib/analytics/oauth";
import { readSnapshot } from "@/lib/analytics/store";

type Params = { params: Promise<{ id: string }> };

export default async function ClientDetailPage({ params }: Params) {
  const { id } = await params;

  const [
    { data: client },
    { data: logs },
    { data: atriumStages },
    { data: heraldTotals },
    { data: announcements },
    { data: stewardAssignments },
    { data: stewardPlatforms },
    { data: stewardTokens },
    { count: markCount },
    { data: members },
    { data: socialConfig },
    { data: metaSubs },
    { data: linkedinConfig },
    { data: linkedinToken },
    { data: linkedinPosts },
    { data: devagentAssignment },
    { data: devagentRuns },
    { data: contracts },
    { data: hollisLine },
    { data: hollisCalls },
    { data: hollisFaq },
    { data: dataSources },
  ] = await Promise.all([
    supabaseAdmin.from("clients").select("*, client_products(*), invoices(id, amount_cents, description, status, sent_at, created_at)").eq("id", id).single(),
    supabaseAdmin.from("client_logs").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(50),
    supabaseAdmin.from("atrium_progress").select("*").eq("client_id", id).order("stage"),
    supabaseAdmin.from("herald_metrics").select("messages_answered, hours_saved, tasks_completed").eq("client_id", id),
    supabaseAdmin.from("announcements").select("*").or(`client_id.eq.${id},client_id.is.null`).order("created_at", { ascending: false }),
    supabaseAdmin.from("client_steward_assignments").select("*, steward_platform_agents(id, display_name, icon, description)").eq("client_id", id).order("created_at", { ascending: true }),
    supabaseAdmin.from("steward_platform_agents").select("id, display_name, icon, description").eq("available", true).order("display_name"),
    supabaseAdmin.from("steward_platform_tokens").select("platform, token_data").eq("client_id", id),
    supabaseAdmin.from("mark_lookups").select("id", { count: "exact", head: true }).eq("client_id", id),
    supabaseAdmin.from("client_members").select("email, joined_at, last_signed_in_at").eq("client_id", id),
    supabaseAdmin.from("client_social_configs").select("*").eq("client_id", id).maybeSingle(),
    supabaseAdmin.from("meta_page_subscriptions").select("page_id, page_name, instagram_username, active, installed_at").eq("client_id", id).order("installed_at", { ascending: true }),
    supabaseAdmin.from("client_linkedin_configs").select("*").eq("client_id", id).maybeSingle(),
    supabaseAdmin.from("steward_platform_tokens").select("token_data").eq("client_id", id).eq("platform", "linkedin").maybeSingle(),
    supabaseAdmin.from("linkedin_posts").select("id, pillar, draft_text, edited_text, status, scheduled_for, published_at, linkedin_url, rejected_reason, created_at").eq("client_id", id).order("created_at", { ascending: false }).limit(50),
    supabaseAdmin
      .from("client_devagent_assignments")
      .select("*")
      .eq("client_id", id)
      .maybeSingle(),
    supabaseAdmin
      .from("devagent_runs")
      .select("id, trigger, triggering_ticket_id, task_text, status, ship, tokens_used, cost_usd, error, started_at, completed_at")
      .eq("client_id", id)
      .order("started_at", { ascending: false })
      .limit(50),
    supabaseAdmin
      .from("contracts")
      .select("id, product, amount_cents, cadence, status, sent_at, signed_at, voided_at, expires_at, signer_name, token")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseAdmin.from("hollis_lines").select("*").eq("client_id", id).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    supabaseAdmin.from("hollis_calls").select("id, outcome, duration_ms, caller_number, created_at").eq("client_id", id).order("created_at", { ascending: false }).limit(20),
    supabaseAdmin.from("hollis_kb").select("question, answer").eq("client_id", id).order("created_at", { ascending: true }),
    supabaseAdmin
      .from("client_data_sources")
      .select("id, kind, provider, label, config, status, last_sync_at, last_sync_error, chat_tool_allowlist, secret_enc")
      .eq("client_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (!client) notFound();

  // Current monthly goal (drives the AnalyticsManager goal field + hero ring).
  const goalSnap = await readSnapshot(id).catch(() => null);

  const heraldRollup = (heraldTotals ?? []).reduce(
    (acc, r) => ({ messages: acc.messages + (r.messages_answered ?? 0), hours: acc.hours + Number(r.hours_saved ?? 0), tasks: acc.tasks + (r.tasks_completed ?? 0) }),
    { messages: 0, hours: 0, tasks: 0 }
  );
  // Each Mark /sqft lookup ≈ 5 min of manual research saved
  const markLookups = markCount ?? 0;
  const markHours = (markLookups * 5) / 60;
  const totals = {
    messages: heraldRollup.messages,
    hours: heraldRollup.hours + markHours,
    tasks: heraldRollup.tasks + markLookups,
    markLookups,
  };

  function rel(iso: string | null): string {
    if (!iso) return "Never";
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  }

  const products = (client.client_products as {id:string;product:string;active:boolean;started_at:string}[]) ?? [];
  const invoices = (client.invoices as {id:string;amount_cents:number;description:string;status:string;sent_at:string;created_at:string}[]) ?? [];
  const spiroSources = (dataSources ?? [])
    .filter((s) => s.provider === "spiro")
    .map((s) => ({ id: s.id as string, label: s.label as string }));
  const hubspotSource = (dataSources ?? []).find((s) => s.provider === "hubspot") ?? null;
  const hubspotStats = hubspotSource
    ? await countSyncStats(hubspotSource.id as string).catch(() => ({ matched: 0, unmatched: 0 }))
    : { matched: 0, unmatched: 0 };

  return (
    <>
      <div className="admin-page-header">
        <div>
          <a href="/clients" className="back-link">← All clients</a>
          <h1>{client.company || client.name || client.email}</h1>
          <span className="client-email">{client.email}</span>
        </div>
        <span className={`status-chip large ${client.status ?? "active"}`}>{client.status ?? "active"}</span>
      </div>

      <div className="admin-stat-row">
        <div className="admin-stat"><div className="asn">{totals.messages.toLocaleString()}</div><div className="asl">Herald conversations</div></div>
        <div className="admin-stat"><div className="asn">{totals.hours.toFixed(1)}h</div><div className="asl">Hours saved</div></div>
        <div className="admin-stat"><div className="asn">{totals.tasks.toLocaleString()}</div><div className="asl">Tasks completed</div></div>
        <div className="admin-stat"><div className="asn">{invoices.length}</div><div className="asl">Invoices sent</div></div>
      </div>

      <div className="admin-two-col">
        <div className="admin-col-stack">

          <div className="admin-card">
            <div className="admin-card-head">
              <h2>Products & Account</h2>
            </div>
            <ClientControls
              clientId={client.id}
              clientEmail={client.email}
              clientName={client.name}
              clientCompany={client.company}
              status={client.status ?? "active"}
              products={products}
              stripeCustomerId={client.stripe_customer_id}
            />
          </div>

          <div className="admin-card">
            <div className="admin-card-head"><h2>Client Info</h2></div>
            <EditClientForm
              clientId={client.id}
              name={client.name}
              email={client.email}
              company={client.company}
            />
            <div className="cm-row" style={{ marginTop: 8 }}><span>Stripe</span><span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{client.stripe_customer_id || <em style={{ color: "var(--text-mute)" }}>Not created</em>}</span></div>
            <div className="cm-row">
              <span>Last sign-in (owner)</span>
              <span title={client.last_signed_in_at ?? "Never"} style={{ color: client.last_signed_in_at ? undefined : "var(--text-mute)" }}>
                {rel(client.last_signed_in_at)}
              </span>
            </div>
            {(members ?? []).map((m, i) => (
              <div className="cm-row" key={i}>
                <span style={{ fontSize: 12 }}>Last sign-in ({m.email})</span>
                <span title={m.last_signed_in_at ?? "Never"} style={{ color: m.last_signed_in_at ? undefined : "var(--text-mute)" }}>
                  {rel(m.last_signed_in_at)}
                </span>
              </div>
            ))}
            <div className="cm-row">
              <span>Portal access</span>
              <span>
                {client.workos_user_id
                  ? <span style={{ color: "var(--sage)" }}>Active</span>
                  : (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ color: "var(--text-mute)" }}>
                        {client.invited_at ? "Invite pending" : client.email ? "Not invited" : "Draft (no email)"}
                      </span>
                      <SendInviteButton
                        clientId={client.id}
                        hasEmail={!!client.email}
                        alreadyInvited={!!client.invited_at}
                      />
                    </span>
                  )
                }
              </span>
            </div>
          </div>

          <HeraldManager
            clientId={client.id}
            initialBotId={client.chatbot_bot_id ?? null}
            initialAgentName={client.chatbot_agent_name ?? null}
            initialEnabled={client.herald_digest_enabled ?? true}
            lastSentAt={client.herald_digest_last_sent_at ?? null}
          />

          <MayaManager
            clientId={client.id}
            initialConfig={socialConfig ?? null}
            subscriptions={metaSubs ?? []}
          />

          <ReeseManager
            clientId={client.id}
            initialConfig={linkedinConfig ?? null}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            subscription={(linkedinToken?.token_data as any) ?? null}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            posts={(linkedinPosts ?? []) as any}
          />

          <ContractManager
            clientId={id}
            contracts={contracts ?? []}
            marketingUrl={process.env.NEXT_PUBLIC_BASE_URL ?? "https://gb2gllc.com"}
          />

          <HollisManager
            clientId={id}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            initialLine={(hollisLine as any) ?? null}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            calls={(hollisCalls ?? []) as any}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            faq={(hollisFaq ?? []) as any}
            spiroSources={spiroSources}
          />

          <AnalyticsManager
            clientId={id}
            // secret_enc is stripped here and replaced with derived booleans —
            // the encrypted credential blob (static secret OR OAuth token
            // bundle) must never reach the browser.
            initialSources={(dataSources ?? []).map(({ secret_enc, ...s }) => ({
              ...s,
              has_secret: secret_enc != null,
              has_tokens: hasStoredTokens(secret_enc),
            }))}
            digestEnabled={client.analytics_digest_enabled ?? true}
            initialGoalRevenue={typeof goalSnap?.goal?.revenue === "number" ? goalSnap.goal.revenue : null}
          />

          <HubspotSyncManager
            clientId={id}
            hubspotSourceId={(hubspotSource?.id as string | undefined) ?? null}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            initialConfig={(hubspotSource?.config as any) ?? {}}
            hasSecret={hubspotSource?.secret_enc != null}
            spiroSources={spiroSources}
            stats={hubspotStats}
          />

          <DevAgentManager
            clientId={id}
            initialAssignment={devagentAssignment ?? null}
            initialRuns={devagentRuns ?? []}
          />

          <AtriumManager clientId={client.id} stages={atriumStages ?? []} />

          <AnnouncementManager clientId={client.id} initialAnnouncements={announcements ?? []} />

          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <StewardManager
            clientId={client.id}
            initialAssignments={(stewardAssignments ?? []) as any}
            platforms={(stewardPlatforms ?? []) as any}
            connectedPlatforms={(stewardTokens ?? []).map((t: { platform: string }) => t.platform)}
          />

          <div className="admin-card">
            <div className="admin-card-head">
              <h2>Invoices</h2>
              <a href={`/billing?client=${client.id}`} className="admin-card-action">New invoice →</a>
            </div>
            {invoices.length === 0
              ? <div className="admin-empty">No invoices yet</div>
              : invoices.map(inv => (
                  <div key={inv.id} className="invoice-row">
                    <span className="inv-desc">{inv.description || "Invoice"}</span>
                    <span className="inv-amount">${(inv.amount_cents / 100).toFixed(2)}</span>
                    <span className={`inv-status ${inv.status}`}>{inv.status}</span>
                    <span className="inv-date">{new Date(inv.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  </div>
                ))
            }
          </div>
        </div>

        <div className="admin-card log-panel">
          <div className="admin-card-head">
            <h2>Logs</h2>
            <a href={`/clients/${id}/logs`} className="admin-card-action">Full logs →</a>
          </div>
          <div className="log-list">
            {(logs ?? []).length === 0 && <div className="admin-empty">No logs yet</div>}
            {(logs ?? []).map(l => (
              <div key={l.id} className={`log-row level-${l.level}`}>
                <span className={`log-level ${l.level}`}>{l.level}</span>
                <span className="log-cat">{l.category}</span>
                <span className="log-msg">{l.message}</span>
                <span className="log-time">{new Date(l.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
