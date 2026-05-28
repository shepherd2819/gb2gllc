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
  | "no_changes"
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
