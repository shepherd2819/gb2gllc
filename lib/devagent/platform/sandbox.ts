// lib/devagent/platform/sandbox.ts
//
// Provision a Vercel Sandbox, clone the GB2G repo, run Ada's CLI (Phase 1),
// and read back the structured RunResult written via ADA_RESULT_FILE.
//
// SDK verified against @vercel/sandbox@2.0.1 dist/sandbox.d.ts:
//   - Sandbox.create({ timeout, env })            ✓ confirmed
//   - sandbox.runCommand({ cmd, args, cwd })       ✓ object form required for cwd
//   - sandbox.readFileToBuffer({ path })           ✓ returns Buffer|null; readFile() returns ReadableStream
//   - CommandFinished.exitCode                     ✓ number (not null) on finished commands
//   - CommandFinished.stdout() / stderr()          ✓ async methods, not plain properties
//   - sandbox.stop()                               ✓ confirmed

import { Sandbox } from "@vercel/sandbox";
import type { RunResult } from "@/lib/devagent/types";

const REPO_URL =
  process.env.GB2G_REPO_URL ?? "https://github.com/shepherd2819/gb2gllc.git";
const SANDBOX_REPO_PATH = "/vercel/sandbox/repo";
const SANDBOX_RESULT_PATH = "/vercel/sandbox/.devagent-result.json";

export type SandboxRunOutcome = {
  /** Exit code of `npm run devagent -- "..."` inside the sandbox. */
  exitCode: number;
  /** Structured run result, or null if the CLI crashed before writing it. */
  result: RunResult | null;
  /** Last ~4 KB of CLI stdout (for audit). */
  stdoutTail: string;
  /** Last ~4 KB of CLI stderr. */
  stderrTail: string;
};

export type RunInSandboxArgs = {
  taskDescription: string;
  /** Per-client mission override from client_devagent_assignments.mission. */
  missionOverride?: string;
  /** JSON-stringified Partial<GuardrailsConfig["budget"]>. */
  budgetOverrideJson?: string;
};

export async function runInSandbox(
  args: RunInSandboxArgs
): Promise<SandboxRunOutcome> {
  const sandbox = await Sandbox.create({
    timeout: 30 * 60_000,
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
      GH_TOKEN: process.env.GH_TOKEN ?? "",
      ADA_RESULT_FILE: SANDBOX_RESULT_PATH,
      ...(args.missionOverride    !== undefined ? { ADA_MISSION_OVERRIDE:     args.missionOverride }    : {}),
      ...(args.budgetOverrideJson !== undefined ? { ADA_BUDGET_OVERRIDE_JSON: args.budgetOverrideJson } : {}),
    },
  });

  try {
    // Install gh CLI — Phase 1's ship.ts shells out to it for PR ops.
    // The @vercel/sandbox base image (Amazon Linux 2023) ships dnf.
    await sandbox.runCommand({
      cmd:  "dnf",
      args: ["install", "-y", "gh"],
      sudo: true,
    });

    // Configure git identity (git commit errors without this).
    await sandbox.runCommand({
      cmd:  "git",
      args: ["config", "--global", "user.email", "ada@gb2gllc.com"],
    });
    await sandbox.runCommand({
      cmd:  "git",
      args: ["config", "--global", "user.name", "Ada"],
    });

    // Authenticate git via GH_TOKEN so HTTPS pushes succeed.
    // gh auth setup-git reads GH_TOKEN from env (already passed in Sandbox.create)
    // and installs a credential helper in ~/.gitconfig.
    await sandbox.runCommand({
      cmd:  "gh",
      args: ["auth", "setup-git"],
    });

    // Clone the repo (no cwd needed; runs from default working dir).
    await sandbox.runCommand("git", ["clone", REPO_URL, SANDBOX_REPO_PATH]);

    // npm ci — pass cwd via object form (the only way to set cwd in v2).
    await sandbox.runCommand({ cmd: "npm", args: ["ci"], cwd: SANDBOX_REPO_PATH });

    // Run Ada's Phase 1 CLI with the task description.
    const cli = await sandbox.runCommand({
      cmd: "npm",
      args: ["run", "devagent", "--", args.taskDescription],
      cwd: SANDBOX_REPO_PATH,
    });

    // stdout/stderr are async methods, not properties (confirmed in command.d.ts).
    const [stdoutFull, stderrFull] = await Promise.all([
      cli.stdout(),
      cli.stderr(),
    ]);

    // Read back the result file; readFileToBuffer returns Buffer|null.
    let result: RunResult | null = null;
    try {
      const buf = await sandbox.readFileToBuffer({ path: SANDBOX_RESULT_PATH });
      if (buf !== null) {
        result = JSON.parse(buf.toString("utf8")) as RunResult;
      }
    } catch {
      // If the result file is missing or unparseable, leave result=null.
    }

    return {
      exitCode: cli.exitCode,
      result,
      stdoutTail: stdoutFull.slice(-4000),
      stderrTail: stderrFull.slice(-4000),
    };
  } finally {
    await sandbox.stop().catch(() => {});
  }
}
