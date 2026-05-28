# Ada (Dev-Agent Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 core of Ada — a code-writing agent for the GB2G repo, run from a CLI. Reusable library (`lib/devagent/`) + `scripts/devagent.ts` CLI, with two-gate guardrails and auto-merge of in-scope green PRs.

**Architecture:** A single orchestrator (`query()` from `@anthropic-ai/claude-agent-sdk`) drives five subagents declared via the `agents` option (scout / architect / coder / verifier / reviewer). Runs in a sibling git worktree on a `devagent/<slug>` branch. PreToolUse hooks enforce a hard "never" list (Gate 1); a custom `ship` MCP tool evaluates the diff for auto-merge eligibility (Gate 2) and either merges via `gh pr merge --squash` or leaves the PR labeled `needs-review`.

**Tech Stack:** Node 20+, TypeScript 5, `@anthropic-ai/claude-agent-sdk`, `tsx` (TS loader for the CLI and tests), Node's built-in `node:test` runner, `gh` CLI for PR ops. The spec lives at `docs/superpowers/specs/2026-05-28-ada-dev-agent-design.md` — keep it open while you build.

**Conventions to honor (from `AGENTS.md` and project memory):**
- This Next.js is non-standard — read `node_modules/next/dist/docs/` before touching Next-specific code.
- No Tailwind, no UI libs.
- API routes use `requireAdmin` (`lib/admin-auth`) / portal helpers (`lib/portal-auth`).
- Supabase is service-role-only via `supabaseAdmin`.
- New DB tables = a new numbered file `supabase/migrations/NNN_*.sql` (Phase 1 has no DB changes).

---

## Pre-flight

- [ ] **Step 0a: Confirm on the right base branch**

```bash
git status
git branch --show-current
```

Expected: working tree clean. Current branch is `spec/ada-design` (or `main`).

- [ ] **Step 0b: Create the feature branch**

```bash
# If currently on spec/ada-design, branch from there so the spec rides along.
# If on main, branch from main.
git checkout -b feat/ada-phase-1
```

- [ ] **Step 0c: Note required env vars**

You do not need to set anything yet, but the agent will need at runtime:
- `ANTHROPIC_API_KEY` (already present in `.env.example`; required for `query()`)
- `GH_TOKEN` *(optional — falls back to your local `gh auth` if logged in)*

The smoke test in Task 12 is the first place these are required.

---

## Task 1: Install dependencies and wire scripts

**Files:** Modify `package.json`.

- [ ] **Step 1: Install the SDK (runtime) and `tsx` (dev)**

```bash
npm install @anthropic-ai/claude-agent-sdk
npm install --save-dev tsx
```

- [ ] **Step 2: Add the three new scripts to `package.json`**

Open `package.json` and merge into the existing `"scripts"` block (do not remove anything):

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "devagent": "tsx scripts/devagent.ts",
    "test": "node --import tsx --test \"lib/devagent/**/*.test.ts\"",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 3: Verify the install + typecheck still pass**

```bash
npm run typecheck
```

Expected: PASS (no TS errors — the repo was already clean).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(devagent): add SDK + tsx deps and devagent/test/typecheck scripts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Shared types

**Files:** Create `lib/devagent/types.ts`.

- [ ] **Step 1: Create the file**

```ts
// lib/devagent/types.ts

/** A single development task handed to Ada. */
export type DevAgentTask = {
  /** Plain-English description of what to build/fix. */
  description: string;
  /** Optional partial override of the guardrails config. */
  guardrails?: Partial<GuardrailsConfig>;
};

export type GuardrailsConfig = {
  /** Globs always blocked from Write/Edit by the model (Gate 1). */
  protectedPaths: string[];
  /** Substrings (lowercased) that, if present in a Bash command, deny it (Gate 1). */
  bannedBashSubstrings: string[];
  /** Globs whose presence in the diff forces needs-review (Gate 2). */
  alwaysExcludeGlobs: string[];
  /** Globs that may be auto-merged when the other gates pass (Gate 2). */
  allowlistGlobs: string[];
  /** Max number of changed files for auto-merge eligibility. */
  maxChangedFiles: number;
  /** Max sum of added+deleted lines for auto-merge eligibility. */
  maxChangedLines: number;
  /** Hard turn / token / wall-clock caps for the whole run. */
  budget: { maxTurns: number; maxTokens: number; maxWallMs: number };
};

export type FileChange = {
  path: string;
  added: number;
  deleted: number;
};

export type ScopeReason =
  | "ok"
  | "verification_failed"
  | "reviewer_must_fix"
  | "outside_allowlist"
  | "in_excluded_path"
  | "too_many_files"
  | "too_many_lines"
  | "dependency_change";

export type ScopeEvaluation = {
  eligible: boolean;
  reasons: ScopeReason[];
  /** Human-readable explanation, suitable for a PR comment. */
  message: string;
};

export type VerifyStep = {
  name: "typecheck" | "build" | "lint" | "test";
  command: string;
  exitCode: number;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
};

export type VerifyResult = {
  ok: boolean;
  steps: VerifyStep[];
};

export type Workspace = {
  /** Absolute path to the worktree dir. */
  cwd: string;
  /** The branch name created for this run. */
  branch: string;
  /** Short slug used in the branch + dir name. */
  slug: string;
  /** Cleanup: remove the worktree. Idempotent. */
  cleanup: () => Promise<void>;
};

export type ShipDecision = {
  prUrl: string | null;
  merged: boolean;
  evaluation: ScopeEvaluation;
};

export type RunResult = {
  status: "completed" | "failed";
  ship?: ShipDecision;
  filesChanged: FileChange[];
  verify?: VerifyResult;
  tokensUsed?: number;
  costUsd?: number;
  error?: string;
};
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/devagent/types.ts
git commit -m "feat(devagent): shared types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Guardrails config defaults

**Files:** Create `lib/devagent/config.ts`.

- [ ] **Step 1: Create the file**

```ts
// lib/devagent/config.ts
import type { GuardrailsConfig } from "./types";

