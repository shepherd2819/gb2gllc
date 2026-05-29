import Stripe from "stripe";

// Each connected account has its own restricted key, so we instantiate
// a fresh Stripe client per call rather than reusing the platform one
// in lib/stripe.ts (which uses STRIPE_SECRET_KEY for Herald billing).
export function stripeFor(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: "2026-04-22.dahlia" });
}

// ─── Account discovery ──────────────────────────────────────────────────
export async function fetchStripeAccount(secretKey: string): Promise<{ id: string; livemode: boolean; label: string }> {
  const s = stripeFor(secretKey);
  // /v1/account uses the key's account context; for a restricted key on the
  // platform account this returns the platform account, which is exactly
  // what we want.
  // SDK v22 typing requires an explicit id; "me" / undefined route to the key's
  // own account. We cast to a permissive shape and rely on the runtime behavior.
  const acct = await (s.accounts.retrieve as (id?: string) => Promise<Stripe.Account>)();
  const business = (acct.business_profile?.name as string | null | undefined) ?? null;
  const display = business ?? (acct as Stripe.Account & { settings?: { dashboard?: { display_name?: string } } }).settings?.dashboard?.display_name ?? acct.email ?? acct.id;
  return {
    id: acct.id,
    livemode: secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_"),
    label: display ?? acct.id,
  };
}

// ─── Metrics: snapshot for the weekly digest + dashboard ────────────────
export type StripeMetrics = {
  balance_available_cents: number;
  balance_pending_cents: number;
  currency: string;
  mrr_cents: number;
  active_subscriptions: number;
  past_due_subscriptions: number;
  canceled_last_30d: number;
  failed_payments_last_7d: { count: number; total_cents: number };
  successful_payments_last_7d: { count: number; total_cents: number };
  refunds_last_7d: { count: number; total_cents: number };
  disputes_open: number;
  top_customers: { id: string; name: string; email: string | null; mrr_cents: number }[];
  collected_at: string;
};

