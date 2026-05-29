//
// applyAdaEvent writes one ticket_events row AND transitions the parent
// ticket's status. The status decision is pulled out as a pure function
// (decideTicketStatus) so it's testable without supabase.

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
 *
 * NOTE: supabaseAdmin is imported dynamically inside the function so this
 * module stays env-free at require time (mirrors trigger.ts pattern), which
 * keeps decideTicketStatus pure-function tests working without env vars.
 */
export async function applyAdaEvent(input: AdaEventInput): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase");
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
