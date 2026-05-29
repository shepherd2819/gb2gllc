import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { TicketActions } from "./TicketActions";

type AdaRun = {
  id: string;
  status: string;
  ship: { prUrl: string | null; merged: boolean } | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
};

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

function AdaRunSummary({ run }: { run: AdaRun }) {
  return (
    <p className="manager-muted ada-run-summary">
      Linked Ada run: <strong>{run.status}</strong>
      {run.ship?.prUrl && <> · <a href={run.ship.prUrl} target="_blank" rel="noreferrer">PR</a></>}
      {run.error && <> · error: {run.error}</>}
    </p>
  );
}

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { id } = await params;
  const [{ data: ticket }, { data: events }] = await Promise.all([
    supabaseAdmin
      .from("tickets")
      .select("*, client:clients(id, name, email, company)")
      .eq("id", id)
      .single(),
    supabaseAdmin
      .from("ticket_events")
      .select("id, kind, actor, payload, body, created_at")
      .eq("ticket_id", id)
      .order("created_at", { ascending: true }),
  ]);
  if (!ticket) redirect("/support");

  let adaRun: AdaRun | null = null;
  if (ticket?.ada_run_id) {
    const { data } = await supabaseAdmin
      .from("devagent_runs")
      .select("id, status, ship, started_at, completed_at, error")
      .eq("id", ticket.ada_run_id)
      .maybeSingle();
    adaRun = (data as AdaRun | null) ?? null;
  }

  return (
    <>
      <div className="page-header">
        <a className="muted" href="/support">← All tickets</a>
        <h1 className="page-title">{ticket.subject}</h1>
        <p className="page-sub">
          {ticket.client?.name} · {ticket.client?.email}
          {ticket.client?.company ? ` · ${ticket.client.company}` : ""}
          {" · "}
          <span className={`badge ${ticket.status}`}>{ticket.status.replace("_", " ")}</span>
        </p>
      </div>

      <section className="ticket-body">
        <h2 className="section-title">Message</h2>
        <pre className="ticket-body-text">{ticket.body}</pre>
      </section>

      <section className="ticket-meta">
        <p><strong>Submitted:</strong> {new Date(ticket.created_at).toLocaleString()}</p>
        {ticket.resolved_at && <p><strong>Resolved:</strong> {new Date(ticket.resolved_at).toLocaleString()}</p>}
      </section>

      <section className="ticket-timeline">
        <h2 className="section-title">Timeline</h2>
        {(events?.length ?? 0) === 0 ? (
          <p className="manager-muted">No events yet.</p>
        ) : (
          <ol className="timeline-list">
            {(events ?? []).map((e) => {
              const prUrl = typeof (e.payload as Record<string, unknown>)?.pr_url === "string"
                ? ((e.payload as Record<string, unknown>).pr_url as string)
                : null;
              return (
                <li key={e.id} className={`timeline-row timeline-${e.kind}`}>
                  <time className="timeline-time">{new Date(e.created_at).toLocaleString()}</time>
                  <span className="timeline-actor">{e.actor}</span>
                  <span className="timeline-kind">{e.kind.replace(/_/g, " ")}</span>
                  {e.body && <span className="timeline-body">{e.body}</span>}
                  {prUrl && (
                    <a className="timeline-pr" href={prUrl} target="_blank" rel="noreferrer">PR ↗</a>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {adaRun && (
          <AdaRunSummary run={adaRun} />
        )}
      </section>

      <TicketActions ticketId={ticket.id} status={ticket.status} />
    </>
  );
}
