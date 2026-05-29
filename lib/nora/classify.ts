import type Stripe from "stripe";

// Map a raw Stripe event into a Nora classification: category, severity,
// dollar amount, customer info, and a one-line human summary.
//
// No LLM — this is deterministic. The dunning *email* is drafted by a
// separate Sonnet pass (lib/nora/dunning.ts) only for select categories.

export type EventCategory =
  | "payment_failed"
  | "subscription_canceled"
  | "subscription_past_due"
  | "charge_disputed"
  | "charge_refunded"
  | "payout_failed"
  | "invoice_upcoming"
  | "new_subscription"
  | "other";

export type Severity = "critical" | "warn" | "info";

export type Classified = {
  category: EventCategory;
  severity: Severity;
  summary: string;
  stripe_object_id: string | null;
  stripe_customer_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  should_draft_dunning: boolean;
};

// These are the categories Nora drafts a dunning email for. Everything else
// is purely informational — admin sees it in the dashboard / inbox alert
// but no draft is auto-written.
const DUNNING_CATEGORIES = new Set<EventCategory>(["payment_failed", "subscription_past_due"]);

export function classifyStripeEvent(ev: Stripe.Event): Classified {
  // ev.data.object is a Stripe-typed union; we'll narrow per case below.
  const obj = ev.data.object as unknown as Record<string, unknown>;

  switch (ev.type) {
    case "invoice.payment_failed": {
      const inv = obj as unknown as Stripe.Invoice;
      const amt = inv.amount_due ?? inv.total ?? 0;
      const attempt = inv.attempt_count ?? 1;
      return {
        category: "payment_failed",
        severity: "critical",
        summary: `Payment failed: ${money(amt, inv.currency)} from ${inv.customer_email ?? inv.customer ?? "customer"} (attempt ${attempt})`,
        stripe_object_id: inv.id,
        stripe_customer_id: typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null,
        amount_cents: amt,
        currency: inv.currency ?? null,
        should_draft_dunning: true,
      };
    }
    case "charge.failed": {
      const ch = obj as unknown as Stripe.Charge;
      return {
        category: "payment_failed",
        severity: "warn",
        summary: `Charge failed: ${money(ch.amount, ch.currency)} (${ch.failure_message ?? ch.failure_code ?? "no reason"})`,
        stripe_object_id: ch.id,
        stripe_customer_id: typeof ch.customer === "string" ? ch.customer : ch.customer?.id ?? null,
        amount_cents: ch.amount,
        currency: ch.currency,
        should_draft_dunning: false,        // we wait for invoice.payment_failed for billed customers
      };
    }
    case "customer.subscription.deleted": {
      const sub = obj as unknown as Stripe.Subscription;
      const monthly = subscriptionMonthlyApprox(sub);
      return {
        category: "subscription_canceled",
        severity: "warn",
        summary: `Subscription canceled: ${money(monthly, sub.currency)}/mo${sub.cancellation_details?.reason ? ` — reason: ${sub.cancellation_details.reason}` : ""}`,
        stripe_object_id: sub.id,
        stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
        amount_cents: monthly,
        currency: sub.currency,
        should_draft_dunning: false,
      };
    }
    case "customer.subscription.updated": {
      const sub = obj as unknown as Stripe.Subscription;
      if (sub.status === "past_due") {
        const monthly = subscriptionMonthlyApprox(sub);
        return {
          category: "subscription_past_due",
          severity: "warn",
          summary: `Subscription past due: ${money(monthly, sub.currency)}/mo`,
          stripe_object_id: sub.id,
          stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
          amount_cents: monthly,
          currency: sub.currency,
          should_draft_dunning: true,
        };
      }
      // Other subscription updates aren't actionable; surface as "other"
      return otherEvent(ev, obj);
    }
    case "charge.dispute.created": {
      const dis = obj as unknown as Stripe.Dispute;
      return {
        category: "charge_disputed",
        severity: "critical",
        summary: `Dispute opened: ${money(dis.amount, dis.currency)} — reason: ${dis.reason ?? "unknown"}`,
        stripe_object_id: dis.id,
        stripe_customer_id: null,
        amount_cents: dis.amount,
        currency: dis.currency,
        should_draft_dunning: false,
      };
    }
    case "charge.refunded":
    case "charge.refund.updated": {
      const ch = obj as unknown as Stripe.Charge;
      return {
        category: "charge_refunded",
        severity: "info",
        summary: `Refund issued: ${money(ch.amount_refunded ?? ch.amount, ch.currency)}`,
        stripe_object_id: ch.id,
        stripe_customer_id: typeof ch.customer === "string" ? ch.customer : ch.customer?.id ?? null,
        amount_cents: ch.amount_refunded ?? ch.amount,
        currency: ch.currency,
        should_draft_dunning: false,
      };
    }
    case "payout.failed": {
      const po = obj as unknown as Stripe.Payout;
      return {
        category: "payout_failed",
        severity: "critical",
        summary: `Payout to bank failed: ${money(po.amount, po.currency)} — ${po.failure_message ?? po.failure_code ?? "no reason"}`,
        stripe_object_id: po.id,
        stripe_customer_id: null,
        amount_cents: po.amount,
        currency: po.currency,
        should_draft_dunning: false,
      };
    }
    case "invoice.upcoming": {
      const inv = obj as unknown as Stripe.Invoice;
      return {
        category: "invoice_upcoming",
        severity: "info",
        summary: `Invoice upcoming: ${money(inv.amount_due ?? inv.total ?? 0, inv.currency)} to ${inv.customer_email ?? "customer"}`,
        stripe_object_id: inv.id ?? null,
        stripe_customer_id: typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null,
        amount_cents: inv.amount_due ?? inv.total ?? 0,
        currency: inv.currency,
        should_draft_dunning: false,
      };
    }
    case "customer.subscription.created": {
      const sub = obj as unknown as Stripe.Subscription;
      const monthly = subscriptionMonthlyApprox(sub);
      return {
        category: "new_subscription",
        severity: "info",
        summary: `New subscription: ${money(monthly, sub.currency)}/mo`,
        stripe_object_id: sub.id,
        stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
        amount_cents: monthly,
        currency: sub.currency,
        should_draft_dunning: false,
      };
    }
    default:
      return otherEvent(ev, obj);
  }
}

