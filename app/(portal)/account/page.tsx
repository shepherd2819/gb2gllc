import { withAuth } from "@workos-inc/authkit-nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { AccountForm } from "./AccountForm";
import { TeamSection } from "./TeamSection";
import { getPortalClientId, isClientOwner } from "@/lib/portal-auth";

export default async function AccountPage() {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/account");

  const clientId = await getPortalClientId(user.id);
  if (!clientId) redirect("/auth/no-account");
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("name, email, company, created_at")
    .eq("id", clientId)
    .single();
  if (!client) redirect("/auth/no-account");

  const isOwner = await isClientOwner(user.id, clientId);
  const { data: members } = await supabaseAdmin
    .from("client_members")
    .select("id, email, joined_at, invited_at")
    .eq("client_id", clientId)
    .order("invited_at", { ascending: true });

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Account</h1>
        <p className="page-sub">Member since {new Date(client.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
      </div>

      <div className="account-section-title">Profile</div>
      <AccountForm name={client.name} company={client.company} email={client.email} />

      <div className="account-section-title" style={{ marginTop: 32 }}>Team</div>
      <TeamSection
        isOwner={isOwner}
        ownerEmail={client.email}
        initialMembers={(members ?? []).map((m) => ({
          id: m.id,
          email: m.email,
          joined_at: m.joined_at,
          invited_at: m.invited_at,
        }))}
      />

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
