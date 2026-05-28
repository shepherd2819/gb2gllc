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
  "gh pr merge",
  "gh pr review --approve",
  "git push origin main",
  "git push origin head:main",
  "git -c ",
  "git --git-dir",
  // Secret-exfiltration patterns — block direct env-var references and env-dumping
  // tools. Defense-in-depth alongside Phase 2 sandbox isolation (Vercel Sandbox).
  // Match is case-insensitive on the lowercased command, so these catch $VAR,
  // ${VAR}, and bareword forms.
  "anthropic_api_key",
  "gh_token",
  "supabase_service",
  "stripe_secret",
  "workos_api_key",
  "printenv",
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
