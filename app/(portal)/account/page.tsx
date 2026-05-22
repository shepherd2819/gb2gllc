import { withAuth } from "@workos-inc/authkit-nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { redirect } from "next/navigation";

export default async function AccountPage() {
  const { user } = await withAuth({ ensureSignedIn: true });
  if (!user) redirect("/auth/signin");

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("name, email, company, created_at")
    .eq("workos_user_id", user.id)
    .single();
  if (!client) redirect("/auth/no-account");

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Account</h1>
      </div>

      <div className="account-card">
        <div className="account-row"><span className="account-label">Name</span><span>{client.name || "—"}</span></div>
        <div className="account-row"><span className="account-label">Email</span><span>{client.email}</span></div>
        <div className="account-row"><span className="account-label">Company</span><span>{client.company || "—"}</span></div>
        <div className="account-row"><span className="account-label">Member since</span><span>{new Date(client.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span></div>
      </div>

      <div className="danger-zone">
        <h2 className="danger-title">Close account</h2>
        <p className="danger-sub">This will cancel all active products and delete your portal access. Your data is retained for 30 days then permanently removed.</p>
        <a href="mailto:hello@gb2gllc.com?subject=Account%20deletion%20request" className="danger-btn">
          Request account deletion →
        </a>
      </div>
    </>
  );
}
