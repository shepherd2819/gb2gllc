import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { stewardScheduled } from "@/lib/inngest/functions/steward-scheduled";
import { devagentRun } from "@/lib/inngest/functions/devagent-run";
import { hollisCallCompleted } from "@/lib/inngest/functions/hollis-call-completed";
import { onboardingContractSigned } from "@/lib/inngest/functions/onboarding-contract-signed";
import { onboardingInvoicePaid } from "@/lib/inngest/functions/onboarding-invoice-paid";
import { analyticsSync } from "@/lib/inngest/functions/analytics-sync";
import { analyticsDigest } from "@/lib/inngest/functions/analytics-digest";
import { hubspotOrderSync } from "@/lib/inngest/functions/hubspot-order-sync";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [stewardScheduled, devagentRun, hollisCallCompleted, onboardingContractSigned, onboardingInvoicePaid, analyticsSync, analyticsDigest, hubspotOrderSync],
});
