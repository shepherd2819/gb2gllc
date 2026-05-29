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

  const { error: insertErr } = await supabaseAdmin
    .from("ticket_events")
    .insert({
      ticket_id: input.ticketId,
      kind:      input.kind,
      actor:     "ada",
      payload:   { ...input.payload, run_id: input.runId },
      body:      input.body ?? null,
    });

  // PG error 23505 = unique_violation. The 025 unique partial index on
  // (ticket_id, kind, payload->>'run_id') for actor='ada' lets us safely
  // swallow this — it means an Inngest step retry already wrote the row.
  // Any other error must propagate.
  if (insertErr && insertErr.code !== "23505") {
    throw new Error(`applyAdaEvent: ticket_events insert: ${insertErr.message}`);
  }

  const patch = buildTicketUpdatePayload(input.kind, input.runId, input.payload);

  const { error: updateErr } = await supabaseAdmin
    .from("tickets")
    .update(patch)
    .eq("id", input.ticketId);

  if (updateErr) {
    throw new Error(`applyAdaEvent: tickets update: ${updateErr.message}`);
  }
}
