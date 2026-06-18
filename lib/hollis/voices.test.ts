import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveVoice, VOICE_PROFILES } from "./voices";

test("resolveVoice female returns id + default name", () => {
  const v = resolveVoice("female");
  assert.ok(v.voiceId.length > 0);
  assert.equal(v.defaultName, "Ava");
});

test("resolveVoice male returns id + default name", () => {
  const v = resolveVoice("male");
  assert.ok(v.voiceId.length > 0);
  assert.equal(v.defaultName, "Marcus");
});

test("VOICE_PROFILES has exactly two entries", () => {
  assert.deepEqual(Object.keys(VOICE_PROFILES).sort(), ["female", "male"]);
});
