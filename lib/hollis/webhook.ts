import { createHmac, timingSafeEqual } from "node:crypto";

// Verifies a Retell webhook signature and parses lifecycle payloads.
//
// Confirmed against docs.retellai.com/features/secure-webhook (2026):
//   header  x-retell-signature
//   format  v={timestamp_ms},d={hex_digest}
//   digest  HMAC-SHA256(rawBody + timestamp, RETELL_API_KEY)   ← API key is the secret
//   replay  reject if timestamp is more than 5 minutes from now
// Always verify against the RAW request body string, never re-serialized JSON.

const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export function verifyRetellSignature(
  rawBody: string,
  signatureHeader: string | null,
  apiKey: string,
  nowMs: number = Date.now(),
): boolean {
  if (!signatureHeader) return false;
  const m = /^v=(\d+),d=(.*)$/.exec(signatureHeader.trim());
  if (!m) return false;
  const [, timestamp, digest] = m;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > REPLAY_WINDOW_MS) return false;

  const expected = createHmac("sha256", apiKey).update(rawBody + timestamp).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(digest);
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
  startedAt: number | null;
  endedAt: number | null;
  endReason: string | null;
  callAnalysis: unknown;
  raw: unknown;
};

type LifecyclePayload = {
  event?: string;
  call?: {
    call_id?: string;
    from_number?: string;
    to_number?: string;
    transcript?: unknown;
    transcript_object?: unknown;
    recording_url?: string;
    duration_ms?: number;
    start_timestamp?: number;
    end_timestamp?: number;
    disconnection_reason?: string;
    call_analysis?: unknown;
  };
};

// Lifecycle (post-call) webhook events: call_started | call_ended | call_analyzed.
// Each wraps a `call` object. (Distinct from the inbound webhook, which is
// handled separately and replies with call_inbound overrides.)
export function parseLifecycle(payload: unknown): ParsedLifecycle {
  const p = (payload ?? {}) as LifecyclePayload;
  const call = p.call ?? {};
  return {
    event: p.event ?? "unknown",
    retellCallId: call.call_id ?? null,
    fromNumber: call.from_number ?? null,
    toNumber: call.to_number ?? null,
    transcript: call.transcript_object ?? call.transcript ?? null,
    recordingUrl: call.recording_url ?? null,
    durationMs: typeof call.duration_ms === "number" ? call.duration_ms : null,
    startedAt: typeof call.start_timestamp === "number" ? call.start_timestamp : null,
    endedAt: typeof call.end_timestamp === "number" ? call.end_timestamp : null,
    endReason: call.disconnection_reason ?? null,
    callAnalysis: call.call_analysis ?? null,
    raw: payload,
  };
}
