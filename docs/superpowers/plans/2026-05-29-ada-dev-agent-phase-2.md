# Ada (Dev-Agent Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ada autonomous on the GB2G platform: a portal ticket with a configured category fires an Inngest event → an Inngest function spins up a Vercel Sandbox, clones the repo, runs Ada's Phase 1 core via the CLI, then updates the originating ticket (status + timeline events) so the client sees Ada working.

**Architecture:** One new migration (`022_devagent_phase2.sql`) adds `tickets.category`, `tickets.ada_run_id`, an `awaiting_review` status, and three new tables (`client_devagent_assignments`, `devagent_runs`, `ticket_events`). One new Inngest function (`devagent-run`) handles the lifecycle inside a Vercel Sandbox. A per-client `DevAgentManager` component at `app/(admin)/clients/[id]/` provides config + history + manual dispatch. The portal ticket form gets a category dropdown; the portal POST handler emits the Inngest event in its existing `after()` block.

**Tech Stack:** Node 20+, TypeScript 5, `@anthropic-ai/claude-agent-sdk` (Phase 1), `@vercel/sandbox` (new dep — verify the API via context7 before relying on the calls in the sandbox task), Inngest, Supabase, Next.js 16. The Phase 2 spec lives at `docs/superpowers/specs/2026-05-29-ada-dev-agent-phase-2-design.md` — keep it open while you build.

**Conventions to honor (from `AGENTS.md` and project memory):**
- This Next.js is non-standard — read `node_modules/next/dist/docs/` before touching Next-specific code.
- No Tailwind, no UI libraries. Admin/portal CSS is static under `public/admin/admin.css` and `public/portal/portal.css`.
- API routes use `requireAdmin` (`lib/admin-auth`) or portal helpers (`lib/portal-auth`).
- Supabase is service-role-only via `supabaseAdmin`.
- New DB tables = new numbered file `supabase/migrations/NNN_*.sql` with the standard "service role only" RLS footer.
- The `*Manager+API` agent-feature pattern: client component under `app/(admin)/clients/[id]/`, API routes under `app/api/admin/clients/[id]/...`, all guarded by `requireAdmin`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Pre-flight

- [ ] **Step 0a: Confirm clean tree on `main`**

```bash
git status
git branch --show-current
```

Expected: working tree clean. Current branch is `main` (or `spec/ada-phase-2-design` — branch from either is fine).

- [ ] **Step 0b: Create the feature branch**

```bash
git checkout main 2>/dev/null || git checkout spec/ada-phase-2-design
git checkout -b feat/ada-phase-2
```

- [ ] **Step 0c: Verify Phase 1 is in place**

```bash
ls lib/devagent/types.ts lib/devagent/run.ts scripts/devagent.ts
```

Expected: all three files exist (Phase 1 already shipped to `main`).

- [ ] **Step 0d: Note required env vars** (do not set yet; sandbox + smoke tests need them):
  - `ANTHROPIC_API_KEY` — already used by Phase 1.
  - `GH_TOKEN` — Phase 2 sandbox uses it for the `git clone` of the GB2G repo.
  - `GB2G_REPO_URL` — optional override; defaults to `https://github.com/shepherd2819/gb2gllc.git`.

---

## Task 1: Migration `022_devagent_phase2.sql`

**Files:**
- Create: `supabase/migrations/022_devagent_phase2.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- ============================================================
-- 022_devagent_phase2.sql — Ada Phase 2 (ticket-triggered, per-client)
-- ============================================================
-- Sibling tables to client_steward_assignments / steward_runs. Ada
-- targets the GB2G repo (multi-tenant is Phase 3). Each client has one
-- assignment row controlling auto-trigger; each dispatch creates one
-- run row; each Ada touch on a ticket writes a ticket_events row.

-- ── tickets: category + Ada link + awaiting_review status ─────────────
ALTER TABLE tickets ADD COLUMN category TEXT;
ALTER TABLE tickets ADD COLUMN ada_run_id UUID;
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('open', 'in_progress', 'resolved', 'awaiting_review'));

-- ── Per-client config (PK on client_id; one row per client) ───────────
CREATE TABLE client_devagent_assignments (
  client_id          UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  mission            TEXT NOT NULL DEFAULT
    'Implement the requested change end-to-end on the GB2G repo, following existing conventions. Open a PR; auto-merge only when verification is green and the diff is in the low-risk scope. Use Ada''s verifier/reviewer subagents.',
  trigger_categories TEXT[] NOT NULL DEFAULT '{}',
  budget_overrides   JSONB,
  active             BOOLEAN NOT NULL DEFAULT FALSE,
  last_run_at        TIMESTAMPTZ,
  last_run_status    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Run records (one per dispatch) ────────────────────────────────────
CREATE TABLE devagent_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  triggering_ticket_id  UUID REFERENCES tickets(id) ON DELETE SET NULL,
  trigger               TEXT NOT NULL CHECK (trigger IN ('ticket', 'manual', 'scheduled')),
  task_text             TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN
                            ('queued','running','completed_merged','completed_needs_review','failed')),
  ship                  JSONB,
  tokens_used           INTEGER,
  cost_usd              NUMERIC(10, 6),
  error                 TEXT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);
CREATE INDEX idx_devagent_runs_client ON devagent_runs(client_id, started_at DESC);
CREATE INDEX idx_devagent_runs_ticket ON devagent_runs(triggering_ticket_id)
  WHERE triggering_ticket_id IS NOT NULL;
CREATE INDEX idx_devagent_runs_status ON devagent_runs(status) WHERE status IN ('queued','running');

ALTER TABLE tickets ADD CONSTRAINT tickets_ada_run_id_fkey
  FOREIGN KEY (ada_run_id) REFERENCES devagent_runs(id) ON DELETE SET NULL;

-- ── Ticket event timeline (Ada writes here; reusable surface) ─────────
CREATE TABLE ticket_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN
                ('ada_dispatched','ada_completed','ada_failed','status_changed','comment')),
  actor       TEXT NOT NULL CHECK (actor IN ('ada','admin','client','system')),
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  body        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ticket_events_ticket ON ticket_events(ticket_id, created_at DESC);

-- ── RLS service-role-only on all new tables (repo convention) ─────────
ALTER TABLE client_devagent_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON client_devagent_assignments FOR ALL USING (false);
ALTER TABLE devagent_runs                ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON devagent_runs                FOR ALL USING (false);
ALTER TABLE ticket_events                ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON ticket_events                FOR ALL USING (false);
```

- [ ] **Step 2: Lint the SQL (syntax-only — no DB connection required)**

