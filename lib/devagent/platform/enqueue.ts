// lib/devagent/platform/enqueue.ts
//
// Helper for the admin manual-dispatch path. Emits the same Inngest event as
// auto-trigger, but with trigger="manual" and ticketId=null.
//
// inngest is imported dynamically to keep this module env-free at require time
// (matches the pattern in trigger.ts / ticket-update.ts / record.ts).

import { EVENT_NAMES, type DevAgentRunRequestedPayload } from "./events";

export async function enqueueManualRun(args: {
  clientId: string;
  taskText: string;
}): Promise<{ eventId: string }> {
  const { inngest } = await import("@/lib/inngest/client");
  const payload: DevAgentRunRequestedPayload = {
    clientId: args.clientId,
    ticketId: null,
    taskText: args.taskText,
    trigger:  "manual",
  };
  const sent = await inngest.send({ name: EVENT_NAMES.RUN_REQUESTED, data: payload });
  // `inngest.send` returns either an array of ids or a single object depending
  // on the input shape; this helper surfaces the first id when present.
  const id = Array.isArray((sent as { ids?: string[] }).ids)
    ? (sent as { ids: string[] }).ids[0]
    : "";
  return { eventId: id ?? "" };
}
