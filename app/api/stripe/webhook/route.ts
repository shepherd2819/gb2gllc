import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { stripeFor } from "@/lib/nora/stripe";
import { processStripeEvent } from "@/lib/nora/orchestrate";
import { getNoraSecrets } from "@/lib/nora/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/stripe/webhook
// Stripe pushes events here. Signature is verified against the webhook
// secret stored in Vercel env (NORA_STRIPE_WEBHOOK_SECRET) — NEVER in DB.
export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing stripe-signature" }, { status: 400 });

  const secrets = getNoraSecrets();
  if (!secrets.ok) {
    return NextResponse.json({ error: `Nora not configured: missing ${secrets.missing.join(", ")}` }, { status: 503 });
  }

  // Raw body REQUIRED for signature verification.
  const rawBody = await req.text();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;
  try {
    const s = stripeFor(secrets.stripeSecretKey);
    event = s.webhooks.constructEvent(rawBody, sig, secrets.stripeWebhookSecret);
  } catch (err) {
    return NextResponse.json({ error: `signature verification failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 400 });
  }

  // Find the (single) active Nora account row that owns this Stripe event.
  const { data: account } = await supabaseAdmin
    .from("nora_accounts")
    .select("id")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!account) {
    // Webhook arrived before the admin initialized Nora. 2xx so Stripe
    // doesn't retry indefinitely — we'll backfill from the nightly poll.
    return NextResponse.json({ ok: false, error: "no active Nora account configured" }, { status: 200 });
  }

  const result = await processStripeEvent(account.id, event);
  if (!result.ok) {
    console.error("[stripe webhook] processing failed", result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, event_id: result.event_id, created: result.created });
}
