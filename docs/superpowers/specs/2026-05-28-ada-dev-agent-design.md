# Ada — Code-Writing Agent with Subagents (Design Spec)

**Date:** 2026-05-28
**Status:** Design approved — awaiting spec review before implementation plan
**Working name:** Ada *(after Ada Lovelace; matches the human-name roster — June / Mark / Maya / Reese / Avery / Iris)*

## Summary

Ada is a coding agent for GB2G that writes and ships code on the GB2G repo, built on `@anthropic-ai/claude-agent-sdk`. A shared core library (`lib/devagent/`) runs an orchestrator + a flat set of specialist subagents (scout / architect / coder / verifier / reviewer) inside an isolated workspace, then verifies the result and ships it via a custom `ship` tool: open a PR and **auto-merge only when verification is green AND the change is within a configured low-risk scope**. One core powers two surfaces — a CLI in Phase 1, an Inngest-driven platform trigger (Vercel Sandbox) in Phase 2.

## Goals

- Give GB2G a code-writing agent that can complete bounded development tasks end-to-end on this repo.
- "Subagents just like Claude Code": flat orchestrator + specialists, dispatched model-driven via the SDK's built-in `Agent` tool.
- Auto-ship low-risk changes; surface anything else as a PR labeled `needs-review`.
- Shared core; CLI now, platform trigger later — no rework.
- Mirror existing repo conventions: brand rules, auth gates, Supabase service-role usage, numbered migrations, audit chain.

## Non-goals (Phase 1)

- Multi-tenant client-repo support — target is the GB2G repo only.
- Vercel Sandbox execution — worktree isolation is sufficient for the CLI.
- Admin UI / `DevAgentManager` component — Phase 2.
- Production deployments by the agent — Ada never deploys to prod, period.
- A new test framework — use Node's built-in `node:test` via `tsx`.

## Relationship to Steward

Steward (`lib/steward/`) is a SaaS-API agent engine — its agents act through API tools on platforms like Monday/Slack/Meta. Ada is a *coding* agent — it acts on a checked-out repo, writing files and shipping a PR. Different engine, different tools, different audit shape. Ada is *not* a new platformId inside Steward; it's a peer engine under `lib/devagent/`. They can share the `logEvent` audit primitive but otherwise stand alone.

## Architecture

```
  task ──▶ Orchestrator (query(), opus)
             │  dispatches via built-in Agent tool (model-driven, parallel)
             ├─▶ scout      (read-only: map the code)
             ├─▶ architect  (read-only: plan files + data flow + migrations)
             ├─▶ coder      (Read/Edit/Write/Bash: implement)
             ├─▶ verifier   (Bash: tsc --noEmit, next build, +lint/test if present)
             └─▶ reviewer   (read-only + git diff: bug/security/convention review)
             │
             ▼
        ship (custom MCP tool): commit → push devagent/<slug> → open PR
                                 → auto-merge IF green AND in low-risk scope

  guardrail hooks (PreToolUse) wrap everything: protected paths + banned commands
  workspace: git worktree (CLI)  │  Vercel Sandbox (Phase 2)
```

**Engine configuration:**

- Package: `@anthropic-ai/claude-agent-sdk`, entrypoint `query()` (async generator).
- `cwd` = the isolated workspace.
- `settingSources: ["project"]` — load *this repo's* `AGENTS.md` and `.claude/settings.json`; ignore the user's host `~/.claude`.
- Auth: `ANTHROPIC_API_KEY` for the SDK; `GH_TOKEN` (or local `gh` auth) for PR operations.
- `systemPrompt: { type: "preset", preset: "claude_code", append: <GB2G project rules> }` — preserves the Claude Code preset; appends brand/convention rules.
- `permissionMode: "acceptEdits"` (headless), guardrails are enforced via hooks rather than per-call prompts.

## Subagent roster

| Subagent | Tools | Model | Job |
|---|---|---|---|
| **scout** | Read, Grep, Glob | sonnet | Map files, patterns, conventions touching the task. Read-only. |
| **architect** | Read, Grep, Glob | opus | Produce the plan: files to add/modify, data flow, whether a numbered migration is needed. Read-only. |
| **coder** | Read, Edit, Write, Bash | sonnet/opus | Implement the plan, obeying `AGENTS.md` (read `node_modules/next/dist/docs/` first), brand rules (no Tailwind / no UI libs), conventions (`requireAdmin`, `supabaseAdmin`, numbered migrations, `*Manager+API` pattern). |
| **verifier** | Bash | haiku | Run `tsc --noEmit`, `next build`; if `lint` / `test` scripts exist in `package.json`, run those too. Return pass/fail + output. |
| **reviewer** | Read, Grep, Bash(git diff) | opus | Review the diff for bugs, security issues, convention breaks. Return a must-fix list. Read-only. |