```bash
# If you have psql installed, you can lint with:
psql --version >/dev/null 2>&1 && cat supabase/migrations/022_devagent_phase2.sql | head -5
# Otherwise, just visually verify by reading the file.
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/022_devagent_phase2.sql
git commit -m "feat(devagent): migration 022 — Phase 2 schema

tickets.category + tickets.ada_run_id + awaiting_review status.
client_devagent_assignments (per-client config).
devagent_runs (status machine).
ticket_events (timeline for Ada + reusable surface).
All new tables service-role-only per repo convention.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> NOTE: applying the migration to a running Supabase (`supabase db push`) is the operator's responsibility; downstream tasks mock `supabaseAdmin` and don't require a live DB.

---

## Task 2: Inngest event constants + payload types

**Files:**
- Create: `lib/devagent/platform/events.ts`

- [ ] **Step 1: Create the file**

```ts
// lib/devagent/platform/events.ts
//
// Inngest event names + payload types for Ada Phase 2. Keeping these in one
// module means every producer and consumer references the same constant
// string and the same TypeScript shape.

export const EVENT_NAMES = {
  RUN_REQUESTED: "devagent/run.requested",
} as const;

export type DevAgentRunRequestedPayload = {
  /** Client whose configuration governs this run. */
  clientId: string;
  /** Originating portal ticket, or null for a manual admin dispatch. */
  ticketId: string | null;
  /** The free-text task description handed to Ada's orchestrator. */
  taskText: string;
  /** What kicked this run off. */
  trigger: "ticket" | "manual" | "scheduled";
};
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/devagent/platform/events.ts
git commit -m "feat(devagent): Inngest event names + payload types (Phase 2)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Trigger logic (TDD)

**Files:**
- Create: `lib/devagent/platform/trigger.test.ts`
- Create: `lib/devagent/platform/trigger.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/devagent/platform/trigger.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldTrigger } from "./trigger";

const baseAssignment = {
  client_id: "c1",
  trigger_categories: ["Code Fix", "Feature Request"],
  active: true,
};
const baseTicket = { client_id: "c1", category: "Code Fix" };

test("shouldTrigger: active assignment + matching category + matching client", () => {
  assert.equal(shouldTrigger({ assignment: baseAssignment, ticket: baseTicket }), true);
});

test("shouldTrigger: active assignment but ticket category not in allowlist", () => {
  const ticket = { ...baseTicket, category: "Question" };
  assert.equal(shouldTrigger({ assignment: baseAssignment, ticket }), false);
});

test("shouldTrigger: ticket category null", () => {
  const ticket = { ...baseTicket, category: null };
  assert.equal(shouldTrigger({ assignment: baseAssignment, ticket }), false);
});

test("shouldTrigger: inactive assignment", () => {
  const assignment = { ...baseAssignment, active: false };
  assert.equal(shouldTrigger({ assignment, ticket: baseTicket }), false);
});

test("shouldTrigger: no assignment row for client", () => {
  assert.equal(shouldTrigger({ assignment: null, ticket: baseTicket }), false);
});

test("shouldTrigger: empty trigger_categories", () => {
  const assignment = { ...baseAssignment, trigger_categories: [] };
  assert.equal(shouldTrigger({ assignment, ticket: baseTicket }), false);
});

test("shouldTrigger: client_id mismatch (defensive)", () => {
  const ticket = { client_id: "c2", category: "Code Fix" };
  assert.equal(shouldTrigger({ assignment: baseAssignment, ticket }), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test
```

Expected: FAIL — `Cannot find module './trigger'`.

- [ ] **Step 3: Implement `lib/devagent/platform/trigger.ts`**

```ts
// lib/devagent/platform/trigger.ts
//
// Pure decision (shouldTrigger) + side-effecting helper (enqueueFromTicket)
// for the ticket-triggered Ada dispatch path. Imported by:
//   - app/api/portal/tickets/route.ts  (auto-trigger from portal POST after())
//   - lib/devagent/platform/enqueue.ts (manual-dispatch shares the event)

import { supabaseAdmin } from "@/lib/supabase";
import { inngest } from "@/lib/inngest/client";
import { EVENT_NAMES, type DevAgentRunRequestedPayload } from "./events";

export type Assignment = {
  client_id: string;
  trigger_categories: string[];
  active: boolean;
};

export type TicketForTrigger = {
  id: string;
  client_id: string;
  category: string | null;
  subject: string;
  body: string;
};

/** Pure decision: should a ticket trigger Ada? Safe to call without I/O. */
export function shouldTrigger(args: {
  assignment: Assignment | null;
  ticket: Pick<TicketForTrigger, "category" | "client_id">;
}): boolean {
  const { assignment, ticket } = args;
  if (!assignment) return false;
  if (!assignment.active) return false;
  if (!ticket.category) return false;
  if (assignment.client_id !== ticket.client_id) return false;
  return assignment.trigger_categories.includes(ticket.category);
}

/**
 * Look up the client's assignment and, if it should trigger, emit the
 * Inngest event. Returns whether an event was sent (for logging).
 */
export async function enqueueFromTicket(ticket: TicketForTrigger): Promise<boolean> {
  const { data: assignment } = await supabaseAdmin
    .from("client_devagent_assignments")
    .select("client_id, trigger_categories, active")
    .eq("client_id", ticket.client_id)
    .maybeSingle<Assignment>();

  if (!shouldTrigger({ assignment, ticket })) return false;

  const payload: DevAgentRunRequestedPayload = {
    clientId: ticket.client_id,
    ticketId: ticket.id,
    taskText: `${ticket.subject}\n\n${ticket.body}`,
    trigger:  "ticket",
  };
  await inngest.send({ name: EVENT_NAMES.RUN_REQUESTED, data: payload });
  return true;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test
```

Expected: PASS — the 7 new shouldTrigger tests + all earlier tests still green.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/devagent/platform/trigger.ts lib/devagent/platform/trigger.test.ts
git commit -m "feat(devagent): ticket-trigger logic (TDD)

shouldTrigger is a pure function covered by a 7-case truth table.
enqueueFromTicket wraps it with the supabase lookup + inngest.send.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Ticket update logic (TDD)

**Files:**
- Create: `lib/devagent/platform/ticket-update.test.ts`
- Create: `lib/devagent/platform/ticket-update.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/devagent/platform/ticket-update.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideTicketStatus } from "./ticket-update";

test("decideTicketStatus: ada_dispatched -> in_progress", () => {
  assert.equal(decideTicketStatus("ada_dispatched", {}), "in_progress");
});

test("decideTicketStatus: ada_completed with merged=true -> resolved", () => {
  assert.equal(decideTicketStatus("ada_completed", { merged: true }), "resolved");
});

test("decideTicketStatus: ada_completed with merged=false -> awaiting_review", () => {
  assert.equal(decideTicketStatus("ada_completed", { merged: false }), "awaiting_review");
});

test("decideTicketStatus: ada_completed with merged absent -> awaiting_review (fail-safe)", () => {
  assert.equal(decideTicketStatus("ada_completed", {}), "awaiting_review");
});

test("decideTicketStatus: ada_failed -> awaiting_review", () => {
  assert.equal(decideTicketStatus("ada_failed", { error: "boom" }), "awaiting_review");
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test
```

