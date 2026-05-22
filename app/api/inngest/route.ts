import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { stewardScheduled } from "@/lib/inngest/functions/steward-scheduled";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [stewardScheduled],
});
