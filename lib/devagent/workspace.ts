// lib/devagent/workspace.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { FileChange, Workspace } from "./types";

const exec = promisify(execFile);

/** Derive a stable URL-safe slug from a task description + timestamp. */
export function makeSlug(description: string, now: Date = new Date()): string {
  const iso = now.toISOString();
  const stamp = iso.slice(0, 10) + "-" + iso.slice(11, 16).replace(":", "");
  const safe = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `${stamp}-${safe || "task"}`;
}

export type PrepareWorkspaceOpts = {
  /** Absolute path of the repo's main checkout. */
  repoRoot: string;
  /** Task description; used to derive a slug. */
  description: string;
  /** Where to place sibling worktrees. Defaults to `<repoRoot>/../devagent-runs`. */
  siblingDir?: string;
};

export async function prepareWorkspace(opts: PrepareWorkspaceOpts): Promise<Workspace> {
  const slug = makeSlug(opts.description);
  const branch = `devagent/${slug}`;
  const baseDir = opts.siblingDir ?? path.resolve(opts.repoRoot, "../devagent-runs");
  const cwd = path.resolve(baseDir, slug);

  await mkdir(baseDir, { recursive: true });
  await exec("git", ["worktree", "add", cwd, "-b", branch, "main"], { cwd: opts.repoRoot });

  return {
    cwd,
    branch,
    slug,
    cleanup: async () => {
      try {
        await exec("git", ["worktree", "remove", cwd, "--force"], { cwd: opts.repoRoot });
      } catch {
        // Worktree command may fail if dir was already removed; clean up the path either way.
        await rm(cwd, { recursive: true, force: true });
      }
    },
  };
}

/** Return a list of FileChange entries from `git diff --numstat main...HEAD`. */
export async function captureDiff(
  cwd: string
): Promise<{ changes: FileChange[]; packageJsonChanged: boolean }> {
  const { stdout } = await exec("git", ["diff", "--numstat", "main...HEAD"], { cwd });
  const lines = stdout.trim().split("\n").filter(Boolean);
  const changes: FileChange[] = lines.map((line) => {
    const [addedStr, deletedStr, p] = line.split("\t");
    return {
      path: p,
      added: addedStr === "-" ? 0 : parseInt(addedStr, 10) || 0,
      deleted: deletedStr === "-" ? 0 : parseInt(deletedStr, 10) || 0,
    };
  });
  const packageJsonChanged = changes.some((c) => c.path === "package.json");
  return { changes, packageJsonChanged };
}
