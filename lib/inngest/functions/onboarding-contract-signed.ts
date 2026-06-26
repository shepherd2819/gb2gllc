// onboarding/contract.signed → seed the journey, send the portal invite, and
// auto-create the first Stripe invoice. Emitted by the Vera sign route's after().
// Concurrency 1/client so re-delivery can't double-invite or double-invoice;
// invoice creation is additionally guarded on contracts.stripe_invoice_id.

import { inngest } from "@/lib/inngest/client";
import { logEvent } from "@/lib/logger";
import { ONBOARDING_EVENTS, type ContractSignedPayload } from "@/lib/onboarding/events";
import { ensureJourney, completeMilestone } from "@/lib/onboarding/store";
import { sendPortalInvite } from "@/lib/onboarding/provision";
import { createInvoiceForContract } from "@/lib/onboarding/billing";
import type { OnboardingTier } from "@/lib/onboarding/types";

function tierFromAmount(cents: number): OnboardingTier {
  if (cents >= 2_500_000) return "white_glove"; // > $25k
  if (cents >= 500_000) return "assisted"; // $5k–$25k
  return "self_serve";
}

export const onboardingContractSigned = inngest.createFunction(
  {
    id: "onboarding-contract-signed",
    name: "Onboard: contract signed",
    concurrency: [{ key: "event.data.clientId", limit: 1 }],
    triggers: [{ event: ONBOARDING_EVENTS.CONTRACT_SIGNED }],
  },
  async ({ event, step }) => {
    const data = event.data as ContractSignedPayload;
    const tier = tierFromAmount(data.amountCents);

    await step.run("seed-journey", async () => {
      await ensureJourney(data.clientId, { product: data.product, tier });
      await completeMilestone(data.clientId, "sign_contract", "system");
    });

    await step.run("invite", async () => {
      const { supabaseAdmin } = await import("@/lib/supabase");
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("email")
        .eq("id", data.clientId)
        .maybeSingle<{ email: string | null }>();
      if (client?.email) await sendPortalInvite(client.email);
    });

    await step.run("invoice", async () => {
      const { supabaseAdmin } = await import("@/lib/supabase");
      const { data: contract } = await supabaseAdmin
        .from("contracts")
        .select("stripe_invoice_id, clients(email, name, company)")
        .eq("id", data.contractId)
        .maybeSingle<{ stripe_invoice_id: string | null; clients: { email: string; name: string | null; company: string | null } | null }>();
      if (!contract || contract.stripe_invoice_id) return; // already invoiced — idempotent
      const client = contract.clients;
      if (!client?.email) return;
      const invoiceId = await createInvoiceForContract({
        clientId: data.clientId,
        email: client.email,
        name: client.name,
        company: client.company,
        amountCents: data.amountCents,
        cadence: data.cadence,
        product: data.product,
      });
      if (invoiceId) {
        await supabaseAdmin.from("contracts").update({ stripe_invoice_id: invoiceId }).eq("id", data.contractId);
      }
    });

    await step.run("log", () =>
      logEvent({
        clientId: data.clientId,
        category: "onboarding",
        message: "contract signed → journey seeded, invite sent, invoice issued",
        metadata: { contractId: data.contractId, tier, product: data.product },
      }),
    );

    return { ok: true, tier };
  },
);
