import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { AveryCampaignDetail } from "./AveryCampaignDetail";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export default async function AveryCampaignPage({ params }: Params) {
  const { id } = await params;

  const [{ data: campaign }, { data: leads }, { count: sentToday }] = await Promise.all([
    supabaseAdmin.from("avery_campaigns").select("*").eq("id", id).single(),
    supabaseAdmin.from("avery_leads").select("*").eq("campaign_id", id).order("created_at", { ascending: false }).limit(500),
    supabaseAdmin
      .from("avery_leads")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", id)
      .eq("status", "sent")
      .gte("sent_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);

  if (!campaign) return notFound();

  return (
    <AveryCampaignDetail
      campaign={campaign}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialLeads={(leads ?? []) as any}
      sentTodayCount={sentToday ?? 0}
    />
  );
}
