import { withAuth } from "@workos-inc/authkit-nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { redirect } from "next/navigation";

export default async function ConnectionsPage() {
  const { user } = await withAuth({ ensureSignedIn: true });
  if (!user) redirect("/auth/signin");

  const { data: client } = await supabaseAdmin
    .from("clients").select("id").eq("workos_user_id", user.id).single();
  if (!client) redirect("/auth/no-account");

  // Pull platform access from their original intake session
  const { data: session } = await supabaseAdmin
    .from("clients")
    .select("intake_sessions(state)")
    .eq("workos_user_id", user.id)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const intakeState = (session as any)?.intake_sessions?.state ?? {};
  const software: string[] = intakeState.software?.selected ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const access: Record<string, any> = intakeState.access ?? {};

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Connections</h1>
        <p className="page-sub">Platforms you connected during onboarding. Contact us to add or remove access.</p>
      </div>

      {software.length === 0 ? (
        <p className="empty-state">No platforms on file. <a href="mailto:hello@gb2gllc.com">Email us</a> to update your stack.</p>
      ) : (
        <div className="connection-list">
          {software.map((id: string) => {
            const a = access[id] ?? {};
            const granted = !!a.granted;
            return (
              <div key={id} className={`connection-row ${granted ? "granted" : "pending"}`}>
                <div className="connection-name">{id}</div>
                <div className="connection-status">
                  <span className={`conn-badge ${granted ? "granted" : "pending"}`}>
                    {granted ? "Connected" : "Pending"}
                  </span>
                  {a.method && <span className="conn-method">{a.method}</span>}
                </div>
                {a.notes && <div className="conn-notes">{a.notes}</div>}
              </div>
            );
          })}
        </div>
      )}

      <div className="conn-cta">
        <p>Need to add a platform or revoke access?</p>
        <a href="mailto:hello@gb2gllc.com?subject=Connection%20update" className="btn-portal-ghost">
          Email us →
        </a>
      </div>
    </>
  );
}
