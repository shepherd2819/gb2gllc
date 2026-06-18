// PII redaction for transcripts before they are stored or surfaced anywhere.
// v1 declines card capture, but a caller may read a card/SSN aloud — mask it.
// Card = 13-19 digits (optionally space/dash grouped); SSN = 3-2-4. Both are
// gated tightly enough not to clobber 10-digit phone numbers.

export type TranscriptTurn = { role?: string; content?: string; text?: string };

const CARD_RE = /\b\d(?:[ -]?\d){12,18}\b/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

export function redactPII(text: string): string {
  return text
    .replace(CARD_RE, "[REDACTED_CARD]")
    .replace(SSN_RE, "[REDACTED_SSN]");
}

export function redactTranscript(turns: TranscriptTurn[]): TranscriptTurn[] {
  return turns.map((t) => ({
    ...t,
    ...(typeof t.content === "string" ? { content: redactPII(t.content) } : {}),
    ...(typeof t.text === "string" ? { text: redactPII(t.text) } : {}),
  }));
}
