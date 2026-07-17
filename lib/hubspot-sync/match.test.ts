import { test } from "node:test";
import assert from "node:assert/strict";
import { matchContact } from "./match";

test("no email on the Spiro agent → unmatched no_email", () => {
  const r = matchContact(null, []);
  assert.equal(r.kind, "unmatched");
  if (r.kind === "unmatched") assert.equal(r.reason, "no_email");
});

test("zero HubSpot results → unmatched no_contact", () => {
  const r = matchContact("v@x.com", []);
  assert.equal(r.kind, "unmatched");
  if (r.kind === "unmatched") assert.equal(r.reason, "no_contact");
});

test("exactly one result → matched", () => {
  const r = matchContact("v@x.com", [{ id: "c1", email: "v@x.com" }]);
  assert.equal(r.kind, "matched");
  if (r.kind === "matched") assert.equal(r.contact.id, "c1");
});

test("more than one result → unmatched ambiguous, never guesses", () => {
  const r = matchContact("v@x.com", [
    { id: "c1", email: "v@x.com" },
    { id: "c2", email: "v@x.com" },
  ]);
  assert.equal(r.kind, "unmatched");
  if (r.kind === "unmatched") assert.equal(r.reason, "ambiguous");
});