Expected: FAIL — `Cannot find module './ticket-update'`.

- [ ] **Step 3: Implement `lib/devagent/platform/ticket-update.ts`**

```ts
// lib/devagent/platform/ticket-update.ts
//
// applyAdaEvent writes one ticket_events row AND transitions the parent
// ticket's status. The status decision is pulled out as a pure function
// (decideTicketStatus) so it's testable without supabase.

import { supabaseAdmin } from "@/lib/supabase";

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

export type AdaEventInput = {
  ticketId: string;
  runId: string;
  kind: AdaEventKind;
  payload: Record<string, unknown>;
  body?: string;
};

/**
 * Write a ticket_events row and update tickets.status + tickets.ada_run_id.
 * Sets tickets.resolved_at iff the new status is 'resolved'.
 */
export async function applyAdaEvent(input: AdaEventInput): Promise<void> {
  const nextStatus = decideTicketStatus(input.kind, input.payload);

  await supabaseAdmin.from("ticket_events").insert({
    ticket_id: input.ticketId,
    kind:      input.kind,
    actor:     "ada",
    payload:   { ...input.payload, run_id: input.runId },
    body:      input.body ?? null,
  });

  await supabaseAdmin
    .from("tickets")
    .update({
      status:      nextStatus,
      ada_run_id:  input.runId,
      resolved_at: nextStatus === "resolved" ? new Date().toISOString() : null,
    })
    .eq("id", input.ticketId);
}
```

- [ ] **Step 4: Run the tests + typecheck**

```bash
npm test && npm run typecheck
```

Expected: tests pass (5 new + all prior), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/devagent/platform/ticket-update.ts lib/devagent/platform/ticket-update.test.ts
git commit -m "feat(devagent): ticket-update (timeline + status transition)

decideTicketStatus is pure and fully tested; applyAdaEvent wraps it with
the ticket_events insert + tickets.status/ada_run_id update.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Run-record persistence

**Files:**
- Create: `lib/devagent/platform/record.ts`

This file extends Phase 1's in-memory `lib/devagent/record.ts` with DB-backed run records. Phase 1's file stays untouched — the platform version is a separate module so Phase 1's CLI keeps its lightweight footprint.

- [ ] **Step 1: Create the file**

```ts
// lib/devagent/platform/record.ts
//
// DB-backed run persistence for Ada Phase 2 (devagent_runs + last-run touches
// on client_devagent_assignments). Phase 1's lib/devagent/record.ts handles
// in-memory event logging + stdout summary; this module is the platform-side
// sink used by the Inngest function.

import { supabaseAdmin } from "@/lib/supabase";
import type { RunResult } from "@/lib/devagent/types";

export type CreateRunInput = {
  clientId: string;
  triggeringTicketId: string | null;
  trigger: "ticket" | "manual" | "scheduled";
  taskText: string;
};

export async function createRun(input: CreateRunInput): Promise<{ id: string }> {
  const { data, error } = await supabaseAdmin
    .from("devagent_runs")
    .insert({
      client_id:            input.clientId,
      triggering_ticket_id: input.triggeringTicketId,
      trigger:              input.trigger,
      task_text:            input.taskText,
      status:               "queued",
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new Error(`createRun failed: ${error?.message ?? "no row returned"}`);
  return { id: data.id };
}

export async function markRunning(runId: string): Promise<void> {
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

export async function finalizeRun(args: { runId: string; result: RunResult }): Promise<void> {
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
  const { data: run } = await supabaseAdmin
    .from("devagent_runs")
    .select("client_id")
    .eq("id", args.runId)
    .single<{ client_id: string }>();
  if (run) {
    await supabaseAdmin
      .from("client_devagent_assignments")
      .update({ last_run_at: completedAt, last_run_status: status, updated_at: completedAt })
      .eq("client_id", run.client_id);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/devagent/platform/record.ts
git commit -m "feat(devagent): DB-backed run record (devagent_runs + assignment touch)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Vercel Sandbox runner + Phase 1 CLI tweak

**Files:**
- Create: `lib/devagent/platform/sandbox.ts`
- Modify: `scripts/devagent.ts` (write `ADA_RESULT_FILE` if env var is set)
- Modify: `package.json` — add `@vercel/sandbox` dependency

This task introduces the only Phase-1-file modification in the whole plan: `scripts/devagent.ts` opt-in JSON output. Phase 1's CLI behavior is unchanged unless `ADA_RESULT_FILE` is set, so existing usage isn't affected.

- [ ] **Step 1: Install `@vercel/sandbox`**

```bash
npm install @vercel/sandbox
```

Expected: install succeeds. Note the resolved version (we'll need it in the commit message).

> If `@vercel/sandbox` cannot resolve from the registry, STOP and report — Vercel Sandbox is GA as of Jan 2026; an install failure means the registry alias has changed, and the sandbox impl below needs to be updated to whichever package the docs currently point to.

- [ ] **Step 2: Verify the SDK shape via context7 before writing sandbox.ts**

Open the context7 MCP tool and query for the current Vercel Sandbox TypeScript API. Confirm specifically:
- The named export (likely `Sandbox`) and `Sandbox.create({...})` constructor.
- The method that runs a command in the sandbox (likely `sandbox.runCommand(cmd, args, {cwd, timeoutMs})`).
- The method that reads a file from the sandbox FS (likely `sandbox.readFile(path)` returning a string or Buffer).
- The method to stop / dispose the sandbox.
- Any required env / authentication wiring.

If the SDK differs from the code below, adjust accordingly. Document deviations in the commit message.

- [ ] **Step 3: Implement `lib/devagent/platform/sandbox.ts`**

```ts
// lib/devagent/platform/sandbox.ts
//
// Provision a Vercel Sandbox, clone the GB2G repo, run Ada's CLI (Phase 1),
// and read back the structured RunResult written via ADA_RESULT_FILE.
//
// IMPORTANT: verify the @vercel/sandbox SDK shape (Sandbox.create, runCommand,
// readFile, stop) against current docs — this skeleton matches the May 2026
// API. If the SDK signatures differ, the calls below need adjustment but
// the contract surfaced by runInSandbox stays stable.

import { Sandbox } from "@vercel/sandbox";
import type { RunResult } from "@/lib/devagent/types";

const REPO_URL = process.env.GB2G_REPO_URL ?? "https://github.com/shepherd2819/gb2gllc.git";
const SANDBOX_REPO_PATH = "/sandbox/repo";
const SANDBOX_RESULT_PATH = "/sandbox/.devagent-result.json";

