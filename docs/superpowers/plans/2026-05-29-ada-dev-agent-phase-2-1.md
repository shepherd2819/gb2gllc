# Ada (Dev-Agent Phase 2.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six gaps the final review flagged in Phase 2 — wire mission + budget_overrides through, add step idempotency on `ticket_events` + `devagent_runs`, extend `awaiting_review` support in the admin status surface, preserve `resolved_at` on stale `ada_failed`, harden the cleanup cron's auth, and drop a redundant DB round-trip in `finalizeRun`.

**Architecture:** No architecture changes. One new migration adds idempotency keys + unique partial indexes. The pure-function pattern from Phase 1/2 (`decideTicketStatus`, `statusFromResult`) gets one more sibling helper. The Inngest function picks up a small `load-assignment` step + threads `mission` + `budgetOverrideJson` through to the sandbox via env vars; the CLI parses them and feeds them into `runDevAgent`'s existing deep-merge.

**Tech Stack:** Same as Phase 2 — Node 20+, TypeScript 5, `@anthropic-ai/claude-agent-sdk`, `@vercel/sandbox`, Inngest, Supabase, Next.js 16. The Phase 2.1 spec lives at `docs/superpowers/specs/2026-05-29-ada-dev-agent-phase-2-1-design.md` — keep it open.

---

## Pre-flight

- [ ] **Step 0a: Confirm clean tree on `main`**

```bash
git status
git branch --show-current
```

Expected: working tree clean (modulo the supabase `.temp/cli-latest` tooling file, ignore). Current branch should be `main` or `spec/ada-phase-2-1-design`.

- [ ] **Step 0b: Cut the feature branch**

```bash
git checkout main 2>/dev/null || git checkout spec/ada-phase-2-1-design
git checkout -b feat/ada-phase-2-1
```

- [ ] **Step 0c: Verify Phase 2 is in place**

```bash
ls lib/devagent/platform/record.ts lib/inngest/functions/devagent-run.ts supabase/migrations/023_devagent_phase2.sql
```

Expected: all three exist.

---

## Task 1: Migration `025_devagent_phase2_1.sql`

**Files:**
- Create: `supabase/migrations/025_devagent_phase2_1.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- ============================================================
-- 025_devagent_phase2_1.sql — Ada Phase 2.1 (step idempotency)
-- ============================================================
-- Adds the idempotency support Phase 2 deferred:
--   * devagent_runs.idempotency_key + unique index → createRun UPSERT
--   * ticket_events unique partial index → applyAdaEvent ignoreDuplicates
-- See docs/superpowers/specs/2026-05-29-ada-dev-agent-phase-2-1-design.md §2.

ALTER TABLE devagent_runs ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX uq_devagent_runs_idem
  ON devagent_runs(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX uq_ticket_events_ada
  ON ticket_events(ticket_id, kind, (payload->>'run_id'))
  WHERE actor = 'ada' AND kind IN ('ada_dispatched','ada_completed','ada_failed');
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/025_devagent_phase2_1.sql
git commit -m "feat(devagent): migration 025 — Phase 2.1 idempotency

devagent_runs.idempotency_key + unique partial index for createRun UPSERT.
Unique partial index on ticket_events(ticket_id, kind, payload->>'run_id')
WHERE actor='ada' AND kind IN ada_dispatched/completed/failed, for
applyAdaEvent ignoreDuplicates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> NOTE: applying via `supabase db push` is the operator's responsibility. Downstream tasks mock supabase and don't require a live DB.

---

## Task 2: `ticket-update.ts` — preserve `resolved_at` + ignoreDuplicates (TDD)

**Files:**
- Modify: `lib/devagent/platform/ticket-update.ts`
- Modify: `lib/devagent/platform/ticket-update.test.ts`

The fix has two parts: the resolved_at preservation (extract a pure `buildTicketUpdatePayload` helper, test it, swap in), and the `ignoreDuplicates: true` flag on the ticket_events insert (no test — relies on the migration's unique index).

- [ ] **Step 1: Write the failing tests**

APPEND to `lib/devagent/platform/ticket-update.test.ts` (do not remove existing tests):

```ts
import { buildTicketUpdatePayload } from "./ticket-update";