/** Hard "never" file rules (Gate 1) — blocked by the PreToolUse hook. */
export const DEFAULT_PROTECTED_PATHS: string[] = [
  ".env",
  ".env.*",
  "lib/admin-auth.ts",
  "lib/portal-auth.ts",
  "proxy.ts",
  "lib/stripe.ts",
];

/** Substrings that block a Bash command (Gate 1). Case-insensitive. */
export const DEFAULT_BANNED_BASH: string[] = [
  "vercel deploy --prod",
  "vercel --prod",
  "git push --force",
  "git push -f",
  "force-with-lease",
  "rm -rf /",
  "supabase db reset",
  "git checkout main",
  "git switch main",
];

/** Always force needs-review when ANY of these globs is in the diff (Gate 2). */
export const DEFAULT_ALWAYS_EXCLUDE_GLOBS: string[] = [
  ".env*",
  "lib/admin-auth.ts",
  "lib/portal-auth.ts",
  "proxy.ts",
  "lib/stripe.ts",
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "vercel.json",
  "tsconfig.json",
  ".github/**",
];

/** Allowlist: only paths matching one of these may auto-merge (Gate 2). */
export const DEFAULT_ALLOWLIST_GLOBS: string[] = [
  "app/**",
  "lib/**",
  "public/**",
  "supabase/migrations/**",
  "docs/**",
];

export const DEFAULT_GUARDRAILS: GuardrailsConfig = {
  protectedPaths: DEFAULT_PROTECTED_PATHS,
  bannedBashSubstrings: DEFAULT_BANNED_BASH,
  alwaysExcludeGlobs: DEFAULT_ALWAYS_EXCLUDE_GLOBS,
  allowlistGlobs: DEFAULT_ALLOWLIST_GLOBS,
  maxChangedFiles: 8,
  maxChangedLines: 400,
  budget: { maxTurns: 50, maxTokens: 500_000, maxWallMs: 15 * 60_000 },
};
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/devagent/config.ts
git commit -m "feat(devagent): default guardrails config

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Guardrails — write the failing tests (TDD)

**Files:** Create `lib/devagent/guardrails.test.ts`.

The pure-function guardrail logic is the most safety-critical code in the project. We write the tests first.

- [ ] **Step 1: Write the failing test file**

```ts
// lib/devagent/guardrails.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchGlob,
  isPathProtected,
  isBashBanned,
  evaluatePreToolUse,
  evaluateScope,
} from "./guardrails";
import { DEFAULT_GUARDRAILS } from "./config";

test("matchGlob: ** matches across slashes", () => {
  assert.equal(matchGlob("lib/admin-auth.ts", "lib/**"), true);
  assert.equal(matchGlob("lib/sub/file.ts", "lib/**"), true);
  assert.equal(matchGlob("app/(admin)/page.tsx", "app/**"), true);
  assert.equal(matchGlob("README.md", "lib/**"), false);
});

test("matchGlob: single * does not cross slashes", () => {
  assert.equal(matchGlob("lib/foo.ts", "lib/*.ts"), true);
  assert.equal(matchGlob("lib/sub/foo.ts", "lib/*.ts"), false);
});

test("matchGlob: dotfiles", () => {
  assert.equal(matchGlob(".env", ".env*"), true);
  assert.equal(matchGlob(".env.local", ".env*"), true);
  assert.equal(matchGlob(".envrc", ".env*"), true);
  assert.equal(matchGlob("env.local", ".env*"), false);
});

test("isPathProtected: leading ./ is normalized", () => {
  assert.equal(isPathProtected("./proxy.ts", DEFAULT_GUARDRAILS.protectedPaths), true);
  assert.equal(isPathProtected("proxy.ts", DEFAULT_GUARDRAILS.protectedPaths), true);
  assert.equal(isPathProtected("lib/admin-auth.ts", DEFAULT_GUARDRAILS.protectedPaths), true);
  assert.equal(isPathProtected("lib/stripe.ts", DEFAULT_GUARDRAILS.protectedPaths), true);
  assert.equal(isPathProtected("lib/avery/draft.ts", DEFAULT_GUARDRAILS.protectedPaths), false);
});

test("isBashBanned: case-insensitive substring match", () => {
  assert.equal(isBashBanned("vercel deploy --prod", DEFAULT_GUARDRAILS.bannedBashSubstrings), true);
  assert.equal(isBashBanned("VERCEL --PROD --confirm", DEFAULT_GUARDRAILS.bannedBashSubstrings), true);
  assert.equal(isBashBanned("git push --force", DEFAULT_GUARDRAILS.bannedBashSubstrings), true);
  assert.equal(isBashBanned("npm test", DEFAULT_GUARDRAILS.bannedBashSubstrings), false);
});

test("evaluatePreToolUse: blocks Write to protected file", () => {
  const d = evaluatePreToolUse("Write", { file_path: "lib/admin-auth.ts", content: "x" }, DEFAULT_GUARDRAILS);
  assert.equal(d.allow, false);
  assert.match(d.reason!, /Protected file/);
});

test("evaluatePreToolUse: allows Write to ordinary file", () => {
  const d = evaluatePreToolUse("Write", { file_path: "lib/devagent/run.ts", content: "x" }, DEFAULT_GUARDRAILS);
  assert.equal(d.allow, true);
});

test("evaluatePreToolUse: blocks banned Bash command", () => {
  const d = evaluatePreToolUse("Bash", { command: "vercel --prod deploy" }, DEFAULT_GUARDRAILS);
  assert.equal(d.allow, false);
});

test("evaluatePreToolUse: allows safe Bash", () => {
  const d = evaluatePreToolUse("Bash", { command: "npm run typecheck" }, DEFAULT_GUARDRAILS);
  assert.equal(d.allow, true);
});

test("evaluateScope: happy path — green, in-scope, small", () => {
  const ev = evaluateScope({
    changes: [{ path: "lib/avery/draft.ts", added: 10, deleted: 2 }],
    verifyPassed: true,
    reviewerMustFix: [],
    packageJsonDepsChanged: false,
    cfg: DEFAULT_GUARDRAILS,
  });
  assert.equal(ev.eligible, true);
  assert.deepEqual(ev.reasons, ["ok"]);
});

test("evaluateScope: verification failure blocks merge", () => {
  const ev = evaluateScope({
    changes: [{ path: "lib/avery/draft.ts", added: 1, deleted: 0 }],
    verifyPassed: false,
    reviewerMustFix: [],
    packageJsonDepsChanged: false,
    cfg: DEFAULT_GUARDRAILS,
  });
  assert.equal(ev.eligible, false);
  assert.ok(ev.reasons.includes("verification_failed"));
});

test("evaluateScope: must-fix items block merge", () => {
  const ev = evaluateScope({
    changes: [{ path: "lib/x.ts", added: 5, deleted: 0 }],
    verifyPassed: true,
    reviewerMustFix: ["missing requireAdmin"],
    packageJsonDepsChanged: false,
    cfg: DEFAULT_GUARDRAILS,
  });
  assert.equal(ev.eligible, false);
  assert.ok(ev.reasons.includes("reviewer_must_fix"));
});

test("evaluateScope: package.json dep change blocks merge", () => {
  const ev = evaluateScope({
    changes: [{ path: "lib/x.ts", added: 5, deleted: 0 }],
    verifyPassed: true,
    reviewerMustFix: [],
    packageJsonDepsChanged: true,
    cfg: DEFAULT_GUARDRAILS,
  });
  assert.equal(ev.eligible, false);
  assert.ok(ev.reasons.includes("dependency_change"));
});

test("evaluateScope: excluded path blocks merge", () => {
  const ev = evaluateScope({
    changes: [{ path: "proxy.ts", added: 2, deleted: 0 }],
    verifyPassed: true,
    reviewerMustFix: [],
    packageJsonDepsChanged: false,
    cfg: DEFAULT_GUARDRAILS,
  });
  assert.equal(ev.eligible, false);
  assert.ok(ev.reasons.includes("in_excluded_path"));
});

test("evaluateScope: outside-allowlist path blocks merge", () => {
  const ev = evaluateScope({
    changes: [{ path: "README.md", added: 1, deleted: 0 }],
    verifyPassed: true,
    reviewerMustFix: [],
    packageJsonDepsChanged: false,
    cfg: DEFAULT_GUARDRAILS,
  });
  assert.equal(ev.eligible, false);
  assert.ok(ev.reasons.includes("outside_allowlist"));
});

test("evaluateScope: too many files blocks merge", () => {
  const changes = Array.from({ length: 9 }, (_, i) => ({ path: `lib/x${i}.ts`, added: 1, deleted: 0 }));
  const ev = evaluateScope({
    changes,
    verifyPassed: true,
    reviewerMustFix: [],
    packageJsonDepsChanged: false,
    cfg: DEFAULT_GUARDRAILS,
  });
  assert.equal(ev.eligible, false);
  assert.ok(ev.reasons.includes("too_many_files"));
});

test("evaluateScope: too many lines blocks merge", () => {
  const ev = evaluateScope({
    changes: [{ path: "lib/x.ts", added: 300, deleted: 200 }],
    verifyPassed: true,
    reviewerMustFix: [],
    packageJsonDepsChanged: false,
    cfg: DEFAULT_GUARDRAILS,
  });
  assert.equal(ev.eligible, false);
  assert.ok(ev.reasons.includes("too_many_lines"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test
```