export type SandboxRunOutcome = {
  /** Exit code of `npm run devagent -- "..."` inside the sandbox. */
  exitCode: number;
  /** Structured run result, or null if the CLI crashed before writing it. */
  result: RunResult | null;
  /** Last ~4 KB of CLI stdout (for audit). */
  stdoutTail: string;
  /** Last ~4 KB of CLI stderr. */
  stderrTail: string;
};

export type RunInSandboxArgs = {
  taskDescription: string;
};

export async function runInSandbox(args: RunInSandboxArgs): Promise<SandboxRunOutcome> {
  const sandbox = await Sandbox.create({
    timeout: 30 * 60_000,
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
      GH_TOKEN:          process.env.GH_TOKEN ?? "",
      ADA_RESULT_FILE:   SANDBOX_RESULT_PATH,
    },
  });
  try {
    await sandbox.runCommand("git", ["clone", REPO_URL, SANDBOX_REPO_PATH]);
    await sandbox.runCommand("npm", ["ci"], { cwd: SANDBOX_REPO_PATH });

    const cli = await sandbox.runCommand(
      "npm",
      ["run", "devagent", "--", args.taskDescription],
      { cwd: SANDBOX_REPO_PATH }
    );

    let result: RunResult | null = null;
    try {
      const raw = await sandbox.readFile(SANDBOX_RESULT_PATH);
      result = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")) as RunResult;
    } catch {
      // If the result file is missing, leave result=null and let the caller
      // fall back to exit-code + stdout tail for diagnostics.
    }

    return {
      exitCode:   cli.exitCode,
      result,
      stdoutTail: (cli.stdout ?? "").slice(-4000),
      stderrTail: (cli.stderr ?? "").slice(-4000),
    };
  } finally {
    await sandbox.stop?.().catch(() => {});
  }
}
```

- [ ] **Step 4: Modify `scripts/devagent.ts` so it writes the structured result when `ADA_RESULT_FILE` is set**

Open `scripts/devagent.ts`. The current `main()` ends with `process.exit(result.status === "completed" ? 0 : 2)` inside the `try` block, with cleanup in `finally`. Insert a result-file write BEFORE the `process.exit` and after the `runDevAgent` call:

```ts
// At the top of the file, add this import alongside the others:
import { writeFile } from "node:fs/promises";
```

Then replace the block:

```ts
    const result = await runDevAgent({
      task: { description },
      workspace: ws,
    });
    process.exit(result.status === "completed" ? 0 : 2);
```

with:

```ts
    const result = await runDevAgent({
      task: { description },
      workspace: ws,
    });
    const resultFile = process.env.ADA_RESULT_FILE;
    if (resultFile) {
      try {
        await writeFile(resultFile, JSON.stringify(result, null, 2), "utf8");
      } catch (e) {
        console.error(`failed to write ADA_RESULT_FILE: ${(e as Error).message}`);
      }
    }
    process.exit(result.status === "completed" ? 0 : 2);
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/devagent/platform/sandbox.ts scripts/devagent.ts package.json package-lock.json
git commit -m "feat(devagent): Vercel Sandbox runner + CLI ADA_RESULT_FILE opt-in

runInSandbox provisions a sandbox, clones the GB2G repo, runs Ada's Phase 1
CLI inside, and reads back the structured RunResult via ADA_RESULT_FILE.
scripts/devagent.ts gets a 4-line addition: if ADA_RESULT_FILE is set in env,
the run result is written there as JSON. Phase 1 CLI behavior is unchanged
when the env var is not set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Manual-dispatch enqueue helper

**Files:**
- Create: `lib/devagent/platform/enqueue.ts`

- [ ] **Step 1: Create the file**

```ts
// lib/devagent/platform/enqueue.ts
//
// Helper for the admin manual-dispatch path. Emits the same Inngest event as
// auto-trigger, but with trigger="manual" and ticketId=null.

import { inngest } from "@/lib/inngest/client";
import { EVENT_NAMES, type DevAgentRunRequestedPayload } from "./events";

export async function enqueueManualRun(args: {
  clientId: string;
  taskText: string;
}): Promise<{ eventId: string }> {
  const payload: DevAgentRunRequestedPayload = {
    clientId: args.clientId,
    ticketId: null,
    taskText: args.taskText,
    trigger:  "manual",
  };
  const sent = await inngest.send({ name: EVENT_NAMES.RUN_REQUESTED, data: payload });
  // `inngest.send` returns either an array of ids or a single object depending
  // on the input shape; this helper accepts either and surfaces the first id.
  const id = Array.isArray(sent.ids) ? sent.ids[0] : (sent as unknown as { ids: string[] }).ids?.[0];
  return { eventId: id ?? "" };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/devagent/platform/enqueue.ts
git commit -m "feat(devagent): manual-dispatch enqueue helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Inngest function `devagent-run`

**Files:**
- Create: `lib/inngest/functions/devagent-run.ts`
- Modify: `app/api/inngest/route.ts` — register the new function

- [ ] **Step 1: Create the function file**

```ts
// lib/inngest/functions/devagent-run.ts
//
// Ada's run lifecycle:
//   insert devagent_runs row → post-dispatch ticket event → mark running →
//   invoke Ada in sandbox (nonRetriable to avoid duplicate PRs) → finalize.
//
// Concurrency is limited to 1 per clientId so two simultaneous dispatches
// can't create conflicting branches or sandboxes.

import { inngest } from "@/lib/inngest/client";
import { EVENT_NAMES, type DevAgentRunRequestedPayload } from "@/lib/devagent/platform/events";
import { createRun, markRunning, finalizeRun } from "@/lib/devagent/platform/record";
import { applyAdaEvent } from "@/lib/devagent/platform/ticket-update";
import { runInSandbox } from "@/lib/devagent/platform/sandbox";
import type { RunResult } from "@/lib/devagent/types";

