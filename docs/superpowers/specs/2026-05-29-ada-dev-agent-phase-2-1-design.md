# Ada Phase 2.1 — Close the Phase 2 Gaps (Design Spec)

**Date:** 2026-05-29
**Status:** Design approved — awaiting spec review before implementation plan
**Predecessor:** `docs/superpowers/specs/2026-05-29-ada-dev-agent-phase-2-design.md` (Phase 2, shipped to main at `963fcc9`)

## Summary

Phase 2.1 closes the six issues the final review flagged in Phase 2. Three matter for correctness (mission/budget config silently ignored, Inngest retries can duplicate timeline + run rows, `awaiting_review` not supported by admin status transitions). The other three are surgical polish (`resolved_at` clobbered by stale events, `CRON_SECRET` undefined-guard, an extra DB round-trip in `finalizeRun`). No architecture changes — the goal is to make Phase 2's promises actually true.

## Goals

- Admin edits to `mission` and `budget_overrides` actually affect Ada's runs.
- A retried Inngest step that already wrote a side effect doesn't duplicate the row.
- Admins can transition tickets through `awaiting_review` from the UI.
- Stale `ada_failed` events don't wipe a prior manual `resolved_at`.
- Cleanup cron auth fails closed when `CRON_SECRET` is unset.
- `finalizeRun` stops doing a redundant lookup of `client_id`.

## Non-goals (Phase 2.1)

- **Phase 3 multi-tenant** — Ada still targets the GB2G repo only.
- **Phase 4 reflection / playbooks.**
- **Any new feature** — strictly closing Phase 2 gaps.

## Items

### 1. Wire `mission` + `budget_overrides` through the run loop

Data flow (Inngest fn → sandbox → CLI):

1. `lib/inngest/functions/devagent-run.ts` adds a new `step.run("load-assignment", ...)` between `insert-run` and `invoke-ada`. The step reads `client_devagent_assignments` by `clientId` and returns `{mission, budgetOverrides}` (both nullable — admin may not have customized them).
2. `runInSandbox` extends to `runInSandbox({taskDescription, missionOverride?, budgetOverrideJson?})` and includes the two values in the `Sandbox.create({env: ...})` block as `ADA_MISSION_OVERRIDE` (string) and `ADA_BUDGET_OVERRIDE_JSON` (JSON-stringified object).
3. `scripts/devagent.ts` reads both env vars at startup. `ADA_MISSION_OVERRIDE` is passed as `runDevAgent({task, workspace, mission})`. `ADA_BUDGET_OVERRIDE_JSON` is `JSON.parse`'d into a `Partial<GuardrailsConfig["budget"]>` and passed as `runDevAgent({..., guardrails: {budget: parsed}})`. The existing deep-merge in `run.ts` (Phase 1 fix) handles overlay correctly.
4. `lib/devagent/run.ts` accepts `RunOptions.mission?: string`, forwards to `buildOrchestratorSystemPrompt({mission})`.
5. `lib/devagent/orchestrator.ts` exports `buildOrchestratorSystemPrompt(opts?: {mission?: string})`. When `opts.mission` is provided, the function prepends a `"## Your mission\n\n<mission>\n\n"` block to the appended payload, before the existing PROJECT_RULES text. The mission frames the task; the rules constrain it.

When `client_devagent_assignments` has no row, or `mission` / `budget_overrides` are null on the row, the override env vars are not set and the CLI behaves identically to Phase 2 (defaults from `lib/devagent/config.ts`).

### 2. Step idempotency for `ticket_events` + `devagent_runs`

New migration `024_devagent_phase2_1.sql`:

```sql
-- Idempotency for devagent_runs (createRun via Inngest step retry).
ALTER TABLE devagent_runs ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX uq_devagent_runs_idem
  ON devagent_runs(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Idempotency for ticket_events (applyAdaEvent via Inngest step retry).
CREATE UNIQUE INDEX uq_ticket_events_ada
  ON ticket_events(ticket_id, kind, (payload->>'run_id'))
  WHERE actor = 'ada' AND kind IN ('ada_dispatched','ada_completed','ada_failed');
```

Code changes:

- `lib/devagent/platform/record.ts`:
  - `createRun({..., idempotencyKey: string})` — performs `upsert({...}, {onConflict: "idempotency_key", ignoreDuplicates: false}).select("id").single()`. On conflict the existing row's id is returned, so subsequent steps see the same `runId`.
- `lib/devagent/platform/ticket-update.ts`:
  - `applyAdaEvent` — replaces the bare `.insert(...)` on `ticket_events` with `.insert(..., {ignoreDuplicates: true})`. The unique partial index dedupes Ada-actor rows keyed on `(ticket_id, kind, run_id)`. Manual `comment` / `status_changed` events from `admin` / `client` / `system` are unaffected because the index's `WHERE` excludes them.
- `lib/inngest/functions/devagent-run.ts`:
  - Passes `event.id` (or `event.id + ":insert"` for safety) as `idempotencyKey` to `createRun`.
  - The existing `runId` (returned from createRun) already feeds `payload.run_id`, which the ticket_events unique index uses.

### 3. `TicketActions` + admin status route enum extension

