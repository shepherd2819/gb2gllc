import { supabaseAdmin } from "@/lib/supabase";
import { NoraAccountsList } from "./NoraAccountsList";

export const dynamic = "force-dynamic";

type Account = {
  id: string;
  label: string;
  stripe_account_id: string | null;
  livemode: boolean;
  status: string;
  stripe_webhook_secret: string | null;
  last_polled_at: string | null;
  last_poll_error: string | null;
  last_metrics_json: {
    balance_available_cents?: number;
    balance_pending_cents?: number;
    currency?: string;
    mrr_cents?: number;
    active_subscriptions?: number;
    past_due_subscriptions?: number;
    failed_payments_last_7d?: { count?: number };
  } | null;
  last_metrics_at: string | null;
};

export default async function NoraIndexPage() {
  const { data: accounts } = await supabaseAdmin
    .from("nora_accounts")
    .select("id, label, stripe_account_id, livemode, status, stripe_webhook_secret, last_polled_at, last_poll_error, last_metrics_json, last_metrics_at")
    .order("updated_at", { ascending: false });

  // Pending dunning drafts + open critical events per account
  const stats: Record<string, { pending_drafts: number; open_critical: number }> = {};
  for (const a of accounts ?? []) {
    const [{ count: drafts }, { count: critical }] = await Promise.all([
      supabaseAdmin.from("nora_events").select("id", { count: "exact", head: true })
        .eq("account_id", a.id).eq("status", "classified").not("draft_body", "is", null),
      supabaseAdmin.from("nora_events").select("id", { count: "exact", head: true })
        .eq("account_id", a.id).eq("severity", "critical")
        .in("status", ["new", "classified"]),
    ]);
    stats[a.id] = { pending_drafts: drafts ?? 0, open_critical: critical ?? 0 };
  }

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1>💰 Nora · Finance & AR</h1>
          <span className="client-email">
            Internal agent. Watches Stripe for failed payments, churns, refunds, disputes.
            Drafts polite dunning emails (you click to send). Weekly cash digest every Monday at 8am.
          </span>
        </div>
      </div>

      <NoraAccountsList initial={(accounts ?? []) as Account[]} stats={stats} />
    </>
  );
}