Expected: FAIL — "Cannot find module './guardrails'" (file does not exist yet).

---

## Task 5: Guardrails — implementation

**Files:** Create `lib/devagent/guardrails.ts`.

- [ ] **Step 1: Create the file**

```ts
// lib/devagent/guardrails.ts
import type { FileChange, GuardrailsConfig, ScopeEvaluation, ScopeReason } from "./types";

/**
 * Tiny glob matcher supporting `**` (cross-slash), `*` (single segment), and literal text.
 * Sufficient for the path patterns in DEFAULT_PROTECTED_PATHS / DEFAULT_ALLOWLIST_GLOBS.
 */
export function matchGlob(path: string, pattern: string): boolean {
  // Escape regex specials EXCEPT `*` (which we translate manually).
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regex = escaped
    .replace(/\*\*/g, "@@DOUBLESTAR@@")
    .replace(/\*/g, "[^/]*")
    .replace(/@@DOUBLESTAR@@/g, ".*");
  return new RegExp("^" + regex + "$").test(path);
}

export function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((p) => matchGlob(path, p));
}

export function isPathProtected(path: string, protectedPaths: string[]): boolean {
  const normalized = path.replace(/^\.\//, "");
  return matchesAny(normalized, protectedPaths);
}

export function isBashBanned(command: string, banned: string[]): boolean {
  const lower = command.toLowerCase();
  return banned.some((s) => lower.includes(s.toLowerCase()));
}

/** Gate 1: PreToolUse decision. Returns whether the agent may proceed. */
export function evaluatePreToolUse(
  toolName: string,
  toolInput: Record<string, unknown>,
  cfg: GuardrailsConfig
): { allow: boolean; reason?: string } {
  if (toolName === "Write" || toolName === "Edit") {
    const filePath = String(toolInput.file_path ?? "");
    if (filePath && isPathProtected(filePath, cfg.protectedPaths)) {
      return { allow: false, reason: `Protected file: ${filePath}` };
    }
  }
  if (toolName === "Bash") {
    const command = String(toolInput.command ?? "");
    if (command && isBashBanned(command, cfg.bannedBashSubstrings)) {
      return { allow: false, reason: `Banned command pattern in: ${command}` };
    }
  }
  return { allow: true };
}

/**
 * Build the SDK PreToolUse hook callback. Imported here lazily to keep the
 * module testable without pulling in the SDK during unit tests.
 */
export function buildPreToolUseHook(cfg: GuardrailsConfig) {
  return async (input: unknown): Promise<Record<string, unknown>> => {
    const pre = input as {
      tool_name: string;
      tool_input: Record<string, unknown>;
      hook_event_name: string;
    };
    const decision = evaluatePreToolUse(pre.tool_name, pre.tool_input, cfg);
    if (decision.allow) return {};
    return {
      hookSpecificOutput: {
        hookEventName: pre.hook_event_name,
        permissionDecision: "deny",
        permissionDecisionReason: decision.reason ?? "Denied by guardrails",
      },
    };
  };
}

/** Gate 2: decide whether the PR can be auto-merged. */
export function evaluateScope(args: {
  changes: FileChange[];
  verifyPassed: boolean;
  reviewerMustFix: string[];
  packageJsonDepsChanged: boolean;
  cfg: GuardrailsConfig;
}): ScopeEvaluation {
  const reasons: ScopeReason[] = [];

  if (!args.verifyPassed) reasons.push("verification_failed");
  if (args.reviewerMustFix.length > 0) reasons.push("reviewer_must_fix");
  if (args.packageJsonDepsChanged) reasons.push("dependency_change");

  for (const ch of args.changes) {
    if (matchesAny(ch.path, args.cfg.alwaysExcludeGlobs)) {
      reasons.push("in_excluded_path");
      break;
    }
  }
  for (const ch of args.changes) {
    if (!matchesAny(ch.path, args.cfg.allowlistGlobs)) {
      reasons.push("outside_allowlist");
      break;
    }
  }
  if (args.changes.length > args.cfg.maxChangedFiles) reasons.push("too_many_files");

  const totalLines = args.changes.reduce((s, c) => s + c.added + c.deleted, 0);
  if (totalLines > args.cfg.maxChangedLines) reasons.push("too_many_lines");

  const unique = Array.from(new Set(reasons));
  if (unique.length === 0) {
    return { eligible: true, reasons: ["ok"], message: "All auto-merge gates passed." };
  }
  return { eligible: false, reasons: unique, message: explain(unique, args) };
}

function explain(
  reasons: ScopeReason[],
  a: { changes: FileChange[]; reviewerMustFix: string[]; cfg: GuardrailsConfig }
): string {
  const parts: string[] = [];
  if (reasons.includes("verification_failed")) parts.push("Verification failed (typecheck/build/lint/test).");
  if (reasons.includes("reviewer_must_fix")) parts.push(`Reviewer flagged ${a.reviewerMustFix.length} must-fix item(s).`);
  if (reasons.includes("dependency_change")) parts.push("package.json dependencies changed.");
  if (reasons.includes("in_excluded_path")) parts.push("Diff touches a protected/excluded path.");
  if (reasons.includes("outside_allowlist")) parts.push("Diff touches a path outside the auto-merge allowlist.");
  if (reasons.includes("too_many_files")) parts.push(`Too many changed files (>${a.cfg.maxChangedFiles}).`);
  if (reasons.includes("too_many_lines")) parts.push(`Diff too large (>${a.cfg.maxChangedLines} lines).`);
  return parts.join(" ");
}
```

