// lib/inngest/functions/devagent-run.ts
//
// Ada's run lifecycle:
//   insert devagent_runs row → post-dispatch ticket event → mark running →
//   invoke Ada in sandbox (NonRetriableError to avoid duplicate PRs) → finalize.
//
// Concurrency is limited to 1 per clientId so two simultaneous dispatches
// can't create conflicting branches or sandboxes.

import { NonRetriableError } from "inngest";
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
        idempotencyKey:     `${event.id}:insert`,
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

    // Wrap in NonRetriableError so Inngest does not retry invoke-ada on failure.
    // A retried run would clone the repo and open a duplicate PR.
    let result: RunResult;
    try {
      const outcome = await step.run("invoke-ada", async () => {
        try {
          return await runInSandbox({ taskDescription: data.taskText });
        } catch (err) {
          throw new NonRetriableError(
            err instanceof Error ? err.message : String(err),
            { cause: err }
          );
        }
      });
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
      await finalizeRun({ runId, result, clientId: data.clientId });
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