**SDK constraint:** subagents cannot spawn their own subagents — depth is one level. Adequate for this roster; matches how Claude Code itself works.

**Loop:** orchestrator runs coder ⇄ verifier until verification is green (capped at 3 fix cycles), then reviewer, then `ship`. If verification is still red after the cap, no merge — the PR opens labeled `needs-review`.

## Components

```
lib/devagent/
  types.ts          DevAgentTask, RunResult, ShipDecision, Guardrails config
  subagents.ts      the `agents` map (the roster above)
  orchestrator.ts   system prompt assembly (preset + appended GB2G rules), allowed tools, agents wiring
  guardrails.ts     PreToolUse hooks (protected paths, banned bash) + auto-merge scope evaluator
  workspace.ts      prepareWorkspace() → git worktree; captureDiff(); cleanup()
  verify.ts         detect+run verification scripts → structured result
  ship.ts           the `ship` MCP tool (commit/push/PR/auto-merge-eval/merge)
  run.ts            runDevAgent({task, workspace}) → assemble query(), stream, record, final gate
  record.ts         persist run + audit (logEvent → client_logs; optional devagent_runs row)
scripts/devagent.ts CLI: parse task, prepareWorkspace, runDevAgent, pretty-stream to terminal
```

**Workspace location:** sibling directory `../devagent-runs/<slug>/` (not inside the repo, so it doesn't show up in `git status` of the parent checkout). `<slug>` = a short timestamped slug from the task title.

**Dependencies added (both human-approved as foundational to this build):**

- `@anthropic-ai/claude-agent-sdk` (runtime).
- `tsx` (devDependency — runs the CLI and the tests).

**New `package.json` scripts:**

- `"devagent": "tsx scripts/devagent.ts"`
- `"test": "node --import tsx --test lib/devagent/**/*.test.ts"` *(node's built-in test runner with tsx as the TS loader — no new test-framework dep)*
- `"typecheck": "tsc --noEmit"`

## Data flow (CLI run)

1. `npm run devagent -- "Add CSV export to the Avery leads admin"` *(the `--` passes the arg through to the script)*
2. `prepareWorkspace()` → `git worktree add ../devagent-runs/<slug> -b devagent/<slug>` off `main`.
3. `runDevAgent({task, workspace})` → `query()` with orchestrator prompt + `agents` map + `hooks` + the `ship` MCP server. `cwd` = the worktree.
4. Orchestrator dispatches: scout → architect → coder ⇄ verifier (up to 3 cycles) → reviewer.
5. Orchestrator calls `ship`. The tool: stages + commits, pushes the branch, opens a PR (`gh` if available, REST + `GH_TOKEN` otherwise), evaluates auto-merge eligibility (see Guardrails §Gate 2), and merges via `gh pr merge --squash --delete-branch` if eligible.
6. Wrapper records the run (stdout always; `devagent_runs` row optional in Phase 1) and prints a summary: PR URL, merged or `needs-review`, files changed, verification results, tokens + USD cost.
7. Worktree removed in `finally`; the branch and PR are preserved.

## Guardrails

**Two independent gates.** Gate 1 is enforced inside the agent (the model cannot override). Gate 2 is enforced outside, in the `ship` tool.

### Gate 1 — Hard "never" (`PreToolUse` hooks)

Absolute, regardless of task:

**Block `Write` / `Edit` to:**

- `.env*`
- `lib/admin-auth.ts`, `lib/portal-auth.ts`
- `proxy.ts`
- `lib/stripe.ts`
- Any existing file under `supabase/migrations/` (creating *new* migration files is allowed; editing or deleting existing ones is not)

**Block `Bash` matching:**

- Production deploys: `vercel … --prod`, `vercel deploy --prod`
- Force-push: `git push --force` or `--force-with-lease`
- Destructive: `rm -rf` outside the worktree itself, `supabase db reset`, anything touching prod data
- Branch ops on `main`: no commits, merges, or pushes that target `main` directly

**Branch enforcement:** the agent commits only on the active `devagent/<slug>` branch; `main` is never touched by the agent.

### Gate 2 — Auto-merge eligibility (inside `ship`)

Open the PR unconditionally. **Merge only if ALL of these hold:**

1. **Verification green:** `tsc --noEmit` clean AND `next build` succeeds. AND if a `lint` script exists in `package.json`, it passes. AND if a `test` script exists, it passes.
2. **No must-fix items** returned by reviewer.
3. **All changed paths are in the low-risk allowlist** AND none are in the protected set.
   - **Default allowlist:** `app/**`, `lib/**`, `public/**`, `supabase/migrations/**` *(new files only — see Gate 1)*
   - **Always-excluded (force needs-review):** every file blocked by Gate 1, plus `package.json`, `package-lock.json`, `next.config.ts`, `vercel.json`, `tsconfig.json`, `.github/**`
4. **Diff size under thresholds:** ≤ 8 files changed AND ≤ 400 lines added+deleted *(defaults — tunable in `guardrails.ts`)*.
5. **No `package.json` dependency changes.** Any new or changed dep ⇒ needs-review (supply-chain caution).

Fail any of 1–5 ⇒ PR stays open, labeled `needs-review`, with the human-readable reason posted as a PR comment.

**Defense-in-depth (recommended, optional):** enable GitHub branch protection on `main` requiring Ada's status check, so even Ada can't merge a red build via mis-configuration.

### Audit

Every tool call, subagent start/stop, and ship decision is recorded via `PostToolUse` / `SubagentStop` hooks → `record.ts`, mirroring Steward's audit chain. Per-run budget caps (defaults): max 50 turns, max 500k tokens, max 15 min wall-clock; configurable.

## Error handling

- **Subagent or tool error.** Orchestrator attempts a bounded fix; if it can't recover, stops and produces a failure summary.
- **Verification still red after 3 cycles.** No merge; PR opens as `needs-review`, code preserved on the branch.
- **`query()` throws.** Wrapper catches, records `failed`, preserves the branch, prints an actionable error (mirrors Steward's try/catch finalize pattern).
- **Workspace cleanup** in `finally`. Worktree removed; branch/PR preserved if pushed.
- **`ship` / network errors.** Structured error returned; branch left pushed if the push succeeded so the work isn't lost.

## Testing

- **Unit tests (pure functions, highest value):**
  - Auto-merge scope evaluator: given a list of changed files + diff stats + dep changes → eligible? + structured reasons.
  - Protected-path matcher (Gate 1 file rules).
  - Banned-bash matcher.
  - Slug / branch naming determinism.
  - Ship decision logic (mocked git / gh).
  - **Runner:** Node's built-in `node:test`, executed via `tsx`. No new test-framework dependency.

- **Integration test (mocked SDK):** `runDevAgent` against a fake async-iterable `query()` stream — asserts events recorded, hooks wired correctly, final gate enforced.

- **Smoke test (real, manual, env-flagged):** one cheap end-to-end task (e.g. "add a code comment to file X") in a scratch worktree — expects an in-scope PR that auto-merges. Costs tokens; off by default; run when validating changes to Ada herself.

## MVP scope & build order

### Phase 1 (this build)

- `lib/devagent/` core (types, subagents, orchestrator, guardrails, workspace[worktree], verify, ship, run, record).
- `scripts/devagent.ts` CLI.
- New deps: `@anthropic-ai/claude-agent-sdk`, `tsx`.
- New scripts: `devagent`, `test`, `typecheck`.
- Recording: stdout always; `devagent_runs` Supabase row is optional and tracked under Open Decisions §3.
- Guardrails (Gate 1 hooks + Gate 2 scope evaluator) with the defaults above.
- Unit tests for the pure-function logic; one mocked-SDK integration test.
- Smoke test scaffolded but gated by an env flag.

### Phase 2 (designed, not built in Phase 1)

- Inngest function `devagent-run` that runs the core in a Vercel Sandbox.
- `app/api/admin/devagent/route.ts` (requireAdmin, enqueue).
- `DevAgentManager.tsx` admin component (the `*Manager+API` pattern).
- `supabase/migrations/NNN_devagent_runs.sql` (per-client status-machine table).
- Ticket-driven triggers (a portal ticket → Inngest → Ada run).

## Open decisions

1. **Final name.** Working name is "Ada"; the final name is your call. Spec uses "Ada" throughout; renaming is a simple find/replace in implementation.
2. **Auto-merge thresholds.** Defaults: ≤ 8 files / ≤ 400 lines, allowlist as listed. Tunable in `lib/devagent/guardrails.ts`.
3. **Phase 1 recording target.** Stdout only, or also a `devagent_runs` Supabase row in Phase 1? If yes-now, add the migration in Phase 1; otherwise defer to Phase 2.
4. **GitHub branch protection** on `main`. Defense-in-depth — recommended, not required to land Phase 1.

## Future extensions (post-Phase-2)

- Multi-tenant: target client repos with per-client credentials + repo URL on each run.
- Additional subagents (docs / changelog writer, migrations specialist).
- Reflection: Ada writes playbooks from her own successful runs (mirroring Steward's reflection).
