import { supabaseAdmin } from "@/lib/supabase";
import { notFound } from "next/navigation";
import { NoraDetail } from "./NoraDetail";

export const dynamic = "force-dynamic";

type Account = { id: string; label: string; stripe_account_id: string | null; livemode: boolean; status: string };
type Event = {
  id: string;
  stripe_event_id: string;
  stripe_event_type: string;
  stripe_object_id: string | null;
  customer_email: string | null;
  customer_name: string | null;
  amount_cents: number | null;
  currency: string | null;
  category: string;
  severity: string;
  summary: string;
  draft_to_email: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  status: string;
  sent_at: string | null;
  alert_sent_at: string | null;
  created_at: string;
};
type Settings = {
  account_id: string;
  dunning_enabled: boolean;
  dunning_voice_notes: string | null;
  dunning_signature: string | null;
  urgent_alert_categories: string[];
  delivery_email: string | null;
  weekly_digest_enabled: boolean;
  weekly_digest_dow: number;
  weekly_digest_local_hour: number;
  timezone: string;
  monthly_burn_cents: number | null;
};
type Digest = { id: string; period_start: string; period_end: string; sent_at: string | null; markdown: string };

export default async function NoraAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ event?: string; status?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;

  const { data: account } = await supabaseAdmin
    .from("nora_accounts").select("id, label, stripe_account_id, livemode, status").eq("id", id).single<Account>();
  if (!account) notFound();

  const statusFilter = sp.status ?? "open";  // synthetic: open = new + classified
  let q = supabaseAdmin
    .from("nora_events")
    .select("id, stripe_event_id, stripe_event_type, stripe_object_id, customer_email, customer_name, amount_cents, currency, category, severity, summary, draft_to_email, draft_subject, draft_body, status, sent_at, alert_sent_at, created_at")
    .eq("account_id", account.id)
    .order("created_at", { ascending: false })
    .limit(150);
  if (statusFilter === "open") q = q.in("status", ["new", "classified"]);
  else if (statusFilter !== "all") q = q.eq("status", statusFilter);

  const { data: events } = await q;

  const { data: settingsRow } = await supabaseAdmin.from("nora_settings").select("*").eq("account_id", account.id).maybeSingle<Settings>();
  const { data: digests } = await supabaseAdmin.from("nora_digests").select("id, period_start, period_end, sent_at, markdown").eq("account_id", account.id).order("created_at", { ascending: false }).limit(8);

  return (
    <NoraDetail
      account={account}
      initialEvents={(events ?? []) as Event[]}
      settings={settingsRow ?? {
        account_id: account.id,
        dunning_enabled: true, dunning_voice_notes: null, dunning_signature: null,
        urgent_alert_categories: ["payment_failed", "charge_disputed", "payout_failed"],
        delivery_email: null,
        weekly_digest_enabled: true, weekly_digest_dow: 1, weekly_digest_local_hour: 8, timezone: "America/Chicago",
        monthly_burn_cents: null,
      }}
      digests={(digests ?? []) as Digest[]}
      currentStatus={statusFilter}
      preselectEventId={sp.event ?? null}
    />
  );
}