test("buildTicketUpdatePayload: ada_dispatched → in_progress, no resolved_at key", () => {
  const p = buildTicketUpdatePayload("ada_dispatched", "run-1", {});
  assert.equal(p.status, "in_progress");
  assert.equal(p.ada_run_id, "run-1");
  assert.equal("resolved_at" in p, false);
});

test("buildTicketUpdatePayload: ada_completed merged=true → resolved with resolved_at set", () => {
  const p = buildTicketUpdatePayload("ada_completed", "run-1", { merged: true });
  assert.equal(p.status, "resolved");
  assert.equal(p.ada_run_id, "run-1");
  assert.equal(typeof p.resolved_at, "string");
  assert.match(p.resolved_at as string, /^\d{4}-\d{2}-\d{2}T/);
});

test("buildTicketUpdatePayload: ada_completed merged=false → awaiting_review, no resolved_at key", () => {
  const p = buildTicketUpdatePayload("ada_completed", "run-1", { merged: false });
  assert.equal(p.status, "awaiting_review");
  assert.equal("resolved_at" in p, false);
});

test("buildTicketUpdatePayload: ada_failed → awaiting_review, no resolved_at key", () => {
  const p = buildTicketUpdatePayload("ada_failed", "run-1", { error: "boom" });
  assert.equal(p.status, "awaiting_review");
  assert.equal("resolved_at" in p, false);
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test
```

Expected: FAIL — `buildTicketUpdatePayload is not exported`.

- [ ] **Step 3: Update `lib/devagent/platform/ticket-update.ts`**

Replace the whole file with EXACTLY this content (preserves existing `AdaEventKind`/`TicketStatus`/`decideTicketStatus`/`AdaEventInput` and rewires `applyAdaEvent`):

```ts
// lib/devagent/platform/ticket-update.ts
//
// applyAdaEvent writes one ticket_events row AND transitions the parent
// ticket's status. The status decision and the full UPDATE payload are
// pulled out as pure functions so they're testable without supabase.
//
// NOTE: supabaseAdmin is imported dynamically inside the function so this
// module stays env-free at require time (mirrors trigger.ts pattern).

export type AdaEventKind = "ada_dispatched" | "ada_completed" | "ada_failed";

export type TicketStatus = "in_progress" | "resolved" | "awaiting_review";

/** Pure decision: what should tickets.status become after this Ada event? */
export function decideTicketStatus(
  kind: AdaEventKind,
  payload: Record<string, unknown>
): TicketStatus {
  if (kind === "ada_dispatched") return "in_progress";
  if (kind === "ada_failed") return "awaiting_review";
  // ada_completed — depends on the merge outcome
  return payload.merged === true ? "resolved" : "awaiting_review";
}

/**
 * Pure helper: build the partial UPDATE payload for the tickets row given
 * an Ada event. Crucially, `resolved_at` is ONLY included when the new
 * status is 'resolved' — for non-resolved transitions the key is OMITTED
 * (so a stale ada_failed after a manual admin resolution leaves the
 * resolved_at timestamp alone).
 */
export function buildTicketUpdatePayload(
  kind: AdaEventKind,
  runId: string,
  payload: Record<string, unknown>
): { status: TicketStatus; ada_run_id: string; resolved_at?: string } {
  const status = decideTicketStatus(kind, payload);
  const out: { status: TicketStatus; ada_run_id: string; resolved_at?: string } = {
    status,
    ada_run_id: runId,
  };
  if (status === "resolved") out.resolved_at = new Date().toISOString();
  return out;
}

export type AdaEventInput = {
  ticketId: string;
  runId: string;
  kind: AdaEventKind;
  payload: Record<string, unknown>;
  body?: string;
};

/**
 * Write a ticket_events row (idempotently — the unique partial index on
 * (ticket_id, kind, payload->>'run_id') for actor='ada' lets us safely
 * ignore duplicates on Inngest step retry) and update tickets.status /
 * ada_run_id / resolved_at via buildTicketUpdatePayload.
 */
export async function applyAdaEvent(input: AdaEventInput): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase");

  await supabaseAdmin
    .from("ticket_events")
    .insert(
      {
        ticket_id: input.ticketId,
        kind:      input.kind,
        actor:     "ada",
        payload:   { ...input.payload, run_id: input.runId },
        body:      input.body ?? null,
      },
      { ignoreDuplicates: true }
    );

  const patch = buildTicketUpdatePayload(input.kind, input.runId, input.payload);

  await supabaseAdmin
    .from("tickets")
    .update(patch)
    .eq("id", input.ticketId);
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: 71 prior + 4 new = 75 pass.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
```

Expected: PASS.

```bash
git add lib/devagent/platform/ticket-update.ts lib/devagent/platform/ticket-update.test.ts
git commit -m "fix(devagent): preserve resolved_at on non-resolved Ada events + ignoreDuplicates

Extract buildTicketUpdatePayload as a pure helper; resolved_at is now
present in the UPDATE payload ONLY when the new status is 'resolved'. A
delayed ada_failed after a manual admin resolution no longer wipes the
timestamp.

ticket_events insert now uses { ignoreDuplicates: true } against the
024 unique partial index — Inngest step retries that re-run applyAdaEvent
won't duplicate the timeline row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `orchestrator.ts` — `{mission}` option (TDD)

**Files:**
- Modify: `lib/devagent/orchestrator.ts`
- Create: `lib/devagent/orchestrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/devagent/orchestrator.test.ts`:

```ts
// lib/devagent/orchestrator.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrchestratorSystemPrompt } from "./orchestrator";

test("buildOrchestratorSystemPrompt: no opts → append starts with PROJECT_RULES marker", () => {
  const out = buildOrchestratorSystemPrompt();
  assert.equal(out.type, "preset");
  assert.equal(out.preset, "claude_code");
  // PROJECT_RULES begins with this header in Phase 1's spec
  assert.ok(out.append.startsWith("## GB2G Project Rules"));
  assert.equal(out.append.includes("## Your mission"), false);
});

test("buildOrchestratorSystemPrompt: explicit undefined mission → identical to no opts", () => {
  const a = buildOrchestratorSystemPrompt();
  const b = buildOrchestratorSystemPrompt({ mission: undefined });
  assert.equal(a.append, b.append);
});

test("buildOrchestratorSystemPrompt: mission provided → appended BEFORE PROJECT_RULES", () => {
  const out = buildOrchestratorSystemPrompt({ mission: "Be cautious about migrations." });
  assert.ok(out.append.startsWith("## Your mission\n\nBe cautious about migrations.\n\n"));
  const missionIdx = out.append.indexOf("## Your mission");
  const rulesIdx = out.append.indexOf("## GB2G Project Rules");
  assert.ok(missionIdx >= 0 && rulesIdx > missionIdx, "mission appears before rules");
});

test("buildOrchestratorSystemPrompt: empty-string mission → treated as no mission", () => {
  const out = buildOrchestratorSystemPrompt({ mission: "" });
  assert.equal(out.append.includes("## Your mission"), false);
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test
```

Expected: FAIL — most tests fail because `buildOrchestratorSystemPrompt` doesn't accept an opts arg yet (TypeScript may error at compile time; runtime test may pass the no-opts case and fail the mission-provided case).

- [ ] **Step 3: Update `lib/devagent/orchestrator.ts`**

Read the current file first (`cat lib/devagent/orchestrator.ts`) — it currently has a `const PROJECT_RULES = '...'` and an `export function buildOrchestratorSystemPrompt()`.

Replace ONLY the `buildOrchestratorSystemPrompt` function (leave `PROJECT_RULES` unchanged):

```ts
export function buildOrchestratorSystemPrompt(opts?: { mission?: string }) {
  const mission = opts?.mission && opts.mission.length > 0 ? opts.mission : null;
  const append = mission
    ? `## Your mission\n\n${mission}\n\n${PROJECT_RULES}`
    : PROJECT_RULES;
  return {
    type: "preset" as const,
    preset: "claude_code" as const,
    append,
  };
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npm test
npm run typecheck
```

Expected: tests pass (75 prior + 4 new = 79), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/devagent/orchestrator.ts lib/devagent/orchestrator.test.ts
git commit -m "feat(devagent): orchestrator accepts { mission } override (TDD)

When opts.mission is provided (non-empty), the system-prompt append is
prefixed with a '## Your mission' block BEFORE the existing PROJECT_RULES.
The mission frames the task; the rules constrain it. With no mission, the
output is byte-identical to Phase 1 / Phase 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `record.ts` — `createRun` UPSERT + `finalizeRun` clientId param (TDD)

**Files:**
- Modify: `lib/devagent/platform/record.ts`
- Create: `lib/devagent/platform/record.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/devagent/platform/record.test.ts`:

```ts
// lib/devagent/platform/record.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { statusFromResult } from "./record";
import type { RunResult } from "@/lib/devagent/types";

test("statusFromResult: failed → failed", () => {
  const r: RunResult = { status: "failed", filesChanged: [] };
  assert.equal(statusFromResult(r), "failed");
});

test("statusFromResult: completed + ship.merged=true → completed_merged", () => {
  const r: RunResult = {
    status: "completed",
    filesChanged: [],
    ship: { prUrl: "https://x/pr/1", merged: true, evaluation: { eligible: true, reasons: ["ok"], message: "ok" }, verify: { ok: true, steps: [] } },
  };
  assert.equal(statusFromResult(r), "completed_merged");
});

test("statusFromResult: completed + ship.merged=false → completed_needs_review", () => {
  const r: RunResult = {
    status: "completed",
    filesChanged: [],
    ship: { prUrl: "https://x/pr/1", merged: false, evaluation: { eligible: false, reasons: ["too_many_files"], message: "too big" }, verify: { ok: true, steps: [] } },
  };
  assert.equal(statusFromResult(r), "completed_needs_review");
});

test("statusFromResult: completed + no ship → completed_needs_review (defensive)", () => {
  const r: RunResult = { status: "completed", filesChanged: [] };
  assert.equal(statusFromResult(r), "completed_needs_review");
});
```

- [ ] **Step 2: Run tests to verify the import resolves**

```bash
npm test
```

Expected: PASS — `statusFromResult` already exists. We're just locking its behavior with tests before refactoring `createRun` and `finalizeRun`.

- [ ] **Step 3: Update `lib/devagent/platform/record.ts`**

Replace the WHOLE file with EXACTLY this content:

```ts
// lib/devagent/platform/record.ts
//
// DB-backed run persistence for Ada Phase 2 (devagent_runs + last-run touches
// on client_devagent_assignments). Phase 1's lib/devagent/record.ts handles
// in-memory event logging + stdout summary; this module is the platform-side
// sink used by the Inngest function.
//
// NOTE: supabaseAdmin is imported dynamically inside each function so this
// module stays env-free at require time (mirrors trigger.ts pattern).

import type { RunResult } from "@/lib/devagent/types";

export type CreateRunInput = {
  clientId: string;
  triggeringTicketId: string | null;
  trigger: "ticket" | "manual" | "scheduled";
  taskText: string;
  /**
   * Idempotency key for the run row. Inngest step.run that retries after the
   * insert succeeded but the checkpoint failed would otherwise duplicate the
   * row. Pass Inngest's event.id (or event.id + ":insert") here; the unique
   * partial index on devagent_runs(idempotency_key) WHERE idempotency_key IS
   * NOT NULL turns the duplicate INSERT into an UPSERT that returns the
   * existing row.
   */
  idempotencyKey: string;
};

export async function createRun(input: CreateRunInput): Promise<{ id: string }> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data, error } = await supabaseAdmin
    .from("devagent_runs")
    .upsert(
      {
        client_id:            input.clientId,
        triggering_ticket_id: input.triggeringTicketId,
        trigger:              input.trigger,
        task_text:            input.taskText,
        status:               "queued",
        idempotency_key:      input.idempotencyKey,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: false }
    )
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new Error(`createRun failed: ${error?.message ?? "no row returned"}`);
  return { id: data.id };
}