export async function fetchMetrics(secretKey: string): Promise<StripeMetrics> {
  const s = stripeFor(secretKey);
  const now = Math.floor(Date.now() / 1000);
  const sevenDays = now - 7 * 86400;
  const thirtyDays = now - 30 * 86400;

  const [balance, subs, charges7, charges7Failed, refunds7, disputes] = await Promise.all([
    s.balance.retrieve(),
    listAll(s.subscriptions, { status: "all", limit: 100, expand: ["data.customer"] }, 300),
    listAll(s.charges, { created: { gte: sevenDays }, limit: 100 }, 500),
    listAll(s.charges, { created: { gte: sevenDays }, limit: 100 } as Record<string, unknown>, 500),
    listAll(s.refunds, { created: { gte: sevenDays }, limit: 100 }, 500),
    listAll(s.disputes, { limit: 100 }, 200),
  ]);

  // ── MRR calc: sum monthly equivalent of all active subscriptions ──
  const active = subs.filter((sub) => sub.status === "active" || sub.status === "trialing");
  const pastDue = subs.filter((sub) => sub.status === "past_due");
  const canceled30 = subs.filter((sub) => sub.canceled_at && sub.canceled_at >= thirtyDays);

  let mrrCents = 0;
  const customerMrr = new Map<string, number>();
  for (const sub of active) {
    for (const item of sub.items.data) {
      const price = item.price;
      const recurring = price.recurring;
      if (!recurring || !price.unit_amount) continue;
      const monthly = monthlyAmount(price.unit_amount * (item.quantity ?? 1), recurring.interval, recurring.interval_count ?? 1);
      mrrCents += monthly;
      const custId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
      if (custId) customerMrr.set(custId, (customerMrr.get(custId) ?? 0) + monthly);
    }
  }

  // ── Top customers by MRR ──
  const topCustomerIds = [...customerMrr.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  const topCustomers = await Promise.all(topCustomerIds.map(async (id) => {
    try {
      const c = await s.customers.retrieve(id);
      if ("deleted" in c && c.deleted) return null;
      return { id, name: (c as Stripe.Customer).name ?? (c as Stripe.Customer).email ?? id, email: (c as Stripe.Customer).email ?? null, mrr_cents: customerMrr.get(id) ?? 0 };
    } catch { return null; }
  }));

  // ── Failed payments in last 7d (charges with status='failed') ──
  // Note: charges.list with query='status:"failed"' uses Stripe Search; if
  // your account doesn't have Search enabled this falls back to filtering.
  const succeeded = charges7.filter((c) => c.status === "succeeded");
  const failed = charges7Failed.length ? charges7Failed : charges7.filter((c) => c.status === "failed");

  return {
    balance_available_cents: sumBalance(balance.available),
    balance_pending_cents: sumBalance(balance.pending),
    currency: (balance.available[0]?.currency ?? "usd").toUpperCase(),
    mrr_cents: mrrCents,
    active_subscriptions: active.length,
    past_due_subscriptions: pastDue.length,
    canceled_last_30d: canceled30.length,
    failed_payments_last_7d: { count: failed.length, total_cents: failed.reduce((sum, c) => sum + (c.amount ?? 0), 0) },
    successful_payments_last_7d: { count: succeeded.length, total_cents: succeeded.reduce((sum, c) => sum + (c.amount ?? 0), 0) },
    refunds_last_7d: { count: refunds7.length, total_cents: refunds7.reduce((sum, r) => sum + (r.amount ?? 0), 0) },
    // Only count actively contested disputes — Stripe surfaces a handful of
    // resolved/closed statuses we want to ignore.
    disputes_open: disputes.filter((d) => d.status === "needs_response" || d.status === "warning_needs_response" || d.status === "warning_under_review" || d.status === "under_review").length,
    top_customers: topCustomers.filter((c): c is { id: string; name: string; email: string | null; mrr_cents: number } => c !== null),
    collected_at: new Date().toISOString(),
  };
}

// ─── Customer lookup helper (used by webhook to enrich events) ──────────
export async function getCustomer(secretKey: string, customerId: string): Promise<{ id: string; email: string | null; name: string | null } | null> {
  if (!customerId) return null;
  const s = stripeFor(secretKey);
  try {
    const c = await s.customers.retrieve(customerId);
    if ("deleted" in c && c.deleted) return null;
    const cust = c as Stripe.Customer;
    return { id: cust.id, email: cust.email ?? null, name: cust.name ?? null };
  } catch { return null; }
}

// ─── Test the API key (used by /connect form to validate before save) ───
export async function testStripeKey(secretKey: string): Promise<{ ok: true; account: { id: string; livemode: boolean; label: string } } | { ok: false; error: string }> {
  try {
    const account = await fetchStripeAccount(secretKey);
    return { ok: true, account };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────
function sumBalance(items: { amount: number; currency: string }[]): number {
  return items.reduce((sum, i) => sum + (i.amount ?? 0), 0);
}

function monthlyAmount(unitAmount: number, interval: Stripe.Price.Recurring.Interval, intervalCount: number): number {
  const monthsPerCycle = (() => {
    switch (interval) {
      case "day":   return intervalCount / 30;
      case "week":  return intervalCount / 4.33;
      case "month": return intervalCount;
      case "year":  return intervalCount * 12;
      default:      return intervalCount;
    }
  })();
  return Math.round(unitAmount / monthsPerCycle);
}

// Auto-paginating list helper for Stripe resources.
// We accept a duck-typed `list` method because Stripe's resource types are
// many but all share the same list shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function listAll<T>(resource: { list: (p: any) => Promise<{ data: T[]; has_more: boolean }> }, params: Record<string, unknown>, cap: number): Promise<T[]> {
  const out: T[] = [];
  let lastId: string | undefined = undefined;
  while (out.length < cap) {
    const p = lastId ? { ...params, starting_after: lastId } : params;
    const page = await resource.list(p);
    out.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    const last = page.data[page.data.length - 1] as unknown as { id?: string };
    if (!last?.id) break;
    lastId = last.id;
  }
  return out.slice(0, cap);
}
