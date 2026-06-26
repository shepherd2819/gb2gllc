import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

type JourneyRow = {
  id: string;
  stage: string;
  tier: string;
  template: string;
  ttv_target_at: string | null;
  activated_at: string | null;
  updated_at: string;
  clients: { name: string | null; company: string | null } | null;
};

const ACTIVE_STAGES = ["invited", "kickoff_scheduled", "provisioning"];

export default async function JourneysPage() {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/journeys");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { data } = await supabaseAdmin
    .from("onboarding_journeys")
    .select("id, stage, tier, template, ttv_target_at, activated_at, updated_at, clients(name, company)")
    .order("updated_at", { ascending: false })
    .limit(200);

  const all = (data ?? []) as unknown as JourneyRow[];
  const now = Date.now();
  const isStuck = (j: JourneyRow) =>
    j.stage === "stalled" ||
    (!!j.ttv_target_at && new Date(j.ttv_target_at).getTime() < now && !["complete", "adopted"].includes(j.stage));

  const active = all.filter((j) => ACTIVE_STAGES.includes(j.stage)).length;
  const live = all.filter((j) => ["activated", "adopted", "complete"].includes(j.stage)).length;
  const stuck = all.filter(isStuck).length;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Onboarding · Journeys</h1>
        <p className="page-sub">Every client&apos;s path from signed to live — time-to-value and anything stuck.</p>
      </div>

      <div style={{ marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
        <span><strong>{all.length}</strong> total</span>
        <span><strong>{active}</strong> in progress</span>
        <span><strong>{live}</strong> live</span>
        <span style={{ color: stuck ? "var(--red, #C4524B)" : undefined }}><strong>{stuck}</strong> stuck / over-TTV</span>
      </div>

      {all.length === 0 ? (
        <p className="muted">No onboarding journeys yet. They start when a contract is signed.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Stage</th>
                <th>Tier</th>
                <th>TTV target</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {all.map((j) => (
                <tr key={j.id} style={isStuck(j) ? { background: "rgba(196,82,75,0.06)" } : undefined}>
                  <td>{j.clients?.company || j.clients?.name || "—"}</td>
                  <td>{j.stage.replace(/_/g, " ")}{isStuck(j) ? " ⚠" : ""}</td>
                  <td>{j.tier.replace(/_/g, " ")}</td>
                  <td>{j.ttv_target_at ? new Date(j.ttv_target_at).toLocaleDateString() : "—"}</td>
                  <td>{new Date(j.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
