// Weekly analytics digest — Mondays 9am ET. All the eligibility gating and
// send logic lives in lib/analytics/digest.ts; this function is a thin cron
// wrapper (lazy import keeps the serve route bundle light).

import { inngest } from "@/lib/inngest/client";

export const analyticsDigest = inngest.createFunction(
  {
    id: "analytics-digest",
    name: "Analytics: weekly digest emails",
    triggers: [{ cron: "TZ=America/New_York 0 9 * * 1" }],
  },
  async ({ step }) => {
    const results = await step.run("send-digests", async () => {
      const { sendAnalyticsDigestForAllActiveClients } = await import("@/lib/analytics/digest");
      return sendAnalyticsDigestForAllActiveClients();
    });
    return {
      total: results.length,
      sent: results.filter((r) => r.status === "sent").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "failed").length,
    };
  },
);
