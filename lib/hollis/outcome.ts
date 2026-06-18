import type { CallOutcome } from "./types";

// Derives the terminal call outcome from which tools the agent used, by priority.
// A human handoff (transfer) is the most significant result, then a booking
// request, then a captured lead, then a message. FAQ-only calls are no_action.
// ('booked' is reserved for v2 live-calendar confirmation; v1 only ever requests.)
export function deriveOutcome(input: { toolsUsed: string[] }): CallOutcome {
  const used = new Set(input.toolsUsed);
  if (used.has("transfer_to_human")) return "transfer";
  if (used.has("book_appointment")) return "booking_request";
  if (used.has("qualify_lead")) return "qualified_lead";
  if (used.has("take_message")) return "message";
  return "no_action";
}
