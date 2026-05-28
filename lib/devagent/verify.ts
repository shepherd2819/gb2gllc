// lib/devagent/verify.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { VerifyResult, VerifyStep } from "./types";

const exec = promisify(execFile);

async function readScripts(cwd: string): Promise<Record<string, string>> {
  const raw = await readFile(path.join(cwd, "package.json"), "utf8");
  const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
  return pkg.scripts ?? {};
}

async function runStep(
  name: VerifyStep["name"],
  cmd: string,
  args: string[],
  cwd: string
): Promise<VerifyStep> {
  const start = Date.now();
  try {
    const { stdout, stderr } = await exec(cmd, args, { cwd, maxBuffer: 50 * 1024 * 1024 });
    return {
      name,
      command: [cmd, ...args].join(" "),
      exitCode: 0,
      durationMs: Date.now() - start,
      stdoutTail: stdout.slice(-2000),
      stderrTail: stderr.slice(-2000),
    };
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string; stderr?: string };
    const exitCode = typeof err.code === "number" ? err.code : 1;
    return {
      name,
      command: [cmd, ...args].join(" "),
      exitCode,
      durationMs: Date.now() - start,
      stdoutTail: (err.stdout ?? "").slice(-2000),
      stderrTail: (err.stderr ?? "").slice(-2000),
    };
  }
}

export async function verify(cwd: string): Promise<VerifyResult> {
  const scripts = await readScripts(cwd);
  const steps: VerifyStep[] = [];

  // Typecheck: prefer the `typecheck` script if defined.
  steps.push(
    scripts.typecheck
      ? await runStep("typecheck", "npm", ["run", "typecheck"], cwd)
      : await runStep("typecheck", "npx", ["tsc", "--noEmit"], cwd)
  );

  // Build: prefer `npm run build`.
  steps.push(
    scripts.build
      ? await runStep("build", "npm", ["run", "build"], cwd)
      : await runStep("build", "npx", ["next", "build"], cwd)
  );

  if (scripts.lint) steps.push(await runStep("lint", "npm", ["run", "lint"], cwd));
  if (scripts.test) steps.push(await runStep("test", "npm", ["run", "test"], cwd));

  return { ok: steps.every((s) => s.exitCode === 0), steps };
}
