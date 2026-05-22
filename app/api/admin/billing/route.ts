import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { stripe, getOrCreateStripeCustomer } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  const { clientId, description, amountDollars } = await req.json();

  const { data: client } = await supabaseAdmin
    .from("clients").select("id, name, email, company, stripe_customer_id").eq("id", clientId).single();

  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const amountCents = Math.round(amountDollars * 100);
  if (amountCents < 100) return NextResponse.json({ error: "Minimum $1.00" }, { status: 400 });

  const customerId = await getOrCreateStripeCustomer(clientId, client.email, client.name, client.company);

  // Create and finalize invoice
  const invoice = await stripe.invoices.create({
    customer: customerId,
    auto_advance: true,
    collection_method: "send_invoice",
    days_until_due: 14,
    description: description || undefined,
  });

  await stripe.invoiceItems.create({
    customer: customerId,
    invoice: invoice.id,
    amount: amountCents,
    currency: "usd",
    description: description || "GB2G Services",
  });

  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  await stripe.invoices.sendInvoice(finalized.id);

  // Record in DB
  await supabaseAdmin.from("invoices").insert({
    client_id: clientId,
    stripe_invoice_id: finalized.id,
    amount_cents: amountCents,
    description: description || null,
    status: "sent",
    sent_at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true, invoiceId: finalized.id, invoiceUrl: finalized.hosted_invoice_url });
}
