// lib/devagent/guardrails.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchGlob,
  isPathProtected,
  isBashBanned,
  evaluatePreToolUse,
  evaluateScope,
  buildPreToolUseHook,
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

test("isBashBanned: whitespace-injection variants still caught", () => {
  // Double-space and tab between tokens must be normalised.
  assert.equal(isBashBanned("vercel  deploy  --prod", DEFAULT_GUARDRAILS.bannedBashSubstrings), true);
  assert.equal(isBashBanned("git push\t--force", DEFAULT_GUARDRAILS.bannedBashSubstrings), true);
});

test("isBashBanned: env-prefixed and chained commands still caught", () => {
  assert.equal(isBashBanned("FOO=bar vercel --prod deploy", DEFAULT_GUARDRAILS.bannedBashSubstrings), true);
  assert.equal(isBashBanned("echo hi && vercel --prod", DEFAULT_GUARDRAILS.bannedBashSubstrings), true);
});

test("isPathProtected: traversal resolves to protected", () => {
  assert.equal(isPathProtected("../lib/admin-auth.ts", DEFAULT_GUARDRAILS.protectedPaths), true);
  assert.equal(isPathProtected("../../proxy.ts", DEFAULT_GUARDRAILS.protectedPaths), true);
});

test("isPathProtected: backslash variant matches", () => {
  assert.equal(isPathProtected("lib\\admin-auth.ts", DEFAULT_GUARDRAILS.protectedPaths), true);
});

test("buildPreToolUseHook: deny shape is correct", async () => {
  const hook = buildPreToolUseHook(DEFAULT_GUARDRAILS);
  const out = await hook({
    tool_name: "Write",
    tool_input: { file_path: "proxy.ts" },
    hook_event_name: "PreToolUse",
  });
  // The hookSpecificOutput field signals the SDK to deny.
  const hso = (out as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput;
  assert.equal(hso?.permissionDecision, "deny");
});

test("buildPreToolUseHook: allow returns empty object", async () => {
  const hook = buildPreToolUseHook(DEFAULT_GUARDRAILS);
  const out = await hook({
    tool_name: "Write",
    tool_input: { file_path: "lib/devagent/run.ts" },
    hook_event_name: "PreToolUse",
  });
  assert.deepEqual(out, {});
});

test("evaluateScope: empty changes fail-closed", () => {
  const ev = evaluateScope({
    changes: [],
    verifyPassed: true,
    reviewerMustFix: [],
    packageJsonDepsChanged: false,
    cfg: DEFAULT_GUARDRAILS,
  });
  assert.equal(ev.eligible, false);
  assert.ok(ev.reasons.includes("no_changes"));
});
