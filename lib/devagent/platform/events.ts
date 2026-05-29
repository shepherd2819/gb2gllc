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