export async function markRunning(runId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  await supabaseAdmin
    .from("devagent_runs")
    .update({ status: "running" })
    .eq("id", runId);
}

/** Pure helper: map a RunResult to a devagent_runs.status enum value. */
export function statusFromResult(result: RunResult): "completed_merged" | "completed_needs_review" | "failed" {
  if (result.status === "failed") return "failed";
  return result.ship?.merged ? "completed_merged" : "completed_needs_review";
}

export async function finalizeRun(args: {
  runId: string;
  result: RunResult;
  /** Caller supplies clientId so we don't re-fetch (Phase 2 did an extra round-trip). */
  clientId: string;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const status = statusFromResult(args.result);
  const completedAt = new Date().toISOString();

  await supabaseAdmin
    .from("devagent_runs")
    .update({
      status,
      ship:         args.result.ship ?? null,
      tokens_used:  args.result.tokensUsed ?? null,
      cost_usd:     args.result.costUsd ?? null,
      error:        args.result.error ?? null,
      completed_at: completedAt,
    })
    .eq("id", args.runId);

  // Touch the assignment row's last_run_at / last_run_status for the admin UI.
  await supabaseAdmin
    .from("client_devagent_assignments")
    .update({ last_run_at: completedAt, last_run_status: status, updated_at: completedAt })
    .eq("client_id", args.clientId);
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npm test
npm run typecheck
```

Expected: 79 + 4 new = 83 pass. Typecheck likely FAILS at `lib/inngest/functions/devagent-run.ts` because `finalizeRun` now requires `clientId`. That's fine — Task 9 fixes it. **Defer the typecheck PASS to Task 9.** If you're nervous, append `// @ts-expect-error - finalizeRun now requires clientId; Task 9 wires it through` above the failing line in `devagent-run.ts` and remove it during Task 9.

Actually, simpler: do NOT add `@ts-expect-error`. Instead, in this commit, also update `lib/inngest/functions/devagent-run.ts` to pass `clientId: data.clientId` to the finalizeRun call inside the finalize step. It's a 1-line change to keep the tree compilable. Diff the file:

In `lib/inngest/functions/devagent-run.ts` find:

```ts
      await finalizeRun({ runId, result });
```

and replace with:

```ts
      await finalizeRun({ runId, result, clientId: data.clientId });
```

Same for `createRun` — find:

```ts
    const { id: runId } = await step.run("insert-run", () =>
      createRun({
        clientId:           data.clientId,
        triggeringTicketId: data.ticketId,
        trigger:            data.trigger,
        taskText:           data.taskText,
      })
    );
```

Replace with:

```ts
    const { id: runId } = await step.run("insert-run", () =>
      createRun({
        clientId:           data.clientId,
        triggeringTicketId: data.ticketId,
        trigger:            data.trigger,
        taskText:           data.taskText,
        idempotencyKey:     `${event.id}:insert`,
      })
    );
```

Run typecheck again. Expected: PASS now.

- [ ] **Step 5: Commit**

```bash
git add lib/devagent/platform/record.ts lib/devagent/platform/record.test.ts lib/inngest/functions/devagent-run.ts
git commit -m "fix(devagent): record idempotency + finalizeRun accepts clientId

createRun now UPSERTs on idempotency_key (from migration 025). The Inngest
function passes \`\${event.id}:insert\` so step.run retries after a partial
checkpoint don't create a second devagent_runs row.

finalizeRun now takes clientId directly (one fewer round-trip — the caller
already has it from the event payload).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `run.ts` — `RunOptions.mission` (TDD-style extension)

**Files:**
- Modify: `lib/devagent/run.ts`
- Modify: `lib/devagent/run.test.ts`

- [ ] **Step 1: Extend the integration test**

APPEND to `lib/devagent/run.test.ts` (after the existing test):

```ts
test("runDevAgent: opts.mission flows into orchestrator system prompt", async () => {
  let capturedOptions: unknown = null;
  const captureQuery = (input: { prompt: string; options: unknown }): AsyncIterable<unknown> => {
    capturedOptions = input.options;
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        result: "done",
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    })();
  };

  await runDevAgent({
    task: { description: "stub" },
    workspace: fakeWorkspace,
    queryFn: captureQuery,
    mission: "Mind the migrations.",
  });

  const sysPrompt = (capturedOptions as { systemPrompt?: { append?: string } })?.systemPrompt;
  assert.ok(sysPrompt?.append, "captureQuery never received systemPrompt.append");
  assert.ok(
    sysPrompt!.append!.startsWith("## Your mission\n\nMind the migrations."),
    `expected mission prefix, got: ${sysPrompt!.append!.slice(0, 80)}`
  );
});