function otherEvent(ev: Stripe.Event, obj: Record<string, unknown>): Classified {
  const customerField = obj.customer;
  return {
    category: "other",
    severity: "info",
    summary: `${ev.type}`,
    stripe_object_id: (obj.id as string | undefined) ?? null,
    stripe_customer_id: typeof customerField === "string" ? customerField : null,
    amount_cents: typeof obj.amount === "number" ? obj.amount as number : null,
    currency: typeof obj.currency === "string" ? obj.currency as string : null,
    should_draft_dunning: false,
  };
}

export function isDunningCategory(c: EventCategory): boolean {
  return DUNNING_CATEGORIES.has(c);
}

// ─── Helpers ────────────────────────────────────────────────────────────
function money(cents: number, currency?: string | null): string {
  const c = (currency ?? "usd").toUpperCase();
  const sym = c === "USD" ? "$" : c === "EUR" ? "€" : c === "GBP" ? "£" : "";
  const amt = Math.abs(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? "-" : ""}${sym}${amt}${sym ? "" : ` ${c}`}`;
}

function subscriptionMonthlyApprox(sub: Stripe.Subscription): number {
  let total = 0;
  for (const item of sub.items?.data ?? []) {
    const price = item.price;
    if (!price || !price.unit_amount || !price.recurring) continue;
    const itemTotal = price.unit_amount * (item.quantity ?? 1);
    const months = (() => {
      const ic = price.recurring.interval_count ?? 1;
      switch (price.recurring.interval) {
        case "day":   return ic / 30;
        case "week":  return ic / 4.33;
        case "month": return ic;
        case "year":  return ic * 12;
        default:      return ic;
      }
    })();
    total += Math.round(itemTotal / months);
  }
  return total;
}
