import { supabaseAdmin } from "@/lib/supabase";
import { notFound } from "next/navigation";
import { HoltDetail } from "./HoltDetail";

export const dynamic = "force-dynamic";

type Account = {
  id: string;
  email_address: string;
  timezone: string | null;
  status: string;
};

type Briefing = {
  id: string;
  event_summary: string | null;
  event_start_at: string;
  event_end_at: string | null;
  event_location: string | null;
  external_attendees: { email: string; name: string | null; company: string | null }[];
  decision: string;
  prebrief_sent_at: string | null;
  evening_sent_at: string | null;
  briefing_markdown: string | null;
  generate_error: string | null;
};

type Settings = {
  account_id: string;
  internal_domains: string[];
  evening_digest_enabled: boolean;
  evening_digest_local_hour: number;
  prebrief_minutes_before: number;
  enable_web_research: boolean;
  voice_notes: string | null;
  delivery_email: string | null;
};

export default async function HoltAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: account } = await supabaseAdmin
    .from("holt_accounts").select("id, email_address, timezone, status").eq("id", id).single<Account>();
  if (!account) notFound();

  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data: briefings } = await supabaseAdmin
    .from("holt_briefings")
    .select("id, event_summary, event_start_at, event_end_at, event_location, external_attendees, decision, prebrief_sent_at, evening_sent_at, briefing_markdown, generate_error")
    .eq("account_id", account.id)
    .gte("event_start_at", since)
    .order("event_start_at", { ascending: false })
    .limit(100);

  const { data: settingsRow } = await supabaseAdmin.from("holt_settings").select("*").eq("account_id", account.id).maybeSingle<Settings>();

  return (
    <HoltDetail
      account={account}
      briefings={(briefings ?? []) as Briefing[]}
      settings={settingsRow ?? {
        account_id: account.id,
        internal_domains: [account.email_address.split("@")[1]?.toLowerCase() ?? ""],
        evening_digest_enabled: true,
        evening_digest_local_hour: 21,
        prebrief_minutes_before: 120,
        enable_web_research: true,
        voice_notes: null,
        delivery_email: null,
      }}
    />
  );
}