test("runDevAgent: opts.guardrails.budget partial override is deep-merged with defaults", async () => {
  let capturedOptions: unknown = null;
  const captureQuery = (input: { prompt: string; options: unknown }): AsyncIterable<unknown> => {
    capturedOptions = input.options;
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        result: "done",
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    })();
  };

  await runDevAgent({
    task: { description: "stub" },
    workspace: fakeWorkspace,
    queryFn: captureQuery,
    guardrails: { budget: { maxTurns: 7 } },
  });

  const maxTurns = (capturedOptions as { maxTurns?: number }).maxTurns;
  assert.equal(maxTurns, 7, "maxTurns override should reach sdkOptions");
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test
```

Expected: FAIL — `runDevAgent` doesn't accept `opts.mission` yet; the first new test should fail because `sysPrompt.append` won't have the mission prefix.

- [ ] **Step 3: Update `lib/devagent/run.ts`**

Find the `RunOptions` type and add `mission?: string`:

```ts
export type RunOptions = {
  task: DevAgentTask;
  workspace: Workspace;
  guardrails?: Partial<GuardrailsConfig>;
  /** Per-client mission override; forwarded to buildOrchestratorSystemPrompt({mission}). */
  mission?: string;
  /** Testing seam: override the SDK's query function. Real query() is used by default. */
  queryFn?: (input: { prompt: string; options: unknown }) => AsyncIterable<unknown>;
};
```

In `runDevAgent`, find the call to `buildOrchestratorSystemPrompt()` (it's the one assigned to `systemPrompt` inside `sdkOptions`). Replace:

```ts
    systemPrompt: buildOrchestratorSystemPrompt(),
