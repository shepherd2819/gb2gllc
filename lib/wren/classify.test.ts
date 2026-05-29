// lib/wren/classify.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, PRIORITIES, normalizeClassification } from "./classify";

test("CATEGORIES contains the support-tuned set", () => {
  assert.deepEqual(
    [...CATEGORIES].sort(),
    ["account_help", "billing_question", "bug", "feature_request", "general", "spam"].sort()
  );
});

test("PRIORITIES is high/med/low", () => {
  assert.deepEqual([...PRIORITIES].sort(), ["high", "low", "med"].sort());
});

test("normalizeClassification coerces unknown category to 'general'", () => {
  const got = normalizeClassification({ category: "bogus", priority: "med" });
  assert.equal(got.category, "general");
});

test("normalizeClassification coerces unknown priority to 'low'", () => {
  const got = normalizeClassification({ category: "bug", priority: "URGENT" });
  assert.equal(got.priority, "low");
});

test("normalizeClassification preserves valid inputs", () => {
  const got = normalizeClassification({
    category: "account_help",
    priority: "high",
    reasoning: "r",
    suggested_action: "a",
    draft_reply: "hello",
  });
  assert.equal(got.category, "account_help");
  assert.equal(got.priority, "high");
  assert.equal(got.reasoning, "r");
  assert.equal(got.suggested_action, "a");
  assert.equal(got.draft_reply, "hello");
});

import { finalizeDraftBody } from "./classify";

let _originalHomeUrl: string | undefined;
before(() => { _originalHomeUrl = process.env.NEXT_PUBLIC_HOME_URL; });
after(() => {
  if (_originalHomeUrl === undefined) delete process.env.NEXT_PUBLIC_HOME_URL;
  else process.env.NEXT_PUBLIC_HOME_URL = _originalHomeUrl;
});

test("finalizeDraftBody strips a trailing 'Best,' sign-off from the model", () => {
  process.env.NEXT_PUBLIC_HOME_URL = "https://home.gb2gllc.com";
  const out = finalizeDraftBody("Thanks for the note — fix is going out today.\n\nBest,\nWren", undefined);
  assert.doesNotMatch(out, /\bBest,\nWren\b/);
  assert.match(out, /fix is going out today/);
});

test("finalizeDraftBody appends signature when provided, after the CTA footer", () => {
  process.env.NEXT_PUBLIC_HOME_URL = "https://home.gb2gllc.com";
  const out = finalizeDraftBody("Hi — looking into this now.", "John\nGB2GLLC");
  const idxFooter = out.indexOf("home.gb2gllc.com/tickets");
  const idxSig = out.indexOf("John\nGB2GLLC");
  assert.ok(idxFooter > 0 && idxSig > idxFooter, "signature must come after CTA footer");
});

test("finalizeDraftBody returns empty string when draft is empty", () => {
  assert.equal(finalizeDraftBody("", "John"), "");
  assert.equal(finalizeDraftBody("   ", "John"), "");
});

// Sign-off regex false-positive fix (2026-05-29):
// The previous regex stripped any line starting with Best/Thanks/etc. after a
// blank line, including legit "Thanks! …" paragraphs. The new regex requires
// the word to be followed by comma+newline, or to be an em-dash/double-dash
// divider line.

test("finalizeDraftBody does NOT strip a 'Thanks!' paragraph that's real content", () => {
  process.env.NEXT_PUBLIC_HOME_URL = "https://home.gb2gllc.com";
  const out = finalizeDraftBody("Fixed it.\n\nThanks! We really appreciate your patience.", undefined);
  assert.match(out, /Thanks! We really appreciate/);
  assert.match(out, /Fixed it/);
});

test("finalizeDraftBody does NOT strip 'Thanks for …' mid-paragraph", () => {
  process.env.NEXT_PUBLIC_HOME_URL = "https://home.gb2gllc.com";
  const out = finalizeDraftBody("Looking into it.\n\nThanks for your patience while we investigate.", undefined);
  assert.match(out, /Thanks for your patience/);
});

test("finalizeDraftBody strips an em-dash divider sign-off with name on the same line", () => {
  process.env.NEXT_PUBLIC_HOME_URL = "https://home.gb2gllc.com";
  const out = finalizeDraftBody("Fix is going out today.\n\n— Wren", undefined);
  assert.doesNotMatch(out, /— Wren/);
  assert.match(out, /Fix is going out today/);
});
