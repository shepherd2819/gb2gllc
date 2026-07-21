// Maps Spiro's order status to a HubSpot pipeline stage LABEL — not a raw
// stage id, since stage ids are portal-specific (assigned when the pipeline
// was created in that HubSpot account) and must be resolved against the
// live pipeline at sync time, never hardcoded. Mapping confirmed with the
// client against their actual "Order Pipeline" stages (Open, Processed,
// Shipped, Delivered, Cancelled).
const STATUS_TO_STAGE_LABEL: Record<string, string> = {
  pending: "Open",
  awaitingConfirmation: "Open",
  confirmed: "Processed",
  rescheduled: "Processed",
  inProgress: "Processed",
  appointmentCompleted: "Shipped",
  editing: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export interface PipelineStage {
  label: string;
  id: string;
}

// Returns null when the status has no mapping or the live pipeline has no
// stage with that label — callers should treat null as "don't set a stage
// this run", not as an error.
export function resolveStageId(status: string, stages: PipelineStage[]): string | null {
  const label = STATUS_TO_STAGE_LABEL[status];
  if (!label) return null;
  const match = stages.find((s) => s.label.toLowerCase() === label.toLowerCase());
  return match ? match.id : null;
}