- [ ] **Step 2: Run the tests and verify they pass**

```bash
npm test
```

Expected: PASS — all guardrails tests green.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/devagent/guardrails.ts lib/devagent/guardrails.test.ts
git commit -m "feat(devagent): two-gate guardrails (pre-tool hooks + auto-merge scope)

Includes pure-function path/bash matchers and scope evaluator, fully covered
by node:test units.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Workspace — slug helper + worktree management

**Files:**
- Create `lib/devagent/workspace.ts`
- Create `lib/devagent/workspace.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/devagent/workspace.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSlug } from "./workspace";

test("makeSlug: produces date+task slug", () => {
  const d = new Date("2026-05-28T14:33:00Z");
  const slug = makeSlug("Add CSV export to Avery leads", d);
  // YYYY-MM-DD-HHmm-... (UTC)
  assert.match(slug, /^2026-05-28-\d{4}-add-csv-export-to-avery-leads$/);
});

test("makeSlug: sanitizes and truncates", () => {
  const d = new Date("2026-05-28T14:33:00Z");
  const slug = makeSlug("Fix!!! the /\\ very-long string that should be truncated past the limit", d);
  // Should be alphanumeric + hyphens, no trailing hyphen, slug body <= 40 chars.
  const body = slug.replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, "");
  assert.ok(body.length > 0 && body.length <= 40, `body length: ${body.length}`);
  assert.match(body, /^[a-z0-9-]+$/);
  assert.equal(body.endsWith("-"), false);
});

test("makeSlug: empty/garbage description still yields a slug", () => {
  const d = new Date("2026-05-28T14:33:00Z");
  const slug = makeSlug("!!!", d);
  assert.match(slug, /^2026-05-28-\d{4}-task$/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test
```

Expected: FAIL — "Cannot find module './workspace'".

- [ ] **Step 3: Create `lib/devagent/workspace.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test
```

Expected: PASS — workspace tests + all earlier guardrails tests still green.

- [ ] **Step 5: Commit**

```bash
git add lib/devagent/workspace.ts lib/devagent/workspace.test.ts
git commit -m "feat(devagent): workspace (slug + worktree + diff capture)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Verify — run typecheck/build/lint/test

**Files:** Create `lib/devagent/verify.ts`.

- [ ] **Step 1: Create the file**

```ts
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
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/devagent/verify.ts
git commit -m "feat(devagent): verify (typecheck/build/lint/test runner)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Subagent definitions

**Files:** Create `lib/devagent/subagents.ts`.

- [ ] **Step 1: Create the file**

