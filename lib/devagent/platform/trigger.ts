// lib/devagent/platform/trigger.ts
//
// Pure decision (shouldTrigger) + side-effecting helper (enqueueFromTicket)
// for the ticket-triggered Ada dispatch path. Imported by:
//   - app/api/portal/tickets/route.ts  (auto-trigger from portal POST after())
//   - lib/devagent/platform/enqueue.ts (manual-dispatch shares the event)

import { EVENT_NAMES, type DevAgentRunRequestedPayload } from "./events";

// supabaseAdmin and inngest are lazy-imported inside enqueueFromTicket so that
// importing this module (e.g. in unit tests) never triggers the Supabase client
// constructor, which throws when SUPABASE_URL env vars are absent.

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
  const { supabaseAdmin } = await import("@/lib/supabase");

  const { data: assignment } = await supabaseAdmin
    .from("client_devagent_assignments")
    .select("client_id, trigger_categories, active")
    .eq("client_id", ticket.client_id)
    .maybeSingle<Assignment>();

  if (!shouldTrigger({ assignment, ticket })) return false;

  const { inngest } = await import("@/lib/inngest/client");
  const payload: DevAgentRunRequestedPayload = {
    clientId: ticket.client_id,
    ticketId: ticket.id,
    taskText: `${ticket.subject}\n\n${ticket.body}`,
    trigger:  "ticket",
  };
  await inngest.send({ name: EVENT_NAMES.RUN_REQUESTED, data: payload });
  return true;
}