```

with:

```ts
    systemPrompt: buildOrchestratorSystemPrompt({ mission: opts.mission }),
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npm test
npm run typecheck
```

Expected: tests pass (83 + 2 new = 85), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/devagent/run.ts lib/devagent/run.test.ts
git commit -m "feat(devagent): RunOptions.mission forwarded to orchestrator

runDevAgent now accepts an optional mission string; it's forwarded into
buildOrchestratorSystemPrompt({mission}), which prepends the '## Your
mission' block to the appended payload. Integration test captures the
sdkOptions and asserts the mission text reaches systemPrompt.append.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `scripts/devagent.ts` — read `ADA_MISSION_OVERRIDE` + `ADA_BUDGET_OVERRIDE_JSON`

**Files:**
- Modify: `scripts/devagent.ts`

- [ ] **Step 1: Read the current file**

```bash
cat scripts/devagent.ts
```

Find the block:

```ts
    const result = await runDevAgent({
      task: { description },
      workspace: ws,
    });
```

- [ ] **Step 2: Replace that block with the env-aware version**

```ts
    const missionOverride =
      typeof process.env.ADA_MISSION_OVERRIDE === "string" && process.env.ADA_MISSION_OVERRIDE.length > 0
        ? process.env.ADA_MISSION_OVERRIDE
        : undefined;

    let budgetOverride: import("@/lib/devagent/types").GuardrailsConfig["budget"] | undefined;
    const budgetJson = process.env.ADA_BUDGET_OVERRIDE_JSON;
    if (budgetJson) {
      try {
        budgetOverride = JSON.parse(budgetJson);
      } catch (e) {
        console.error(`ignoring malformed ADA_BUDGET_OVERRIDE_JSON: ${(e as Error).message}`);
      }
    }

    const result = await runDevAgent({
      task: { description },
      workspace: ws,
      ...(missionOverride !== undefined ? { mission: missionOverride } : {}),
      ...(budgetOverride !== undefined ? { guardrails: { budget: budgetOverride } } : {}),
    });
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
```

Expected: PASS.

```bash
git add scripts/devagent.ts
git commit -m "feat(devagent): CLI reads ADA_MISSION_OVERRIDE + ADA_BUDGET_OVERRIDE_JSON

