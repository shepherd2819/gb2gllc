import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { stewardScheduled } from "@/lib/inngest/functions/steward-scheduled";
import { devagentRun } from "@/lib/inngest/functions/devagent-run";
import { hollisCallCompleted } from "@/lib/inngest/functions/hollis-call-completed";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [stewardScheduled, devagentRun, hollisCallCompleted],
});
