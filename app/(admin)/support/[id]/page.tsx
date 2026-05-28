import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { TicketActions } from "./TicketActions";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { id } = await params;
  const { data: ticket } = await supabaseAdmin
    .from("tickets")
    .select("*, client:clients(id, name, email, company)")
    .eq("id", id)
    .single();
  if (!ticket) redirect("/support");

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

      <TicketActions ticketId={ticket.id} status={ticket.status} />
    </>
  );
}
