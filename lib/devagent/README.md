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