- `app/(admin)/support/[id]/TicketActions.tsx` extends the `next` union to include `"awaiting_review"`. UI: when the ticket's current status is `awaiting_review`, render two buttons — "Re-open as in_progress" and "Mark resolved". For any other current status, render the existing transitions plus a new "Mark awaiting_review" if that's a useful manual action (admin's call; default include it for symmetry).
- `app/api/admin/support/[id]/route.ts` extends the `VALID` status set to include `"awaiting_review"`.

### 4. `resolved_at` preservation

`lib/devagent/platform/ticket-update.ts`: instead of always setting `resolved_at: nextStatus === "resolved" ? <iso> : null`, build the UPDATE payload conditionally — include `resolved_at: <iso>` only when transitioning to `resolved`, and omit the key entirely otherwise. A delayed `ada_failed` after a manual admin resolution will no longer clear the timestamp.

### 5. `CRON_SECRET`-undefined guard

`app/api/cron/devagent-cleanup/route.ts`: add `if (!process.env.CRON_SECRET) return new NextResponse("Unauthorized", { status: 401 });` immediately before the `Bearer ${process.env.CRON_SECRET}` comparison. Matches the pattern in `iris-poll`, `wren-poll`, `holt-prebrief`, and `nora-poll`.

### 6. `finalizeRun` extra round-trip

- `lib/devagent/platform/record.ts`: `finalizeRun({runId, result, clientId})` accepts `clientId` directly. Drops the `select("client_id").eq("id", runId).single()` query. Updates the run row, then updates the assignment row using the passed-in `clientId`.
- `lib/inngest/functions/devagent-run.ts`: passes `data.clientId` (which the function already has from the event payload) into the finalize step.

## Migration ordering

- 022 = Nora
- 023 = Ada Phase 2
- **024 = Ada Phase 2.1** (the migration in §2)

## Testing

New unit tests added under `lib/devagent/`:

- `orchestrator.test.ts` (new file):
  - When `buildOrchestratorSystemPrompt()` is called with no args, the appended text is the existing PROJECT_RULES (Phase 2 baseline) — no `## Your mission` header.
  - When called with `{mission: "Be cautious about migrations."}`, the appended text begins with `## Your mission\n\nBe cautious about migrations.\n\n` and then the PROJECT_RULES section appears below.
- `ticket-update.test.ts` extension:
  - New pure helper `buildUpdatePayload(kind, payload)` is extracted (or `decideTicketStatus` plus a `buildResolvedAtPatch` helper); test the resolved_at logic in isolation — only present on `resolved` transitions.
- `record.test.ts` (new file):
  - `createRun` second call with the same `idempotencyKey` returns the first call's `id` (mock supabase with a queryable in-memory shim, or stub the upsert chain to assert the call shape).
- `run.test.ts` extension (existing file):
  - The integration test feeds `RunOptions.mission` through and asserts `buildOrchestratorSystemPrompt`'s `append` payload contains the mission marker. Likewise for `RunOptions.guardrails.budget` partial overrides — the merged config preserves defaults for unspecified fields.

Integration / smoke notes:

- The existing fake-`query` integration test continues to verify the run lifecycle.
- Phase 2's `ADA_PHASE2_SMOKE` runner is unchanged — it doesn't need to know about mission/budget; the operator can set the env vars before invoking to exercise the new path.

## Build order

1. Migration `024_devagent_phase2_1.sql`.
2. `record.ts` — `createRun` UPSERT + `finalizeRun` clientId parameter.
3. `ticket-update.ts` — `resolved_at` preservation + `ignoreDuplicates`.
4. `orchestrator.ts` — `{mission}` option.
5. `run.ts` — `RunOptions.mission` + forwarding.
6. `scripts/devagent.ts` — read env vars + pass to runDevAgent.
7. `sandbox.ts` — `missionOverride` + `budgetOverrideJson` arguments + env block.
8. `devagent-run.ts` — load-assignment step, pass through to runInSandbox, idempotency key, finalize-with-clientId.
9. `TicketActions.tsx` + admin status route — enum extension.
10. `devagent-cleanup` — `CRON_SECRET` guard.
11. New tests + commit.

## Out of scope (later phases)

- Phase 3 multi-tenant.
- Phase 4 reflection / playbooks.
- A real end-to-end smoke run — Phase 2 already deferred that to the operator; Phase 2.1 doesn't change the operator gate.

## Open decisions (defaults — approved with "Sent it")

1. **Mission appears BEFORE PROJECT_RULES** in the appended system prompt. Frames the task; the rules feel like guardrails.
2. **`idempotency_key` is a stored column** on `devagent_runs`, not a derived UUIDv5. Slightly more legible at the cost of one extra column.
3. **`TicketActions` includes a "Mark awaiting_review" transition for symmetry** even though typical usage is admin transitioning *out of* awaiting_review.

## Pointers

- Phase 1 spec: `docs/superpowers/specs/2026-05-28-ada-dev-agent-design.md`
- Phase 2 spec: `docs/superpowers/specs/2026-05-29-ada-dev-agent-phase-2-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-05-28-ada-dev-agent-phase-1.md`
- Phase 2 plan: `docs/superpowers/plans/2026-05-29-ada-dev-agent-phase-2.md`
- Phase 1 + 2 code: `lib/devagent/`, `lib/devagent/platform/`, `lib/inngest/functions/devagent-run.ts`, `scripts/devagent.ts`, `app/(admin)/clients/[id]/DevAgentManager.tsx`
- Nora migration (precedent): `supabase/migrations/022_nora.sql`
- Phase 2 migration (precedent for the schema patterns): `supabase/migrations/023_devagent_phase2.sql`