```ts
// lib/devagent/subagents.ts
//
// Programmatic subagent definitions passed to the SDK's `agents` option.
// Per the Claude Agent SDK docs, each entry must include `description` (used
// by the orchestrator to decide when to dispatch) and `prompt` (the
// subagent's system prompt). `tools` whitelists what the subagent can use.

type AgentDefinition = {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
};

const SCOUT_PROMPT = `You are the scout. Your sole job is to map the part of the codebase relevant to the task.
- Use Read, Grep, and Glob only.
- Identify: the files that will change, the conventions in play (auth, supabase, migrations, *Manager+API pattern), and any existing similar feature.
- Return a concise structured summary: file paths, patterns, and ≤5 lines on conventions.
- Do not propose code. Do not edit anything.`;

const ARCHITECT_PROMPT = `You are the architect. Read the scout's report and the task, then produce a precise implementation plan.
- List files to create / modify (with brief direction), data flow, and whether a numbered Supabase migration is needed.
- Follow GB2G conventions: requireAdmin / portal-auth on API routes, supabaseAdmin (service role) for app data, numbered migrations (supabase/migrations/NNN_*.sql), the *Manager+API admin pattern.
- Honor AGENTS.md: this Next.js is non-standard — read the relevant doc in node_modules/next/dist/docs/ before designing anything Next-specific.
- Output the plan as a numbered task list. Do not write code.`;

const CODER_PROMPT = `You are the coder. Read the architect's plan and implement it.
- Follow it exactly. Match existing style (vanilla JS bent, no Tailwind, no UI libraries).
- Use Read / Edit / Write / Bash. Confirm types pass and the build succeeds locally as you go.
- If a migration is needed, place it as supabase/migrations/NNN_*.sql with the standard "service role only" RLS footer.
- Stop when the plan is done. Do not invent extra scope.`;

const VERIFIER_PROMPT = `You are the verifier. Run the project's verification commands in this order and report results:
1. \`npm run typecheck\` (or \`npx tsc --noEmit\` if no script)
2. \`npm run build\` (or \`npx next build\`)
3. \`npm run lint\` if defined
4. \`npm run test\` if defined

Return a structured report: PASS/FAIL per step, last ~50 lines of any failing output. Do not edit code; only run commands.`;

const REVIEWER_PROMPT = `You are the reviewer. Run \`git diff main...HEAD\` and assess the change.
- Look for bugs, security issues (auth bypass, leaking secrets), and convention breaks (RLS misuse, hardcoded URLs, missing requireAdmin, Tailwind sneaking in, UI libs).
- Output a structured list:
    must_fix: [ ... ]   # only items that block ship
    nice_to_have: [ ... ]
- If must_fix is empty, end your response with the literal phrase "READY TO SHIP".`;