export const devagentRun = inngest.createFunction(
  {
    id: "devagent-run",
    name: "Ada: dispatched run",
    concurrency: [{ key: "event.data.clientId", limit: 1 }],
    triggers: [{ event: EVENT_NAMES.RUN_REQUESTED }],
  },
  async ({ event, step }) => {
    const data = event.data as DevAgentRunRequestedPayload;

    const { id: runId } = await step.run("insert-run", () =>
      createRun({
        clientId:           data.clientId,
        triggeringTicketId: data.ticketId,
        trigger:            data.trigger,
        taskText:           data.taskText,
      })
    );

    if (data.ticketId) {
      await step.run("post-dispatch", () =>
        applyAdaEvent({
          ticketId: data.ticketId!,
          runId,
          kind:     "ada_dispatched",
          payload:  {},
          body:     "Ada has been dispatched to work on this ticket.",
        })
      );
    }

    await step.run("mark-running", () => markRunning(runId));

    // nonRetriable: a retried run would create a duplicate PR.
    let result: RunResult;
    try {
      const outcome = await step.run(
        "invoke-ada",
        async () => runInSandbox({ taskDescription: data.taskText }),
        { retries: 0 }
      );
      if (outcome.result) {
        result = outcome.result;
      } else {
        result = {
          status:       "failed",
          filesChanged: [],
          error:        `sandbox exited ${outcome.exitCode} without ADA_RESULT_FILE; stderr tail: ${outcome.stderrTail.slice(-500)}`,
        };
      }
    } catch (err) {
      result = {
        status:       "failed",
        filesChanged: [],
        error:        err instanceof Error ? err.message : String(err),
      };
    }

    await step.run("finalize", async () => {
      await finalizeRun({ runId, result });
      if (data.ticketId) {
        const kind = result.status === "failed" ? "ada_failed" : "ada_completed";
        const body =
          result.status === "failed"
            ? `Ada failed: ${result.error ?? "(unknown error)"}`
            : result.ship?.merged
              ? `Merged: ${result.ship.prUrl}`
              : `Needs review: ${result.ship?.prUrl ?? "(no PR opened)"}`;
        await applyAdaEvent({
          ticketId: data.ticketId!,
          runId,
          kind,
          payload: {
            pr_url: result.ship?.prUrl ?? null,
            merged: result.ship?.merged ?? false,
            error:  result.error ?? null,
          },
          body,
        });
      }
    });

    return { runId, status: result.status };
  }
);
```

- [ ] **Step 2: Register the function in `app/api/inngest/route.ts`**

Replace the existing file content with:

```ts
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { stewardScheduled } from "@/lib/inngest/functions/steward-scheduled";
import { devagentRun } from "@/lib/inngest/functions/devagent-run";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [stewardScheduled, devagentRun],
});
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/inngest/functions/devagent-run.ts app/api/inngest/route.ts
git commit -m "feat(devagent): Inngest function devagent-run + register on /api/inngest

Concurrency=1 per clientId. invoke-ada step is nonRetriable to prevent
duplicate PRs on Inngest retry.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Admin API route

**Files:**
- Create: `app/api/admin/clients/[id]/devagent/route.ts`

- [ ] **Step 1: Create the route**

```ts
// app/api/admin/clients/[id]/devagent/route.ts
//
// GET  → current assignment + recent runs
// PUT  → upsert assignment (mission, trigger_categories, budget_overrides, active)
// POST → manual dispatch (taskText) — emits the same Inngest event auto-trigger uses

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { enqueueManualRun } from "@/lib/devagent/platform/enqueue";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id: clientId } = await params;

  const [{ data: assignment }, { data: runs }] = await Promise.all([
    supabaseAdmin
      .from("client_devagent_assignments")
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle(),
    supabaseAdmin
      .from("devagent_runs")
      .select("id, trigger, triggering_ticket_id, task_text, status, ship, tokens_used, cost_usd, error, started_at, completed_at")
      .eq("client_id", clientId)
      .order("started_at", { ascending: false })
      .limit(50),
  ]);

  return NextResponse.json({ assignment: assignment ?? null, runs: runs ?? [] });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id: clientId } = await params;
  const body = await req.json();

  const update = {
    client_id:          clientId,
    mission:            typeof body.mission === "string" ? body.mission : undefined,
    trigger_categories: Array.isArray(body.trigger_categories) ? body.trigger_categories : undefined,
    budget_overrides:   body.budget_overrides ?? undefined,
    active:             typeof body.active === "boolean" ? body.active : undefined,
    updated_at:         new Date().toISOString(),
  };
  Object.keys(update).forEach((k) => (update as Record<string, unknown>)[k] === undefined && delete (update as Record<string, unknown>)[k]);

  const { data, error } = await supabaseAdmin
    .from("client_devagent_assignments")
    .upsert(update, { onConflict: "client_id" })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assignment: data });
}

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id: clientId } = await params;
  const { taskText } = await req.json();
  if (typeof taskText !== "string" || taskText.trim().length === 0) {
    return NextResponse.json({ error: "taskText required" }, { status: 400 });
  }

  const { eventId } = await enqueueManualRun({ clientId, taskText: taskText.slice(0, 5000) });
  return NextResponse.json({ ok: true, eventId });
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/clients/[id]/devagent/route.ts
git commit -m "feat(devagent): admin API (GET/PUT/POST) for DevAgentManager

requireAdmin on every method. GET returns assignment + 50 most recent runs.
PUT upserts assignment. POST dispatches a manual run via inngest.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: DevAgentManager component

**Files:**
- Create: `app/(admin)/clients/[id]/DevAgentManager.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";
import { useState } from "react";

type Run = {
  id: string;
  trigger: "ticket" | "manual" | "scheduled";
  triggering_ticket_id: string | null;
  task_text: string;
  status: "queued" | "running" | "completed_merged" | "completed_needs_review" | "failed";
  ship: { prUrl: string | null; merged: boolean } | null;
  tokens_used: number | null;
  cost_usd: number | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
};

type Assignment = {
  client_id: string;
  mission: string;
  trigger_categories: string[];
  budget_overrides: Record<string, number> | null;
  active: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
};

type Props = {
  clientId: string;
  initialAssignment: Assignment | null;
  initialRuns: Run[];
};

const CATEGORY_OPTIONS = ["Question", "Bug Report", "Feature Request", "Code Fix", "Other"];

