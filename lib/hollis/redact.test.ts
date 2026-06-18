import { test } from "node:test";
import assert from "node:assert/strict";
import { redactPII, redactTranscript } from "./redact";

test("masks a 16-digit card number", () => {
  assert.equal(redactPII("my card is 4111 1111 1111 1111"), "my card is [REDACTED_CARD]");
});

test("masks a dashed 16-digit card number", () => {
  assert.equal(redactPII("4111-1111-1111-1111"), "[REDACTED_CARD]");
});

test("masks an SSN", () => {
  assert.equal(redactPII("ssn 123-45-6789"), "ssn [REDACTED_SSN]");
});

test("does not touch a phone number", () => {
  assert.equal(redactPII("call 831-239-8123"), "call 831-239-8123");
});

test("does not touch ordinary digits", () => {
  assert.equal(redactPII("we have 3 packages and 2 add-ons"), "we have 3 packages and 2 add-ons");
});

test("redactTranscript redacts each turn's content", () => {
  const out = redactTranscript([
    { role: "user", content: "card 4111 1111 1111 1111" },
    { role: "agent", content: "got it" },
  ]);
  assert.equal(out[0].content, "card [REDACTED_CARD]");
  assert.equal(out[1].content, "got it");
});
