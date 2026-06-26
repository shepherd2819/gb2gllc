// Inngest event names + payloads for the onboarding provisioning pipeline.
// The Vera sign route and the Stripe webhook emit these instead of doing work
// inline; the lib/inngest/functions/onboarding-* functions consume them.

export const ONBOARDING_EVENTS = {
  CONTRACT_SIGNED: "onboarding/contract.signed",
  INVOICE_PAID: "onboarding/invoice.paid",
  PROVISIONED: "onboarding/client.provisioned",
} as const;

export type ContractSignedPayload = {
  clientId: string;
  contractId: string;
  product: string;
  amountCents: number;
  cadence: string;
};

export type InvoicePaidPayload = {
  clientId: string;
  stripeInvoiceId: string;
  contractId?: string;
};

export type ProvisionedPayload = {
  clientId: string;
  journeyId: string;
};
