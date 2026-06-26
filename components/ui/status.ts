/** Semantic tones used by Badge / StatusPill, mapped to --color-* tokens. */
export type Tone = "sage" | "gold" | "red" | "blue" | "muted";

/**
 * Maps the real status enums across the GB2G data layer to a semantic tone.
 * Enums covered (from the migrations / spec): tickets (open|in_progress|
 * awaiting_review|resolved|closed), avery_leads (pending|researched|drafted|
 * approved|sent|rejected|failed|skipped), contracts (sent|signed|voided|
 * expired), nora_events (new|classified|sent|acknowledged|dismissed),
 * account/agent (active|paused|disabled|unconfigured), invoices
 * (draft|sent|paid|void), connections (granted|pending).
 */
const STATUS_TONE: Record<string, Tone> = {
  // success / terminal-good
  active: "sage", live: "sage", on: "sage", done: "sage", ready: "sage",
  complete: "sage", completed: "sage", resolved: "sage", granted: "sage",
  signed: "sage", paid: "sage", approved: "sage", acknowledged: "sage",
  adopted: "sage",
  // in-progress / attention
  paused: "gold", pending: "gold", in_progress: "gold", processing: "gold",
  provisioning: "gold", researched: "gold", drafted: "gold",
  awaiting_review: "gold", kickoff_scheduled: "gold", invited: "gold",
  // informational / neutral-active
  new: "blue", classified: "blue", sent: "blue", info: "blue",
  // muted / inactive
  draft: "muted", closed: "muted", skipped: "muted", idle: "muted",
  unconfigured: "muted", dismissed: "muted",
  // destructive / failure
  disabled: "red", failed: "red", rejected: "red", error: "red",
  blocked: "red", void: "red", voided: "red", expired: "red", stalled: "red",
};

export function statusTone(status: string | null | undefined): Tone {
  if (!status) return "muted";
  return STATUS_TONE[status.toLowerCase()] ?? "muted";
}

/** Human-readable label for a status enum (underscores → spaces). */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return status.replace(/_/g, " ");
}
