import { supabaseAdmin } from "@/lib/supabase";
import { notFound } from "next/navigation";
import { ClientControls } from "./ClientControls";
import { AtriumManager } from "./AtriumManager";
import { EditClientForm } from "./EditClientForm";
import { AnnouncementManager } from "./AnnouncementManager";
import { StewardManager } from "./StewardManager";
import { HeraldManager } from "./HeraldManager";

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
  ] = await Promise.all([
    supabaseAdmin.from("clients").select("*, client_products(*), invoices(id, amount_cents, description, status, sent_at, created_at)").eq("id", id).single(),
    supabaseAdmin.from("client_logs").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(50),
    supabaseAdmin.from("atrium_progress").select("*").eq("client_id", id).order("stage"),
    supabaseAdmin.from("herald_metrics").select("messages_answered, hours_saved, tasks_completed").eq("client_id", id),
    supabaseAdmin.from("announcements").select("*").or(`client_id.eq.${id},client_id.is.null`).order("created_at", { ascending: false }),
    supabaseAdmin.from("client_steward_assignments").select("*, steward_platform_agents(id, display_name, icon, description)").eq("client_id", id).order("created_at", { ascending: true }),
    supabaseAdmin.from("steward_platform_agents").select("id, display_name, icon, description").eq("available", true).order("display_name"),
    supabaseAdmin.from("steward_platform_tokens").select("platform").eq("client_id", id),
  ]);

  if (!client) notFound();

  const totals = (heraldTotals ?? []).reduce(
    (acc, r) => ({ messages: acc.messages + (r.messages_answered ?? 0), hours: acc.hours + Number(r.hours_saved ?? 0), tasks: acc.tasks + (r.tasks_completed ?? 0) }),
    { messages: 0, hours: 0, tasks: 0 }
  );

  const products = (client.client_products as {id:string;product:string;active:boolean;started_at:string}[]) ?? [];
  const invoices = (client.invoices as {id:string;amount_cents:number;description:string;status:string;sent_at:string;created_at:string}[]) ?? [];

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
        <div className="admin-stat"><div className="asn">{totals.hours.toFixed(0)}h</div><div className="asl">Hours saved</div></div>
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
            <div className="cm-row"><span>Portal access</span><span>{client.workos_user_id ? <span style={{ color: "var(--sage)" }}>Active</span> : <span style={{ color: "var(--text-mute)" }}>Invite pending</span>}</span></div>
          </div>

          <HeraldManager
            clientId={client.id}
            initialBotId={client.chatbot_bot_id ?? null}
            initialEnabled={client.herald_digest_enabled ?? true}
            lastSentAt={client.herald_digest_last_sent_at ?? null}
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
