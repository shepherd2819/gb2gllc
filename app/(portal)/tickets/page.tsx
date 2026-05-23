import { withAuth } from "@workos-inc/authkit-nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { TicketForm } from "./TicketForm";
import { getPortalClientId } from "@/lib/portal-auth";

export default async function TicketsPage() {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/tickets");

  const clientId = await getPortalClientId(user.id);
  if (!clientId) redirect("/auth/no-account");
  const { data: client } = await supabaseAdmin
    .from("clients").select("id").eq("id", clientId).single();
  if (!client) redirect("/auth/no-account");

  const { data: tickets } = await supabaseAdmin
    .from("tickets")
    .select("*")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false });

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Support</h1>
        <p className="page-sub">We typically respond within 4 business hours.</p>
      </div>

      <TicketForm clientId={client.id} />

      {(tickets ?? []).length > 0 && (
        <div className="ticket-list">
          <h2 className="section-title">Your tickets</h2>
          {tickets!.map((t) => (
            <div key={t.id} className={`ticket-row status-${t.status}`}>
              <div className="ticket-subject">{t.subject}</div>
              <div className="ticket-meta">
                <span className={`ticket-status ${t.status}`}>{t.status.replace("_", " ")}</span>
                <span className="ticket-date">{new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
