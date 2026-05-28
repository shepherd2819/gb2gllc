// lib/devagent/guardrails.ts
import { normalize } from "node:path";
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
  // Backslashes → forward slashes (Windows-style or escape variants).
  const slashed = path.replace(/\\/g, "/");
  // Absolute paths are always treated as protected (fail-safe; relative paths only).
  if (slashed.startsWith("/")) return true;
  const normalized = normalize(slashed).replace(/^\.\//, "");
  if (normalized.startsWith("../")) return true; // traversal — deny
  return matchesAny(normalized, protectedPaths);
}

export function isBashBanned(command: string, banned: string[]): boolean {
  const normalised = command.toLowerCase().replace(/\s+/g, " ");
  return banned.some((s) => normalised.includes(s.toLowerCase()));
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
 * Build the SDK PreToolUse hook callback. Typed loosely so the unit tests
 * for the pure functions above don't have to import SDK types.
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
  if (args.changes.length === 0) {
    return {
      eligible: false,
      reasons: ["no_changes"],
      message: "No changed files detected — refusing to auto-merge an empty diff.",
    };
  }

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
  // Strict greater-than is intentional: maxChangedFiles = 8 allows exactly 8 files; 9 trips this.
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
  if (reasons.includes("no_changes")) parts.push("No changed files.");
  if (reasons.includes("verification_failed")) parts.push("Verification failed (typecheck/build/lint/test).");
  if (reasons.includes("reviewer_must_fix")) parts.push(`Reviewer flagged ${a.reviewerMustFix.length} must-fix item(s).`);
  if (reasons.includes("dependency_change")) parts.push("package.json dependencies changed.");
  if (reasons.includes("in_excluded_path")) parts.push("Diff touches a protected/excluded path.");
  if (reasons.includes("outside_allowlist")) parts.push("Diff touches a path outside the auto-merge allowlist.");
  if (reasons.includes("too_many_files")) parts.push(`Too many changed files (>${a.cfg.maxChangedFiles}).`);
  if (reasons.includes("too_many_lines")) parts.push(`Diff too large (>${a.cfg.maxChangedLines} lines).`);
  return parts.join(" ");
}
