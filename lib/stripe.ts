import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-04-22.dahlia",
});

export async function getOrCreateStripeCustomer(clientId: string, email: string, name: string | null, company: string | null) {
  const { supabaseAdmin } = await import("./supabase");

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("stripe_customer_id")
    .eq("id", clientId)
    .single();

  if (client?.stripe_customer_id) return client.stripe_customer_id as string;

  const customer = await stripe.customers.create({
    email,
    name: company || name || email,
    metadata: { gb2g_client_id: clientId },
  });

  await supabaseAdmin
    .from("clients")
    .update({ stripe_customer_id: customer.id })
    .eq("id", clientId);

  return customer.id;
}
