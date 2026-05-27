import { supabaseAdmin } from "@/lib/supabase";
import { AveryCampaignsList } from "./AveryCampaignsList";

export const dynamic = "force-dynamic";

export default async function AveryIndexPage() {
  const { data: campaigns } = await supabaseAdmin
    .from("avery_campaigns")
    .select("id, name, status, sender_email, daily_send_cap, created_at, updated_at")
    .order("updated_at", { ascending: false });

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1>📬 Avery · Outbound outreach</h1>
          <span className="client-email">Internal lead-outreach agent. Drafts personalized cold emails; sends only after you approve each one.</span>
        </div>
      </div>

      <AveryCampaignsList initial={campaigns ?? []} />
    </>
  );
}