export function DevAgentManager({ clientId, initialAssignment, initialRuns }: Props) {
  const [mission, setMission] = useState(initialAssignment?.mission ?? "");
  const [categories, setCategories] = useState<string[]>(initialAssignment?.trigger_categories ?? []);
  const [active, setActive] = useState(initialAssignment?.active ?? false);
  const [saving, setSaving] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [manualTask, setManualTask] = useState("");
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  function flash(text: string, tone: "ok" | "err") {
    setMsg({ text, tone });
    setTimeout(() => setMsg(null), 3500);
  }

  function toggleCategory(c: string) {
    setCategories((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/admin/clients/${clientId}/devagent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mission, trigger_categories: categories, active }),
    });
    setSaving(false);
    flash(res.ok ? "Saved" : "Save failed", res.ok ? "ok" : "err");
  }

  async function dispatch() {
    if (!manualTask.trim()) return flash("Task text required", "err");
    setDispatching(true);
    const res = await fetch(`/api/admin/clients/${clientId}/devagent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskText: manualTask }),
    });
    setDispatching(false);
    if (res.ok) {
      flash("Dispatched", "ok");
      setManualTask("");
      // Refresh runs list.
      const reload = await fetch(`/api/admin/clients/${clientId}/devagent`);
      if (reload.ok) {
        const data = await reload.json();
        setRuns(data.runs ?? []);
      }
    } else {
      flash("Dispatch failed", "err");
    }
  }

  function statusBadge(s: Run["status"]): { label: string; cls: string } {
    if (s === "completed_merged") return { label: "Merged", cls: "badge-ok" };
    if (s === "completed_needs_review") return { label: "Needs review", cls: "badge-warn" };
    if (s === "failed") return { label: "Failed", cls: "badge-err" };
    if (s === "running") return { label: "Running…", cls: "badge-info" };
    return { label: "Queued", cls: "badge-muted" };
  }

  return (
    <section className="manager-card">
      <h2 className="section-title">Ada (dev agent)</h2>

      {msg && <p className={msg.tone === "ok" ? "manager-msg-ok" : "manager-msg-err"}>{msg.text}</p>}

      <div className="manager-row">
        <label className="manager-label">Active</label>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
      </div>

      <div className="manager-row">
        <label className="manager-label">Mission</label>
        <textarea
          className="manager-textarea"
          value={mission}
          rows={4}
          onChange={(e) => setMission(e.target.value)}
        />
      </div>

      <div className="manager-row">
        <label className="manager-label">Auto-trigger on categories</label>
        <div className="chip-row">
          {CATEGORY_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              className={categories.includes(c) ? "chip chip-on" : "chip"}
              onClick={() => toggleCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <button className="manager-save" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>

      <hr className="manager-divider" />

      <h3 className="section-subtitle">Dispatch manually</h3>
      <textarea
        className="manager-textarea"
        placeholder="Task description (will be passed to Ada)..."
        value={manualTask}
        rows={3}
        onChange={(e) => setManualTask(e.target.value)}
      />
      <button className="manager-save" onClick={dispatch} disabled={dispatching}>
        {dispatching ? "Dispatching…" : "Dispatch Ada"}
      </button>

      <hr className="manager-divider" />

      <h3 className="section-subtitle">Recent runs</h3>
      {runs.length === 0 ? (
        <p className="manager-muted">No runs yet.</p>
      ) : (
        <table className="manager-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Started</th>
              <th>Task</th>
              <th>PR</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const b = statusBadge(r.status);
              return (
                <tr key={r.id}>
                  <td><span className={`badge ${b.cls}`}>{b.label}</span></td>
                  <td>{new Date(r.started_at).toLocaleString()}</td>
                  <td className="manager-task-cell">{r.task_text.slice(0, 80)}</td>
                  <td>{r.ship?.prUrl ? <a href={r.ship.prUrl} target="_blank" rel="noreferrer">PR</a> : "—"}</td>
                  <td>{r.cost_usd != null ? `$${Number(r.cost_usd).toFixed(4)}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/clients/[id]/DevAgentManager.tsx"
git commit -m "feat(devagent): DevAgentManager admin component (config + manual + history)

Matches the existing *Manager pattern (HeraldManager / StewardManager / etc.).
Trigger categories rendered as toggle chips; runs table shows status,
started time, task preview, PR link, cost.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> The `manager-card / chip / badge-*` CSS classes are expected in `public/admin/admin.css`. If they don't exist yet (most are reused from other Managers), the component will still render — styling will land alongside the existing classes when the admin CSS picks them up. No JS-level fix needed in this task.

---

## Task 11: Mount DevAgentManager in `clients/[id]/page.tsx`

**Files:**
- Modify: `app/(admin)/clients/[id]/page.tsx`

- [ ] **Step 1: Add the import alongside the other Manager imports near the top of the file**

Insert this line in the import block (alphabetical order alongside `AtriumManager`, `HeraldManager`, etc.):

```ts
import { DevAgentManager } from "./DevAgentManager";
```

- [ ] **Step 2: Add two queries to the big `Promise.all([...])` at the top of `ClientDetailPage`**

Inside the array, append these two queries before the closing `])`:

```ts
    supabaseAdmin
      .from("client_devagent_assignments")
      .select("*")
      .eq("client_id", id)
      .maybeSingle(),
    supabaseAdmin
      .from("devagent_runs")
      .select("id, trigger, triggering_ticket_id, task_text, status, ship, tokens_used, cost_usd, error, started_at, completed_at")
      .eq("client_id", id)
      .order("started_at", { ascending: false })
      .limit(50),
```

Then add two more destructured variables in the destructure block at the top: `{ data: devagentAssignment }, { data: devagentRuns }` (matching the order of the queries above).

- [ ] **Step 3: Render the manager in the JSX**

In the JSX returned by `ClientDetailPage`, after the existing `<ReeseManager .../>` (or after whichever Manager is closest to your insertion point), add:

```tsx
        <DevAgentManager
          clientId={id}
          initialAssignment={devagentAssignment ?? null}
          initialRuns={devagentRuns ?? []}
        />
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/clients/[id]/page.tsx"
git commit -m "feat(devagent): mount DevAgentManager on clients/[id]/

Adds two supabase queries (assignment + recent runs) and renders the
Manager alongside the existing Avery/Herald/Maya/Reese/Steward managers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: TicketForm — category dropdown

**Files:**
- Modify: `app/(portal)/tickets/TicketForm.tsx`

- [ ] **Step 1: Replace the file content**

```tsx
"use client";
import { useState } from "react";

const CATEGORY_OPTIONS = [
  "Question",
  "Bug Report",
  "Feature Request",
  "Code Fix",
  "Other",
] as const;

type Category = (typeof CATEGORY_OPTIONS)[number];

export function TicketForm({ clientId }: { clientId: string }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<Category>("Question");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const res = await fetch("/api/portal/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, subject, body, category }),
    });
    setStatus(res.ok ? "done" : "error");
    if (res.ok) {
      setSubject("");
      setBody("");
      setCategory("Question");
    }
  }

  return (
    <form className="ticket-form" onSubmit={submit}>
      <h2 className="section-title">New ticket</h2>
      {status === "done" && <p className="ticket-success">Sent. We&apos;ll be in touch soon.</p>}
      {status === "error" && <p className="ticket-error">Something went wrong — email us at hello@gb2gllc.com</p>}
      <input
        className="ticket-input"
        placeholder="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        required
        disabled={status === "sending"}
      />
      <select
        className="ticket-input"
        value={category}
        onChange={(e) => setCategory(e.target.value as Category)}
        disabled={status === "sending"}
      >
        {CATEGORY_OPTIONS.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <textarea
        className="ticket-textarea"
        placeholder="Describe the issue or request..."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        required
        disabled={status === "sending"}
      />
      <button className="ticket-submit" type="submit" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Submit ticket →"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/(portal)/tickets/TicketForm.tsx"
git commit -m "feat(portal): ticket form — category dropdown (Ada Phase 2)

5 options: Question / Bug Report / Feature Request / Code Fix / Other.
Posted alongside subject/body to /api/portal/tickets.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Portal POST handler — accept category + emit Inngest event

**Files:**
- Modify: `app/api/portal/tickets/route.ts`

- [ ] **Step 1: Replace the file content**

```ts
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { postSlackMessage } from "@/lib/slack";
import { portalTicketNotificationBlocks } from "@/lib/slack-builders";
import { logEvent } from "@/lib/logger";
import { enqueueFromTicket } from "@/lib/devagent/platform/trigger";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";
const SUPPORT_SLACK_CHANNEL = process.env.SUPPORT_SLACK_CHANNEL ?? "";
const SLACK_ADMIN_BOT_TOKEN = process.env.SLACK_ADMIN_BOT_TOKEN ?? "";

export async function POST(req: NextRequest) {
  const { clientId, subject, body, category } = await req.json();

  if (!clientId || !subject || !body) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const safeSubject = String(subject).slice(0, 200);
  const safeBody = String(body).slice(0, 5000);
  const safeCategory = typeof category === "string" && category.length > 0
    ? String(category).slice(0, 80)
    : null;

  const { data: ticket, error } = await supabaseAdmin
    .from("tickets")
    .insert({ client_id: clientId, subject: safeSubject, body: safeBody, category: safeCategory })
    .select("id")
    .single<{ id: string }>();

  if (error || !ticket) {
    return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
  }

  // Fire-and-forget after the response: Slack notification + Ada auto-trigger.
  after(async () => {
    // 1. Slack — existing behavior unchanged.
    try {
      if (!SUPPORT_SLACK_CHANNEL || !SLACK_ADMIN_BOT_TOKEN) {
        await logEvent({
          category: "system",
          level: "warn",
          message: "Portal ticket created but Slack notification skipped (env unset)",
          clientId,
          metadata: { ticketId: ticket.id },
        });
      } else {
        const { data: client } = await supabaseAdmin
          .from("clients")
          .select("name, company")
          .eq("id", clientId)
          .single<{ name: string | null; company: string | null }>();

        const blocks = portalTicketNotificationBlocks({
          client: client ?? { name: null, company: null },
          subject: safeSubject,
          body: safeBody,
          ticketId: ticket.id,
          adminUrl: ADMIN_URL,
        });

        const slackRes = await postSlackMessage({
          botToken: SLACK_ADMIN_BOT_TOKEN,
          channel: SUPPORT_SLACK_CHANNEL,
          text: `New support ticket: ${safeSubject}`,
          blocks,
        });

        if (!slackRes.ok) {
          await logEvent({
            category: "system",
            level: "error",
            message: `Slack ticket notification failed: ${slackRes.error}`,
            clientId,
            metadata: { ticketId: ticket.id },
          });
        }
      }
    } catch (err) {
      await logEvent({
        category: "system",
        level: "error",
        message: `Slack ticket notification threw: ${err instanceof Error ? err.message : String(err)}`,
        clientId,
        metadata: { ticketId: ticket.id },
      });
    }

    // 2. Ada auto-trigger — best-effort.
    try {
      const triggered = await enqueueFromTicket({
        id: ticket.id,
        client_id: clientId,
        category: safeCategory,
        subject: safeSubject,
        body: safeBody,
      });
      if (triggered) {
        await logEvent({
          category: "system",
          level: "info",
          message: "Ada auto-trigger dispatched",
          clientId,
          metadata: { ticketId: ticket.id, category: safeCategory },
        });
      }
    } catch (err) {
      await logEvent({
        category: "system",
        level: "error",
        message: `Ada auto-trigger failed: ${err instanceof Error ? err.message : String(err)}`,
        clientId,
        metadata: { ticketId: ticket.id },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/portal/tickets/route.ts
git commit -m "feat(devagent): wire Ada auto-trigger into portal ticket POST

Accepts the new 'category' field, persists it, and (in after()) calls
enqueueFromTicket which checks the per-client assignment and emits the
Inngest event when the category is in the allowlist.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Admin `/support/[id]` page — render timeline + Ada run badge

**Files:**
- Modify: `app/(admin)/support/[id]/page.tsx`

This task extends the page Wren already added. The implementer should READ the current file first to understand its structure (it loads a ticket + renders the body + Wren-specific surfaces), then add ONE new section for the Ada timeline.

- [ ] **Step 1: Read the current file**

```bash
cat "app/(admin)/support/[id]/page.tsx" | head -120
```

Note the existing query for the ticket and where the JSX renders ticket details. The additions below should be inserted alongside (not replacing) that existing layout.

- [ ] **Step 2: Add a `ticket_events` + `devagent_runs` query to the page's data-loading block**

Inside the existing Promise.all (or alongside the existing single-row ticket fetch — match whatever pattern is in place), add:

```ts
    supabaseAdmin
      .from("ticket_events")
      .select("id, kind, actor, payload, body, created_at")
      .eq("ticket_id", id)
      .order("created_at", { ascending: true }),
    // If the ticket has ada_run_id, the joined run row gives PR/merged/status:
    // (loaded after we know ticket.ada_run_id)
```

If the page currently uses `supabaseAdmin.from("tickets").select("*")`, change it to `select("*, ada_run_id")` so we explicitly carry the FK to the Ada run.

After the ticket fetch, look up the linked Ada run if any:

```ts
  let adaRun = null as null | {
    id: string; status: string; ship: { prUrl: string | null; merged: boolean } | null;
    started_at: string; completed_at: string | null; error: string | null;
  };
  if (ticket?.ada_run_id) {
    const { data } = await supabaseAdmin
      .from("devagent_runs")
      .select("id, status, ship, started_at, completed_at, error")
      .eq("id", ticket.ada_run_id)
      .maybeSingle();
    adaRun = data ?? null;
  }
```

- [ ] **Step 3: Render a "Timeline" section below the ticket body**

Add this JSX block beneath the existing ticket body rendering:

```tsx
      <section className="ticket-timeline">
        <h2 className="section-title">Timeline</h2>
        {events.length === 0 ? (
          <p className="manager-muted">No events yet.</p>
        ) : (
          <ol className="timeline-list">
            {events.map((e) => (
              <li key={e.id} className={`timeline-row timeline-${e.kind}`}>
                <time className="timeline-time">{new Date(e.created_at).toLocaleString()}</time>
                <span className="timeline-actor">{e.actor}</span>
                <span className="timeline-kind">{e.kind.replace(/_/g, " ")}</span>
                {e.body && <span className="timeline-body">{e.body}</span>}
                {typeof e.payload?.pr_url === "string" && (
                  <a className="timeline-pr" href={e.payload.pr_url as string} target="_blank" rel="noreferrer">
                    PR ↗
                  </a>
                )}
              </li>
            ))}
          </ol>
        )}

        {adaRun && (
          <p className="manager-muted ada-run-summary">
            Linked Ada run: <strong>{adaRun.status}</strong>
            {adaRun.ship?.prUrl && <> · <a href={adaRun.ship.prUrl} target="_blank" rel="noreferrer">PR</a></>}
            {adaRun.error && <> · error: {adaRun.error}</>}
          </p>
        )}
      </section>
```

(`events` is the variable you destructure from the new ticket_events query; rename to match whatever your destructure uses.)

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/support/[id]/page.tsx"
git commit -m "feat(devagent): render ticket_events timeline + linked Ada run summary

Adds two supabase queries (events + the linked Ada run when present) and
renders a Timeline section beneath the existing ticket body.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Cleanup cron — mark stale runs as failed

**Files:**
- Create: `app/api/cron/devagent-cleanup/route.ts`
- Modify: `vercel.json` — add the cron entry

- [ ] **Step 1: Create the cron route**

```ts
// app/api/cron/devagent-cleanup/route.ts
//
// Daily cron: marks any devagent_runs row stuck in 'running' or 'queued' for
// more than 2× the default wall-clock budget (15 min × 2 = 30 min) as
// 'failed'. Defense against Inngest infrastructure crashes that leave
// orphaned rows.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { logEvent } from "@/lib/logger";

const STALE_AFTER_MS = 30 * 60_000; // 30 minutes

export async function GET() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const { data: stale, error: selectErr } = await supabaseAdmin
    .from("devagent_runs")
    .select("id, client_id, status, started_at")
    .in("status", ["queued", "running"])
    .lt("started_at", cutoff);

  if (selectErr) {
    await logEvent({
      category: "system",
      level: "error",
      message: `devagent-cleanup: select failed: ${selectErr.message}`,
    });
    return NextResponse.json({ error: selectErr.message }, { status: 500 });
  }

  const ids = (stale ?? []).map((r) => r.id);
  if (ids.length === 0) return NextResponse.json({ marked_failed: 0 });

  const { error: updateErr } = await supabaseAdmin
    .from("devagent_runs")
    .update({
      status:       "failed",
      error:        "stale: infrastructure crash or sandbox timeout (cleanup cron)",
      completed_at: new Date().toISOString(),
    })
    .in("id", ids);

  if (updateErr) {
    await logEvent({
      category: "system",
      level: "error",
      message: `devagent-cleanup: update failed: ${updateErr.message}`,
    });
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await logEvent({
    category: "system",
    level: "info",
    message: `devagent-cleanup: marked ${ids.length} stale run(s) as failed`,
    metadata: { run_ids: ids },
  });

  return NextResponse.json({ marked_failed: ids.length });
}
```

- [ ] **Step 2: Add the cron entry to `vercel.json`**

Open `vercel.json`. Inside the existing `"crons": [ … ]` array, add this object (after the last entry, before the closing `]`):

```json
    {
      "path": "/api/cron/devagent-cleanup",
      "schedule": "0 3 * * *"
    }
```

(Don't forget the comma after the entry above.)

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/devagent-cleanup/route.ts vercel.json
git commit -m "feat(devagent): daily cleanup cron — mark stale runs as failed

Runs at 03:00 UTC. Marks devagent_runs rows stuck in queued/running for >
30 minutes as failed, with an explanatory error string.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Smoke runner + final verification

**Files:**
- Create: `scripts/devagent-phase2-smoke.ts`

- [ ] **Step 1: Create the smoke runner**

```ts
// scripts/devagent-phase2-smoke.ts
//
// Manual smoke test for Phase 2. Off unless ADA_PHASE2_SMOKE=1 is set in env.
// Emits a manual-trigger devagent/run.requested event into Inngest and prints
// the event id. Operator then watches Inngest's local dev UI to see the run
// progress and confirms the sandbox + PR pipeline.
//
// Costs Anthropic tokens + a small Vercel Sandbox. Not in CI.

import { enqueueManualRun } from "@/lib/devagent/platform/enqueue";

if (process.env.ADA_PHASE2_SMOKE !== "1") {
  console.error("ADA_PHASE2_SMOKE is not set to 1; refusing to run smoke test.");
  process.exit(0);
}

async function main() {
  const clientId = process.env.ADA_PHASE2_SMOKE_CLIENT_ID;
  if (!clientId) {
    console.error("Set ADA_PHASE2_SMOKE_CLIENT_ID to a clients.id you control before running.");
    process.exit(1);
  }
  const taskText =
    process.env.ADA_PHASE2_SMOKE_TASK ??
    "In lib/devagent/README.md, append one line at the very bottom: '<!-- ada-phase2-smoke: hello -->'. No other changes.";

  const { eventId } = await enqueueManualRun({ clientId, taskText });
  console.log(`Smoke event sent. Inngest event id: ${eventId}`);
  console.log("Watch progress at http://localhost:8288 (Inngest dev) or Inngest cloud UI.");
}

main().catch((e) => {
  console.error(`smoke failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
```

- [ ] **Step 2: Add the smoke script to `package.json`**

In `package.json` `scripts`, add:

```json
    "devagent-smoke-phase2": "tsx scripts/devagent-phase2-smoke.ts",
```

- [ ] **Step 3: Final verification — clean install + tests + typecheck + build**

```bash
rm -rf node_modules
npm install
npm test
npm run typecheck
npm run build
```

Expected:
- Install completes (with `@vercel/sandbox` resolving).
- Tests pass (all Ada + Wren tests + new Phase 2 unit tests: 12 added by tasks 3 & 4).
- Typecheck clean.
- Build either succeeds OR fails with the same pre-existing Supabase env-var error as Phase 1 (verify by checking against `main`). If it fails for a different reason, STOP and report.

- [ ] **Step 4: Commit + LEAVE BRANCH LOCAL**

```bash
git add scripts/devagent-phase2-smoke.ts package.json
git commit -m "feat(devagent): Phase 2 smoke runner + script registration

ADA_PHASE2_SMOKE=1 ADA_PHASE2_SMOKE_CLIENT_ID=<id> npm run devagent-smoke-phase2
emits a manual-trigger event into Inngest. Operator watches Inngest dev UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

**Do NOT push and do NOT merge.** The user reviews the branch, applies migration 022 via `supabase db push`, sets the new env vars in Vercel, then decides when to push + merge.

---

## Out of scope (later phases)

- **Phase 3:** multi-tenant — Ada targeting client repos with per-client repo credentials.
- **Phase 4:** reflection / playbooks — Ada writes playbooks from her own successful runs.
- Portal-facing visibility into Ada runs (clients only see ticket-status transitions today).
- Per-ticket budget overrides (per-client only for now).
- Human approval gate on PR before merge (auto-merge stays unchanged from Phase 1).
