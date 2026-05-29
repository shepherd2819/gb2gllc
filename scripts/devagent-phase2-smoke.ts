// scripts/devagent-phase2-smoke.ts
//
// Manual smoke test for Phase 2. Off unless ADA_PHASE2_SMOKE=1 is set in env.
// Emits a manual-trigger devagent/run.requested event into Inngest and prints
// the event id. Operator then watches Inngest's local dev UI to see the run
// progress and confirms the sandbox + PR pipeline.
//
// Costs Anthropic tokens + a small Vercel Sandbox. Not in CI.

import { enqueueManualRun } from "@/lib/devagent/platform/enqueue";

if (process.env.ADA_PHASE2_SMOKE !== "1") {
  console.error("ADA_PHASE2_SMOKE is not set to 1; refusing to run smoke test.");
  process.exit(0);
}

async function main() {
  const clientId = process.env.ADA_PHASE2_SMOKE_CLIENT_ID;
  if (!clientId) {
    console.error("Set ADA_PHASE2_SMOKE_CLIENT_ID to a clients.id you control before running.");
    process.exit(1);
  }
  const taskText =
    process.env.ADA_PHASE2_SMOKE_TASK ??
    "In lib/devagent/README.md, append one line at the very bottom: '<!-- ada-phase2-smoke: hello -->'. No other changes.";

  const { eventId } = await enqueueManualRun({ clientId, taskText });
  console.log(`Smoke event sent. Inngest event id: ${eventId}`);
  console.log("Watch progress at http://localhost:8288 (Inngest dev) or Inngest cloud UI.");
}

main().catch((e) => {
  console.error(`smoke failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
