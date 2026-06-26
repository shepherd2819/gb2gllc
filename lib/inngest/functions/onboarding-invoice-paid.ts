// onboarding/invoice.paid → mark the payment milestone, activate the product,
// and advance the journey to 'activated'. Emitted by the Stripe webhook on
// invoice.payment_succeeded (matched to a contract via stripe_invoice_id).

import { inngest } from "@/lib/inngest/client";
import { logEvent } from "@/lib/logger";
import { ONBOARDING_EVENTS, type InvoicePaidPayload } from "@/lib/onboarding/events";
import { completeMilestone, recomputeStage } from "@/lib/onboarding/store";
import { activateProduct } from "@/lib/onboarding/provision";

export const onboardingInvoicePaid = inngest.createFunction(
  {
    id: "onboarding-invoice-paid",
    name: "Onboard: invoice paid",
    concurrency: [{ key: "event.data.clientId", limit: 1 }],
    triggers: [{ event: ONBOARDING_EVENTS.INVOICE_PAID }],
  },
  async ({ event, step }) => {
    const data = event.data as InvoicePaidPayload;

    const product = await step.run("resolve-product", async () => {
      const { supabaseAdmin } = await import("@/lib/supabase");
      const { data: contract } = data.contractId
        ? await supabaseAdmin.from("contracts").select("product").eq("id", data.contractId).maybeSingle<{ product: string }>()
        : await supabaseAdmin.from("contracts").select("product").eq("stripe_invoice_id", data.stripeInvoiceId).maybeSingle<{ product: string }>();
      return contract?.product ?? null;
    });

    await step.run("activate", async () => {
      await completeMilestone(data.clientId, "pay_invoice", "system");
      if (product) await activateProduct(data.clientId, product);
      await recomputeStage(data.clientId, "activated");
    });

    await step.run("log", () =>
      logEvent({
        clientId: data.clientId,
        category: "onboarding",
        message: "invoice paid → product activated, journey advanced",
        metadata: { product, stripeInvoiceId: data.stripeInvoiceId },
      }),
    );

    return { ok: true, product };
  },
);
