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
        // Best-effort prune to clear the stale registration. Ignore failures.
        await exec("git", ["worktree", "prune"], { cwd: opts.repoRoot }).catch(() => {});
      }
    },
  };
}

/** Parse `git diff --numstat` output. Exported for unit testing. */
export function parseNumstat(stdout: string): FileChange[] {
  const lines = stdout.trim().split("\n").filter(Boolean);
  return lines.map((line) => {
    const tab1 = line.indexOf("\t");
    const tab2 = line.indexOf("\t", tab1 + 1);
    // Defensive: malformed line falls through with zeros and the raw line as path.
    if (tab1 < 0 || tab2 < 0) {
      return { path: line, added: 0, deleted: 0 };
    }
    const addedStr = line.slice(0, tab1);
    const deletedStr = line.slice(tab1 + 1, tab2);
    const path = line.slice(tab2 + 1); // rest of line, tabs preserved
    return {
      path,
      added: addedStr === "-" ? 0 : parseInt(addedStr, 10) || 0,
      deleted: deletedStr === "-" ? 0 : parseInt(deletedStr, 10) || 0,
    };
  });
}

/** Return a list of FileChange entries from `git diff --numstat main...HEAD`. */
export async function captureDiff(
  cwd: string
): Promise<{ changes: FileChange[]; packageJsonChanged: boolean }> {
  const { stdout } = await exec("git", ["diff", "--numstat", "main...HEAD"], { cwd });
  const changes = parseNumstat(stdout);
  // Top-level package.json only; nested package.json files (e.g. fixtures) are intentionally ignored.
  const packageJsonChanged = changes.some((c) => c.path === "package.json");
  return { changes, packageJsonChanged };
}
