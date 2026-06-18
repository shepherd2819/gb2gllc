import { createHmac, timingSafeEqual } from "node:crypto";

// Verifies a Retell webhook signature and parses lifecycle payloads.
//
// ⚠️ CONFIRM AGAINST docs.retellai.com: the exact signing header name and
// algorithm. This assumes HMAC-SHA256 over the raw request body, hex-encoded.
// Adjust the algorithm/encoding here (one place) if Retell differs.

export function verifyRetellSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const mac = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type ParsedLifecycle = {
  event: string;
  retellCallId: string | null;
  fromNumber: string | null;
  toNumber: string | null;
  transcript: unknown;
  recordingUrl: string | null;
  durationMs: number | null;
  startedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  raw: unknown;
};

type LifecyclePayload = {
  event?: string;
  call?: {
    call_id?: string;
    from_number?: string;
    to_number?: string;
    transcript?: unknown;
    recording_url?: string;
    duration_ms?: number;
    start_timestamp?: string;
    end_timestamp?: string;
    disconnection_reason?: string;
  };
  transcript?: unknown;
};

export function parseLifecycle(payload: unknown): ParsedLifecycle {
  const p = (payload ?? {}) as LifecyclePayload;
  const call = p.call ?? {};
  return {
    event: p.event ?? "unknown",
    retellCallId: call.call_id ?? null,
    fromNumber: call.from_number ?? null,
    toNumber: call.to_number ?? null,
    transcript: call.transcript ?? p.transcript ?? null,
    recordingUrl: call.recording_url ?? null,
    durationMs: typeof call.duration_ms === "number" ? call.duration_ms : null,
    startedAt: call.start_timestamp ?? null,
    endedAt: call.end_timestamp ?? null,
    endReason: call.disconnection_reason ?? null,
    raw: payload,
  };
}
