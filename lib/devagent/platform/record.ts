// lib/devagent/platform/record.ts
//
// DB-backed run persistence for Ada Phase 2 (devagent_runs + last-run touches
// on client_devagent_assignments). Phase 1's lib/devagent/record.ts handles
// in-memory event logging + stdout summary; this module is the platform-side
// sink used by the Inngest function.
//
// NOTE: supabaseAdmin is imported dynamically inside each function so this
// module stays env-free at require time (mirrors trigger.ts and
// ticket-update.ts patterns).

import type { RunResult } from "@/lib/devagent/types";

export type CreateRunInput = {
  clientId: string;
  triggeringTicketId: string | null;
  trigger: "ticket" | "manual" | "scheduled";
  taskText: string;
};

export async function createRun(input: CreateRunInput): Promise<{ id: string }> {
  const { supabaseAdmin } = await import("@/lib/supabase");
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

export async function finalizeRun(args: { runId: string; result: RunResult }): Promise<void> {
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
