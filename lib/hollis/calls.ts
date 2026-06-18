// Call persistence shared by the in-call tool webhook (recordToolUse) and the
// post-call Inngest function (finalizeCall). The pure helpers (mergeCaptured,
// buildDeliveryRecord) are unit-tested; the DB helpers scope by retell_call_id
// / client_id and use supabaseAdmin.

import { deriveOutcome } from "./outcome";
import { redactPII, redactTranscript, type TranscriptTurn } from "./redact";
import type { CallOutcome, HollisLine } from "./types";
import type { DeliveryRecord, DeliveryKind } from "./delivery";
import type { ParsedLifecycle } from "./webhook";

// captured accumulates per-tool fields plus the ordered list of tools used.
export type CapturedState = { _tools: string[]; [tool: string]: unknown };

export function mergeCaptured(existing: unknown, tool: string, fields: Record<string, unknown>): CapturedState {
  const base = (existing && typeof existing === "object" ? existing : { _tools: [] }) as CapturedState;
  const tools = Array.isArray(base._tools) ? [...base._tools] : [];
  if (tool && !tools.includes(tool)) tools.push(tool);
  const prev = (base[tool] && typeof base[tool] === "object" ? base[tool] : {}) as Record<string, unknown>;
  return { ...base, _tools: tools, ...(tool ? { [tool]: { ...prev, ...fields } } : {}) };
}

const OUTCOME_TOOL: Partial<Record<CallOutcome, { kind: DeliveryKind; tool: string }>> = {
  booking_request: { kind: "booking_request", tool: "book_appointment" },
  qualified_lead: { kind: "qualified_lead", tool: "qualify_lead" },
  message: { kind: "message", tool: "take_message" },
};

// Build the business-delivery record from captured fields for the primary outcome.
// Returns null for outcomes that don't deliver anything (transfer / no_action).
export function buildDeliveryRecord(
  captured: CapturedState,
  outcome: CallOutcome,
  businessName: string,
  callId: string,
  callerNumber?: string | null,
): DeliveryRecord | null {
  const map = OUTCOME_TOOL[outcome];
  if (!map) return null;
  const raw = (captured[map.tool] && typeof captured[map.tool] === "object" ? captured[map.tool] : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const { name, phone, email, ...rest } = raw;
  const fields: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) fields[k] = v;
  }
  return {
    kind: map.kind,
    businessName,
    caller: { name: str(name), phone: str(phone), email: str(email) },
    fields,
    callId,
    callerNumber: callerNumber ?? undefined,
  };
}

function redactAnyTranscript(t: unknown): unknown {
  if (Array.isArray(t)) return redactTranscript(t as TranscriptTurn[]);
  if (typeof t === "string") return redactPII(t);
  return t ?? null;
}

// Upsert a tool use onto the in-flight call's scratch row (idempotent by call id).
export async function recordToolUse(opts: {
  lineId: string;
  clientId: string;
  retellCallId: string;
  tool: string;
  fields: Record<string, unknown>;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data: existing } = await supabaseAdmin
    .from("hollis_calls")
    .select("captured")
    .eq("retell_call_id", opts.retellCallId)
    .maybeSingle<{ captured: CapturedState }>();
  const captured = mergeCaptured(existing?.captured, opts.tool, opts.fields);
  await supabaseAdmin
    .from("hollis_calls")
    .upsert(
      { retell_call_id: opts.retellCallId, line_id: opts.lineId, client_id: opts.clientId, captured },
      { onConflict: "retell_call_id" },
    );
}

// Finalize the call row from the post-call lifecycle payload. Returns the
// derived outcome + accumulated captured fields for downstream routing/delivery.
export async function finalizeCall(
  parsed: ParsedLifecycle,
  line: HollisLine,
): Promise<{ outcome: CallOutcome; captured: CapturedState }> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data: existing } = await supabaseAdmin
    .from("hollis_calls")
    .select("captured")
    .eq("retell_call_id", parsed.retellCallId as string)
    .maybeSingle<{ captured: CapturedState }>();

  const captured = (existing?.captured ?? { _tools: [] }) as CapturedState;
  const toolsUsed = Array.isArray(captured._tools) ? captured._tools : [];
  const outcome = deriveOutcome({ toolsUsed });

  const startedAtIso = parsed.startedAt ? new Date(parsed.startedAt).toISOString() : null;
  const endedAtIso = parsed.endedAt ? new Date(parsed.endedAt).toISOString() : null;

  await supabaseAdmin.from("hollis_calls").upsert(
    {
      retell_call_id: parsed.retellCallId,
      line_id: line.id,
      client_id: line.client_id,
      caller_number: parsed.fromNumber,
      started_at: startedAtIso,
      ended_at: endedAtIso,
      duration_ms: parsed.durationMs,
      end_reason: parsed.endReason,
      transcript: redactAnyTranscript(parsed.transcript),
      recording_url: line.recording_enabled ? parsed.recordingUrl : null,
      outcome,
      disclosure_at: startedAtIso,
      recording_consent_at: line.recording_enabled ? startedAtIso : null,
    },
    { onConflict: "retell_call_id" },
  );

  return { outcome, captured };
}
