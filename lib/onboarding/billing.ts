// Auto-create the first Stripe invoice for a signed contract (zero-touch billing).
// Uses the platform Stripe client (lib/stripe.ts) — lazy-imported so a missing
// STRIPE_SECRET_KEY doesn't break module load in tests. Returns the Stripe
// invoice id to store on contracts.stripe_invoice_id (the payment→provision link).
//
// v1: sends a single finalized invoice (collection_method 'send_invoice', Net-15).
// Recurring 'monthly' cadence still bills the first invoice here; converting that
// to a Stripe Subscription is a later enhancement.

export async function createInvoiceForContract(opts: {
  clientId: string;
  email: string;
  name: string | null;
  company: string | null;
  amountCents: number;
  cadence: string;
  product: string;
}): Promise<string | null> {
  const { stripe, getOrCreateStripeCustomer } = await import("@/lib/stripe");
  const customerId = await getOrCreateStripeCustomer(opts.clientId, opts.email, opts.name, opts.company);

  await stripe.invoiceItems.create({
    customer: customerId,
    amount: opts.amountCents,
    currency: "usd",
    description: `GB2G ${opts.product} — ${opts.cadence}`,
  });

  const invoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: "send_invoice",
    days_until_due: 15,
    auto_advance: true,
    metadata: { gb2g_client_id: opts.clientId, gb2g_source: "onboarding" },
  });
  if (!invoice.id) return null;

  await stripe.invoices.finalizeInvoice(invoice.id);
  await stripe.invoices.sendInvoice(invoice.id);
  return invoice.id;
}