Both env vars are optional: when unset the CLI is byte-identical to Phase 2.
The sandbox bootstrap (Task 7) will set them when client_devagent_assignments
has non-null values.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `sandbox.ts` — `missionOverride` + `budgetOverrideJson` args + env injection

**Files:**
- Modify: `lib/devagent/platform/sandbox.ts`

- [ ] **Step 1: Extend the `RunInSandboxArgs` type and the `Sandbox.create({env})` block**

Read the current `sandbox.ts` and find `RunInSandboxArgs`:

```ts
export type RunInSandboxArgs = {
  taskDescription: string;
};
```

Replace with:

```ts
export type RunInSandboxArgs = {
  taskDescription: string;
  /** Per-client mission override from client_devagent_assignments.mission. */
  missionOverride?: string;
  /** JSON-stringified Partial<GuardrailsConfig["budget"]>. */
  budgetOverrideJson?: string;
};
```

Then find the `Sandbox.create({ ... env: { ... } })` block. Extend the `env` object so the two new vars are included ONLY when defined (don't leak empty strings into the sandbox env):

```ts
  const sandbox = await Sandbox.create({
    timeout: 30 * 60_000,
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
      GH_TOKEN:          process.env.GH_TOKEN ?? "",
      ADA_RESULT_FILE:   SANDBOX_RESULT_PATH,
      ...(args.missionOverride    !== undefined ? { ADA_MISSION_OVERRIDE:     args.missionOverride }    : {}),
      ...(args.budgetOverrideJson !== undefined ? { ADA_BUDGET_OVERRIDE_JSON: args.budgetOverrideJson } : {}),
    },
  });
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
```

Expected: PASS (the Inngest function still calls `runInSandbox` with `{ taskDescription }` — both new fields are optional).

```bash
git add lib/devagent/platform/sandbox.ts
git commit -m "feat(devagent): sandbox accepts mission + budget overrides in env

runInSandbox({taskDescription, missionOverride?, budgetOverrideJson?}) —
the two new fields, when defined, are injected into the sandbox's env block
as ADA_MISSION_OVERRIDE / ADA_BUDGET_OVERRIDE_JSON. The CLI (Task 6) reads
them and forwards into runDevAgent. Phase 2 callers (no overrides) are
unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Inngest function `devagent-run` — `load-assignment` step + overrides through

**Files:**
- Modify: `lib/inngest/functions/devagent-run.ts`

- [ ] **Step 1: Add the `load-assignment` step + thread overrides into `runInSandbox`**

Read the current `lib/inngest/functions/devagent-run.ts`. Find the section that runs `mark-running` and then `invoke-ada`:

```ts
    await step.run("mark-running", () => markRunning(runId));

    // nonRetriable: a retried run would create a duplicate PR.
    let result: RunResult;
    try {
      const outcome = await step.run(
        "invoke-ada",
        async () => runInSandbox({ taskDescription: data.taskText }),
        ...
```

Insert a `load-assignment` step right BEFORE `mark-running`, and update the `invoke-ada` body to pass the overrides:

```ts
    const overrides = await step.run("load-assignment", async () => {
      const { supabaseAdmin } = await import("@/lib/supabase");
      const { data: assignment } = await supabaseAdmin
        .from("client_devagent_assignments")
        .select("mission, budget_overrides")
        .eq("client_id", data.clientId)
        .maybeSingle<{ mission: string | null; budget_overrides: Record<string, number> | null }>();
      return {
        missionOverride:    assignment?.mission ?? null,
        budgetOverrideJson: assignment?.budget_overrides ? JSON.stringify(assignment.budget_overrides) : null,
      };
    });

    await step.run("mark-running", () => markRunning(runId));

    // nonRetriable: a retried run would create a duplicate PR.
    let result: RunResult;
    try {
      const outcome = await step.run(
        "invoke-ada",
        async () => runInSandbox({
          taskDescription: data.taskText,
          ...(overrides.missionOverride    !== null ? { missionOverride:    overrides.missionOverride    } : {}),
          ...(overrides.budgetOverrideJson !== null ? { budgetOverrideJson: overrides.budgetOverrideJson } : {}),
        }),
```

(keep the rest of the `invoke-ada` block — `{ retries: 0 }` etc. — unchanged.)

- [ ] **Step 2: Typecheck + run tests**

```bash
npm run typecheck
npm test
```

Expected: PASS / 85 tests pass.

- [ ] **Step 3: Commit**

```bash
git add lib/inngest/functions/devagent-run.ts
git commit -m "feat(devagent): Inngest fn loads assignment + threads overrides to sandbox

New step.run('load-assignment'): reads client_devagent_assignments.mission
and budget_overrides by clientId. invoke-ada then passes them into
runInSandbox as missionOverride / budgetOverrideJson, which inject them
into the sandbox env so the CLI (Task 6) picks them up.

Mission and budget_overrides admin edits now actually affect runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `TicketActions` + admin status route — `awaiting_review` enum + resolved_at preservation

**Files:**
- Modify: `app/(admin)/support/[id]/TicketActions.tsx`
- Modify: `app/api/admin/support/[id]/route.ts`

- [ ] **Step 1: Replace `TicketActions.tsx` content**

```tsx
"use client";
import { useState } from "react";

type Status = "open" | "in_progress" | "resolved" | "awaiting_review";

export function TicketActions({ ticketId, status }: { ticketId: string; status: string }) {
  const [busy, setBusy] = useState(false);

  async function setStatus(next: Status) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/support/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) alert((await res.json()).error ?? "Update failed");
      else location.reload();
    } finally {
      setBusy(false);
    }
  }

  const isAwaitingReview = status === "awaiting_review";

  return (
    <div className="ticket-actions" style={{ display: "flex", gap: 8, marginTop: 16 }}>
      {status !== "in_progress" && (
        <button className="admin-btn" onClick={() => setStatus("in_progress")} disabled={busy}>
          {isAwaitingReview ? "Re-open as in_progress" : "Mark in progress"}
        </button>
      )}
      {status !== "awaiting_review" && status !== "resolved" && (
        <button className="admin-btn" onClick={() => setStatus("awaiting_review")} disabled={busy}>
          Mark awaiting_review
        </button>
      )}
      {status !== "resolved" && (
        <button className="admin-btn primary" onClick={() => setStatus("resolved")} disabled={busy}>
          {busy ? "Saving…" : "Mark resolved"}
        </button>
      )}
      {status === "resolved" && (
        <button className="admin-btn" onClick={() => setStatus("open")} disabled={busy}>Re-open</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update the admin status PATCH route**

Replace the content of `app/api/admin/support/[id]/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };
const VALID = new Set(["open", "in_progress", "resolved", "awaiting_review"]);

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json();
  const next = String(body.status ?? "");
  if (!VALID.has(next)) return NextResponse.json({ error: "invalid status" }, { status: 400 });

  // Preserve resolved_at on non-resolved transitions (don't clobber prior resolutions).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { status: next };
  if (next === "resolved") patch.resolved_at = new Date().toISOString();

  const { error } = await supabaseAdmin.from("tickets").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

(Note the removed `else patch.resolved_at = null;` line — that's the resolved_at preservation fix on the admin side.)

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
```

Expected: PASS.

```bash
git add "app/(admin)/support/[id]/TicketActions.tsx" "app/api/admin/support/[id]/route.ts"
git commit -m "feat(admin): support \`awaiting_review\` in TicketActions + preserve resolved_at

TicketActions Status union extended to 'awaiting_review'. New buttons:
- 'Re-open as in_progress' when current status is awaiting_review (also
  renamed the existing 'Mark in progress' button accordingly).
- 'Mark awaiting_review' available for symmetry from open/in_progress.

Admin PATCH route VALID set extended; resolved_at is now omitted from the
patch on non-resolved transitions (Phase 2.1 spec §4).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `devagent-cleanup` — `CRON_SECRET` undefined-guard

**Files:**
- Modify: `app/api/cron/devagent-cleanup/route.ts`

- [ ] **Step 1: Add the undefined-guard**

Find the existing Bearer check at the top of `GET()`:

```ts
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
```

Insert this check IMMEDIATELY ABOVE the existing one:

```ts
  if (!process.env.CRON_SECRET) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
```

Expected: PASS.

```bash
git add app/api/cron/devagent-cleanup/route.ts
git commit -m "fix(devagent): cleanup cron fails closed when CRON_SECRET unset

Matches the pattern in iris-poll / wren-poll / holt-prebrief / nora-poll.
Without this guard, an unset CRON_SECRET would let 'Bearer undefined'
authenticate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Final verification

- [ ] **Step 1: Clean install**

```bash
rm -rf node_modules
npm install
```

Expected: install completes.

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: 85+ tests pass.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: PASS (clean).

- [ ] **Step 4: Build sanity**

```bash
npm run build
```

Expected: succeeds OR fails with the same pre-existing Supabase env-var error as Phases 1/2 (`Error: supabaseUrl is required.`). Anything else → STOP and report.

- [ ] **Step 5: DO NOT push and DO NOT merge.** Leave the branch local. The user reviews, applies migration 025 via `supabase db push`, then decides when to push + merge.

---

## Out of scope (later phases)

- Phase 3: multi-tenant (Ada targeting client repos).
- Phase 4: reflection / playbooks.
- A real end-to-end smoke run — the operator gate from Phase 2 still applies.
