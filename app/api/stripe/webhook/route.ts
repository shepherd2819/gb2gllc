import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { stripeFor } from "@/lib/nora/stripe";
import { processStripeEvent } from "@/lib/nora/orchestrate";
import { getNoraSecrets } from "@/lib/nora/env";
import { inngest } from "@/lib/inngest/client";
import { ONBOARDING_EVENTS } from "@/lib/onboarding/events";

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

  // Onboarding hook: when an onboarding-issued invoice is paid, fire the
  // provisioning pipeline. Matched to a contract via stripe_invoice_id; never
  // disturbs Nora's AR handling below.
  if (event.type === "invoice.payment_succeeded") {
    try {
      const inv = event.data.object as { id?: string };
      if (inv.id) {
        const { data: contract } = await supabaseAdmin
          .from("contracts")
          .select("id, client_id")
          .eq("stripe_invoice_id", inv.id)
          .maybeSingle<{ id: string; client_id: string }>();
        if (contract?.client_id) {
          await inngest.send({
            name: ONBOARDING_EVENTS.INVOICE_PAID,
            data: { clientId: contract.client_id, stripeInvoiceId: inv.id, contractId: contract.id },
          });
        }
      }
    } catch (err) {
      console.error("[stripe webhook] onboarding invoice.paid emit failed:", err instanceof Error ? err.message : err);
    }
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
