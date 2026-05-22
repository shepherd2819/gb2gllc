import { inngest } from "@/lib/inngest/client";
import { supabaseAdmin } from "@/lib/supabase";
import { runStewardAgent } from "@/lib/steward/run-agent";

// Runs daily at 9am ET. Each active assignment with a schedule gets its own
// durable step — if one fails, others continue and the failed step can be retried.
export const stewardScheduled = inngest.createFunction(
  {
    id: "steward-scheduled-runs",
    name: "Steward: daily scheduled runs",
    triggers: [{ cron: "TZ=America/New_York 0 9 * * *" }],
  },
  async ({ step }) => {
    const assignments = await step.run("fetch-scheduled-assignments", async () => {
      const { data } = await supabaseAdmin
        .from("client_steward_assignments")
        .select("id, client_id, platform_agent_id, mission")
        .eq("active", true)
        .not("schedule", "is", null);
      return data ?? [];
    });

    const results = await Promise.allSettled(
      assignments.map(a =>
        step.run(`run-${a.id}`, () =>
          runStewardAgent({ assignmentId: a.id, trigger: "scheduled" })
        )
      )
    );

    const summary = {
      total: assignments.length,
      completed: results.filter(r => r.status === "fulfilled").length,
      failed: results.filter(r => r.status === "rejected").length,
    };

    return summary;
  }
);
