// scripts/devagent.ts
import { writeFile } from "node:fs/promises";
import { prepareWorkspace } from "../lib/devagent/workspace";
import { runDevAgent } from "../lib/devagent/run";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.some((a) => a === "-h" || a === "--help")) {
    console.error(`Usage: npm run devagent -- "<task description>"\n`);
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to .env or export it before running.");
    process.exit(1);
  }

  const description = args.join(" ");
  const repoRoot = process.cwd();
  const ws = await prepareWorkspace({ repoRoot, description });
  console.log(`Workspace: ${ws.cwd}\nBranch:    ${ws.branch}\n`);

  try {
    const missionOverride =
      typeof process.env.ADA_MISSION_OVERRIDE === "string" && process.env.ADA_MISSION_OVERRIDE.length > 0
        ? process.env.ADA_MISSION_OVERRIDE
        : undefined;

    let budgetOverride: import("@/lib/devagent/types").GuardrailsConfig["budget"] | undefined;
    const budgetJson = process.env.ADA_BUDGET_OVERRIDE_JSON;
    if (budgetJson) {
      try {
        budgetOverride = JSON.parse(budgetJson);
      } catch (e) {
        console.error(`ignoring malformed ADA_BUDGET_OVERRIDE_JSON: ${(e as Error).message}`);
      }
    }

    const result = await runDevAgent({
      task: { description },
      workspace: ws,
      ...(missionOverride !== undefined ? { mission: missionOverride } : {}),
      ...(budgetOverride !== undefined ? { guardrails: { budget: budgetOverride } } : {}),
    });
    const resultFile = process.env.ADA_RESULT_FILE;
    if (resultFile) {
      try {
        await writeFile(resultFile, JSON.stringify(result, null, 2), "utf8");
      } catch (e) {
        console.error(`failed to write ADA_RESULT_FILE: ${(e as Error).message}`);
      }
    }
    process.exit(result.status === "completed" ? 0 : 2);
  } finally {
    await ws.cleanup();
  }
}

main().catch((e) => {
  console.error(`devagent failed: ${(e as Error).message}`);
  process.exit(1);
});
