// lib/devagent/smoke.ts
//
// Manual smoke test. Off unless ADA_SMOKE=1 is set in the environment.
// Runs one cheap task and prints the result. Costs Anthropic + a tiny PR.

import { prepareWorkspace } from "./workspace";
import { runDevAgent } from "./run";

if (process.env.ADA_SMOKE !== "1") {
  console.error("ADA_SMOKE is not set to 1; refusing to run smoke test.");
  process.exit(0);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }

  const ws = await prepareWorkspace({
    repoRoot: process.cwd(),
    description: "Add a one-line code comment to lib/devagent/README.md noting Ada said hi",
  });
  try {
    const result = await runDevAgent({
      task: {
        description:
          "In lib/devagent/README.md, append a single line at the very bottom: '<!-- ada-smoke: hello -->'. No other changes.",
      },
      workspace: ws,
    });
    console.log("Smoke status:", result.status);
    process.exit(result.status === "completed" ? 0 : 2);
  } finally {
    await ws.cleanup();
  }
}

main().catch((e) => {
  console.error(`smoke failed: ${(e as Error).message}`);
  process.exit(1);
});
