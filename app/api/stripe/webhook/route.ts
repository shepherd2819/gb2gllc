import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { stripeFor } from "@/lib/nora/stripe";
import { processStripeEvent } from "@/lib/nora/orchestrate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/stripe/webhook
// Stripe pushes events here. We verify the signature against each connected
// Nora account's webhook secret (since multiple accounts may share this URL).
// First matching secret wins; if none match we 400.
export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing stripe-signature" }, { status: 400 });

  // Raw body REQUIRED for signature verification.
  const rawBody = await req.text();

  // Find every active account with a webhook secret. Usually 1.
  const { data: accounts } = await supabaseAdmin
    .from("nora_accounts")
    .select("id, stripe_secret_key, stripe_webhook_secret")
    .eq("status", "active")
    .not("stripe_webhook_secret", "is", null);

  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ error: "no configured Nora accounts" }, { status: 503 });
  }

  // Try each account's secret until one verifies. The Stripe SDK throws on
  // failure; we swallow per-secret and only return 400 if all fail.
  let matched: { id: string; stripe_secret_key: string } | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any = null;
  for (const acct of accounts) {
    try {
      const s = stripeFor(acct.stripe_secret_key);
      event = s.webhooks.constructEvent(rawBody, sig, acct.stripe_webhook_secret!);
      matched = { id: acct.id, stripe_secret_key: acct.stripe_secret_key };
      break;
    } catch {
      // try next
    }
  }

  if (!matched || !event) {
    return NextResponse.json({ error: "signature verification failed" }, { status: 400 });
  }

  const result = await processStripeEvent(matched.id, event);
  if (!result.ok) {
    // Stripe will retry on non-2xx; only 200 if we actually persisted.
    console.error("[stripe webhook] processing failed", result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, event_id: result.event_id, created: result.created });
}