export function buildAgents(): Record<string, AgentDefinition> {
  return {
    scout: {
      description: "Map the part of the codebase relevant to a task. Read-only.",
      prompt: SCOUT_PROMPT,
      tools: ["Read", "Grep", "Glob"],
      model: "claude-sonnet-4-6",
    },
    architect: {
      description: "Produce a precise implementation plan for the task, grounded in repo conventions.",
      prompt: ARCHITECT_PROMPT,
      tools: ["Read", "Grep", "Glob"],
      model: "claude-opus-4-7",
    },
    coder: {
      description: "Implement an approved architect plan, editing files and running quick sanity checks.",
      prompt: CODER_PROMPT,
      tools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob"],
      model: "claude-sonnet-4-6",
    },
    verifier: {
      description: "Run typecheck, build, lint, and test commands; return structured results.",
      prompt: VERIFIER_PROMPT,
      tools: ["Bash", "Read"],
      model: "claude-haiku-4-5-20251001",
    },
    reviewer: {
      description: "Review a diff for bugs, security issues, and convention breaks; return must-fix list.",
      prompt: REVIEWER_PROMPT,
      tools: ["Read", "Grep", "Bash"],
      model: "claude-opus-4-7",
    },
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/devagent/subagents.ts
git commit -m "feat(devagent): subagent roster (scout / architect / coder / verifier / reviewer)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Orchestrator system prompt

**Files:** Create `lib/devagent/orchestrator.ts`.

- [ ] **Step 1: Create the file**

```ts
// lib/devagent/orchestrator.ts
//
// Builds the orchestrator's system prompt. We use the Claude Agent SDK's
// "claude_code" preset (so all the harness tooling guidance comes for free)
// and append GB2G-specific project rules.

const PROJECT_RULES = `## GB2G Project Rules

You are operating on the GB2G repo (a Next.js 16.2.6 + React 19 + TypeScript monolith hosting marketing, portal, and admin surfaces).

CRITICAL — this is NOT the Next.js you know from training data:
- Middleware lives at \`proxy.ts\` in the repo root, not \`middleware.ts\`. (Off-limits to edits.)
- Route params are async: \`const { id } = await params\` (params is a Promise).
- There is NO root \`app/layout.tsx\`; route groups (\`(admin)\`, \`(portal)\`, marketing) each provide their own \`<html><head><body>\` shell.
- Always read the relevant guide in \`node_modules/next/dist/docs/\` before writing Next-specific code.

Auth & DB:
- API routes use \`const guard = await requireAdmin(); if (!guard.ok) return guard.response;\` (from lib/admin-auth).
- Portal routes use \`getPortalClientId()\` / \`isClientOwner()\` from lib/portal-auth.
- Supabase is service-role-only: import \`supabaseAdmin\` from \`@/lib/supabase\` in server code. Never the anon client.

DB changes:
- A new numbered migration: \`supabase/migrations/NNN_*.sql\`.
- Standard footer: \`ALTER TABLE … ENABLE ROW LEVEL SECURITY;\` + a "service role only" policy.

Style:
- No Tailwind, no UI libraries. Admin/portal load static CSS from \`public/admin/admin.css\` / \`public/portal/portal.css\`.
- Marketing site is vanilla HTML in \`public/*.html\` served by route handlers.

Agent-feature pattern:
- A \`*Manager.tsx\` client component under \`app/(admin)/clients/[id]/\` ↔ API routes under \`app/api/admin/...\` using \`requireAdmin\` + \`supabaseAdmin.upsert(..., { onConflict })\`.
- Audit via \`logEvent()\` → \`client_logs\` (lib/logger).

You have specialist subagents available via the Agent tool:
- \`scout\`: map relevant code (read-only).
- \`architect\`: produce a precise implementation plan.
- \`coder\`: implement the plan.
- \`verifier\`: run typecheck / build / lint / test.
- \`reviewer\`: review the diff before ship.

For any non-trivial task:
1. Dispatch \`scout\` first.
2. Dispatch \`architect\` with the scout's report.
3. Dispatch \`coder\` with the architect's plan.
4. Loop \`coder\` ⇄ \`verifier\` until verification is green (max 3 cycles).
5. Dispatch \`reviewer\`.
6. Once verification is green AND reviewer says READY TO SHIP, call the \`ship\` tool with an empty \`reviewer_must_fix: []\` array.

If verification stays red after 3 cycles, call \`ship\` anyway with \`reviewer_must_fix\` populated — it will open a PR labeled \`needs-review\` (no auto-merge).
`;

export function buildOrchestratorSystemPrompt() {
  return {
    type: "preset" as const,
    preset: "claude_code" as const,
    append: PROJECT_RULES,
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/devagent/orchestrator.ts
git commit -m "feat(devagent): orchestrator system prompt (preset + GB2G rules)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Ship — custom MCP tool

**Files:** Create `lib/devagent/ship.ts`.

- [ ] **Step 1: Create the file**

```ts
// lib/devagent/ship.ts
//
// The `ship` custom tool, exposed to the orchestrator via an in-process MCP
// server. It commits + pushes the branch, opens a PR via the `gh` CLI, then
// re-runs verification + evaluates Gate 2 to decide auto-merge.
//
// Why re-verify inside ship: defense in depth. The orchestrator's verifier
// subagent already ran the checks; running them again here means a misbehaving
// model can't trick us into merging unverified code.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { evaluateScope } from "./guardrails";
import { captureDiff } from "./workspace";
import { verify } from "./verify";
import type { GuardrailsConfig, ShipDecision } from "./types";

const exec = promisify(execFile);

export type ShipDeps = {
  cwd: string;
  branch: string;
  guardrails: GuardrailsConfig;
  /** Optional sink for the structured decision; the wrapper uses this to surface ship results without parsing tool_results. */
  onDecision?: (d: ShipDecision) => void;
};

export function buildShipServer(deps: ShipDeps) {
  const shipTool = tool(
    "ship",
    "Commit the current changes on the active branch, push, open a PR, and auto-merge ONLY if verification is green AND the diff is within the configured low-risk scope. Always opens the PR; only the merge is gated. Returns the PR URL and merge decision.",
    {
      title: z.string().max(72).describe("PR title (imperative, < 72 chars)"),
      body: z.string().describe("PR body in Markdown — summarize what changed and why"),
      reviewer_must_fix: z
        .array(z.string())
        .default([])
        .describe("Must-fix items from the reviewer subagent. Empty array means READY TO SHIP."),
    },
    async (args) => {
      try {
        // Stage and commit any pending changes (no-op if clean).
        await exec("git", ["add", "-A"], { cwd: deps.cwd });
        const { stdout: status } = await exec("git", ["status", "--porcelain"], { cwd: deps.cwd });
        if (status.trim().length > 0) {
          await exec("git", ["commit", "-m", args.title], { cwd: deps.cwd });
        }

        // Push the branch.
        await exec("git", ["push", "-u", "origin", deps.branch], { cwd: deps.cwd });

        // Open the PR via gh; capture the URL it prints on the last line.
        const { stdout: prOut } = await exec(
          "gh",
          ["pr", "create", "--base", "main", "--head", deps.branch, "--title", args.title, "--body", args.body],
          { cwd: deps.cwd }
        );
        const prUrl = prOut.trim().split("\n").pop() ?? "";

        // Authoritative re-check before merging.
        const { changes, packageJsonChanged } = await captureDiff(deps.cwd);
        const verifyResult = await verify(deps.cwd);

        const evaluation = evaluateScope({
          changes,
          verifyPassed: verifyResult.ok,
          reviewerMustFix: args.reviewer_must_fix,
          packageJsonDepsChanged: packageJsonChanged,
          cfg: deps.guardrails,
        });

        let merged = false;
        if (evaluation.eligible) {
          await exec(
            "gh",
            ["pr", "merge", "--squash", "--delete-branch", prUrl],
            { cwd: deps.cwd }
          );
          merged = true;
        } else {
          await exec("gh", ["pr", "edit", prUrl, "--add-label", "needs-review"], { cwd: deps.cwd }).catch(
            () => undefined
          );
          await exec(
            "gh",
            ["pr", "comment", prUrl, "--body", `Auto-merge denied: ${evaluation.message}`],
            { cwd: deps.cwd }
          ).catch(() => undefined);
        }

        const decision: ShipDecision = { prUrl, merged, evaluation };
        deps.onDecision?.(decision);

        return {
          content: [
            {
              type: "text" as const,
              text: `${merged ? "Merged" : "PR opened (needs-review)"}: ${prUrl}\n${evaluation.message}`,
            },
          ],
          structuredContent: decision,
        };
      } catch (e) {
        const err = e as Error;
        return {
          content: [{ type: "text" as const, text: `ship failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  return createSdkMcpServer({
    name: "devagent",
    version: "0.1.0",
    tools: [shipTool],
  });
}
```

- [ ] **Step 2: Add `zod` if not already present**

```bash
# `zod` is bundled by many SDKs but verify it's resolvable.
node -e "require.resolve('zod')" 2>/dev/null && echo OK || npm install zod
```

Expected: `OK`, or one `npm install zod` line.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/devagent/ship.ts package.json package-lock.json
git commit -m "feat(devagent): ship MCP tool (commit → push → PR → auto-merge gate)

Re-runs verification and re-evaluates Gate 2 inside the tool so a misbehaving
orchestrator cannot trick us into merging an unverified diff.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Run recording

**Files:** Create `lib/devagent/record.ts`.

- [ ] **Step 1: Create the file**

```ts
// lib/devagent/record.ts
//
// Phase 1: in-memory run log + a pretty-printed summary on stdout.
// Phase 2 will additionally persist a `devagent_runs` Supabase row.

import type { RunResult } from "./types";

export type RunRecord = {
  startedAt: string;
  endedAt?: string;
  task: string;
  branch: string;
  events: Array<{ at: string; type: string; payload: unknown }>;
};

export function newRecord(task: string, branch: string): RunRecord {
  return {
    startedAt: new Date().toISOString(),
    task,
    branch,
    events: [],
  };
}

export function recordEvent(rec: RunRecord, type: string, payload: unknown) {
  rec.events.push({ at: new Date().toISOString(), type, payload });
}

export function finalizeRecord(rec: RunRecord) {
  rec.endedAt = new Date().toISOString();
}

/** Pretty-print a one-shot summary at the end of a run. */
export function printSummary(rec: RunRecord, result: RunResult) {
  const lines: string[] = [];
  lines.push(`\n━━━ Ada run summary ━━━`);
  lines.push(`Task:      ${rec.task}`);
  lines.push(`Branch:    ${rec.branch}`);
  lines.push(`Status:    ${result.status}`);
  if (result.ship) {
    lines.push(`PR:        ${result.ship.prUrl ?? "(none)"}`);
    lines.push(`Merged:    ${result.ship.merged ? "yes" : "no — needs-review"}`);
    lines.push(`Reason:    ${result.ship.evaluation.message}`);
  }
  lines.push(`Files:     ${result.filesChanged.length}`);
  if (result.tokensUsed != null) lines.push(`Tokens:    ${result.tokensUsed}`);
  if (result.costUsd != null) lines.push(`Cost USD:  ${result.costUsd.toFixed(4)}`);
  if (result.error) lines.push(`Error:     ${result.error}`);
  console.log(lines.join("\n"));
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/devagent/record.ts
git commit -m "feat(devagent): run recording (in-memory log + summary print)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Run orchestration — integration test + implementation

**Files:**
- Create `lib/devagent/run.test.ts`
- Create `lib/devagent/run.ts`

The integration test pins behavior with a mocked `query()` stream so we can verify the wiring without burning API calls.

- [ ] **Step 1: Write the failing integration test**

```ts
// lib/devagent/run.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Workspace } from "./types";
import { runDevAgent } from "./run";

// Fake query: returns an async iterable matching the SDK's shape, with one
// `result` message containing cost + token usage. Injected via the runDevAgent
// `queryFn` testing seam, so we don't depend on Node's experimental mock.module().
function fakeQuery(_input: { prompt: string; options: unknown }): AsyncIterable<unknown> {
  return (async function* () {
    yield { type: "system" };
    yield {
      type: "result",
      subtype: "success",
      result: "done",
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50 },
    };
  })();
}

const fakeWorkspace: Workspace = {
  cwd: "/tmp/devagent-test-nonexistent",
  branch: "devagent/x",
  slug: "x",
  cleanup: async () => {},
};

test("runDevAgent: consumes the stream and surfaces result + cost", async () => {
  const result = await runDevAgent({
    task: { description: "stub task" },
    workspace: fakeWorkspace,
    queryFn: fakeQuery,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.costUsd, 0.01);
  assert.equal(result.tokensUsed, 150);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test
```

Expected: FAIL — "Cannot find module './run.js'".

- [ ] **Step 3: Create `lib/devagent/run.ts`**

```ts
// lib/devagent/run.ts
import { query as defaultQuery } from "@anthropic-ai/claude-agent-sdk";
import { buildAgents } from "./subagents";
import { buildOrchestratorSystemPrompt } from "./orchestrator";
import { buildPreToolUseHook } from "./guardrails";
import { buildShipServer } from "./ship";
import { newRecord, recordEvent, finalizeRecord, printSummary } from "./record";
import { captureDiff } from "./workspace";
import { DEFAULT_GUARDRAILS } from "./config";
import type {
  DevAgentTask,
  GuardrailsConfig,
  RunResult,
  ShipDecision,
  Workspace,
} from "./types";

export type RunOptions = {
  task: DevAgentTask;
  workspace: Workspace;
  guardrails?: Partial<GuardrailsConfig>;
  /** Testing seam: override the SDK's query function. Real query() is used by default. */
  queryFn?: (input: { prompt: string; options: unknown }) => AsyncIterable<unknown>;
};

type QueryFn = NonNullable<RunOptions["queryFn"]>;

export async function runDevAgent(opts: RunOptions): Promise<RunResult> {
  const queryFn: QueryFn = opts.queryFn ?? (defaultQuery as unknown as QueryFn);
  const guardrails: GuardrailsConfig = {
    ...DEFAULT_GUARDRAILS,
    ...(opts.guardrails ?? {}),
    ...(opts.task.guardrails ?? {}),
  };
  const rec = newRecord(opts.task.description, opts.workspace.branch);

  let shipDecision: ShipDecision | undefined;

  const shipServer = buildShipServer({
    cwd: opts.workspace.cwd,
    branch: opts.workspace.branch,
    guardrails,
    onDecision: (d) => {
      shipDecision = d;
      recordEvent(rec, "ship_decided", d);
    },
  });

  const preToolHook = buildPreToolUseHook(guardrails);

  let totalTokens = 0;
  let totalCost = 0;

  // SDK option object — the shape mirrors the docs at
  // https://code.claude.com/docs/en/agent-sdk/typescript (May 2026).
  const sdkOptions = {
    cwd: opts.workspace.cwd,
    settingSources: ["project"] as Array<"project" | "user" | "local">,
    systemPrompt: buildOrchestratorSystemPrompt(),
    agents: buildAgents(),
    mcpServers: { devagent: shipServer },
    allowedTools: [
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Grep",
      "Glob",
      "Agent",
      "mcp__devagent__ship",
    ],
    hooks: {
      PreToolUse: [{ matcher: "Write|Edit|Bash", hooks: [preToolHook] }],
      PostToolUse: [
        {
          matcher: "*",
          hooks: [
            async (input: unknown) => {
              recordEvent(rec, "tool_post", input);
              return {};
            },
          ],
        },
      ],
      SubagentStop: [
        {
          matcher: "*",
          hooks: [
            async (input: unknown) => {
              recordEvent(rec, "subagent_stop", input);
              return {};
            },
          ],
        },
      ],
    },
    maxTurns: guardrails.budget.maxTurns,
    permissionMode: "acceptEdits" as const,
  };

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
  }, guardrails.budget.maxWallMs);

  try {
    for await (const msg of queryFn({
      prompt: opts.task.description,
      options: sdkOptions,
    })) {
      if (timedOut) break;
      const m = msg as { type: string };
      recordEvent(rec, "message", { type: m.type });
      if (m.type === "result") {
        const r = msg as {
          result?: string;
          total_cost_usd?: number;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        totalCost = r.total_cost_usd ?? 0;
        totalTokens = (r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0);
      }
    }

    const { changes } = await captureDiff(opts.workspace.cwd).catch(() => ({
      changes: [],
    }));

    const result: RunResult = {
      status: timedOut ? "failed" : "completed",
      ship: shipDecision,
      filesChanged: changes,
      tokensUsed: totalTokens,
      costUsd: totalCost,
      error: timedOut ? "wall-clock budget exceeded" : undefined,
    };
    finalizeRecord(rec);
    printSummary(rec, result);
    return result;
  } catch (e) {
    finalizeRecord(rec);
    const result: RunResult = {
      status: "failed",
      filesChanged: [],
      error: (e as Error).message,
    };
    printSummary(rec, result);
    return result;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test
```

Expected: PASS — the new run.test.ts plus all earlier tests.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/devagent/run.ts lib/devagent/run.test.ts
git commit -m "feat(devagent): orchestrator run loop + integration test

Captures cost/tokens from the SDK result message, wires hooks for guardrails
+ audit events, and surfaces the ship decision via onDecision callback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: CLI entry point

**Files:** Create `scripts/devagent.ts`.

- [ ] **Step 1: Create the file**

```ts
// scripts/devagent.ts
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
    const result = await runDevAgent({
      task: { description },
      workspace: ws,
    });
    process.exit(result.status === "completed" ? 0 : 2);
  } finally {
    await ws.cleanup();
  }
}

main().catch((e) => {
  console.error(`devagent failed: ${(e as Error).message}`);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Verify the help path works**

```bash
npm run devagent -- --help
```

Expected: prints `Usage: npm run devagent -- "<task description>"` and exits with code 1.

- [ ] **Step 4: Commit**

```bash
git add scripts/devagent.ts
git commit -m "feat(devagent): CLI entry point (scripts/devagent.ts)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: README + smoke-test scaffold

**Files:**
- Create `lib/devagent/README.md`
- Create `lib/devagent/smoke.ts` *(env-flagged smoke runner)*

- [ ] **Step 1: Create the README**

```markdown
<!-- lib/devagent/README.md -->
# Ada — code-writing agent (Phase 1)

A coding agent built on `@anthropic-ai/claude-agent-sdk`. Runs from the CLI;
opens a PR and auto-merges only when the diff is in-scope and verification is
green.

## Run

```bash
# Requires:  ANTHROPIC_API_KEY in env  (and `gh auth login` for PR ops).
npm run devagent -- "Add a CSV export endpoint to the Avery leads admin"
```

The agent creates a sibling worktree at `../devagent-runs/<slug>/` on branch
`devagent/<slug>`, runs scout → architect → coder ⇄ verifier → reviewer, then
ships via the custom `ship` tool. The PR is auto-merged only when every
guardrail in `guardrails.ts` (Gate 1 hooks + Gate 2 scope evaluator) passes.

## Test

```bash
npm test            # node:test, runs lib/devagent/**/*.test.ts via tsx
npm run typecheck   # tsc --noEmit
```

## Smoke (real, manual)

```bash
ADA_SMOKE=1 npx tsx lib/devagent/smoke.ts
```

This runs one cheap task end-to-end and exits. It costs tokens. Off by default.

## Design

See `docs/superpowers/specs/2026-05-28-ada-dev-agent-design.md`.
```

- [ ] **Step 2: Create the smoke runner**

```ts
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
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/devagent/README.md lib/devagent/smoke.ts
git commit -m "feat(devagent): README + env-flagged smoke runner

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Update `.env.example` and `.gitignore`

**Files:** Modify `.env.example`, modify `.gitignore`.

- [ ] **Step 1: Confirm `ANTHROPIC_API_KEY` is documented**

```bash
grep -n ANTHROPIC_API_KEY .env.example
```

If absent, append:

```bash
echo "" >> .env.example
echo "# Used by lib/devagent/* (Ada) and lib/steward/* (Steward)" >> .env.example
echo "ANTHROPIC_API_KEY=" >> .env.example
```

- [ ] **Step 2: Document `GH_TOKEN` as optional**

```bash
grep -n GH_TOKEN .env.example >/dev/null || {
  echo "" >> .env.example
  echo "# Optional — used by Ada's ship tool. If unset, falls back to local 'gh auth'." >> .env.example
  echo "GH_TOKEN=" >> .env.example
}
```

- [ ] **Step 3: Ensure the worktree dir is ignored from the parent repo**

The worktree lives at `../devagent-runs/<slug>/`, *outside* this repo, so it's
not in `.gitignore`'s scope. No change needed — verify by:

```bash
ls -la .. 2>/dev/null | grep devagent-runs || echo "(none yet — created at first run)"
```

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs(devagent): document ANTHROPIC_API_KEY + GH_TOKEN in .env.example

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Final verification + push the feature branch

**Files:** none.

- [ ] **Step 1: Clean install to be sure deps resolve from scratch**

```bash
rm -rf node_modules
npm install
```

Expected: install completes without errors.

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: PASS — all `lib/devagent/**/*.test.ts` files.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Build (sanity — Ada doesn't change the Next app, but the build should still succeed)**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Push the feature branch (only on user instruction)**

```bash
# Do NOT run unless the user asks. The repo rule is "commit/push only when asked."
git push -u origin feat/ada-phase-1
```

When the user does ask, open the PR:

```bash
gh pr create --base main --head feat/ada-phase-1 \
  --title "feat(devagent): Ada Phase 1 — code-writing agent core + CLI" \
  --body "$(cat docs/superpowers/specs/2026-05-28-ada-dev-agent-design.md | head -40)"
```

---

## Out of scope (Phase 2 — separate plan)

- Inngest function `devagent-run` running the core in a Vercel Sandbox.
- `app/api/admin/devagent/route.ts` (requireAdmin, enqueue).
- `DevAgentManager.tsx` admin component (the `*Manager+API` pattern).
- `supabase/migrations/NNN_devagent_runs.sql` (per-client status-machine table).
- Ticket-driven triggers (a portal ticket → Inngest → Ada run).

When Phase 1 is dogfooded and stable, write a Phase 2 spec + plan as separate documents in `docs/superpowers/`.
