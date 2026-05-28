import { test } from "node:test";
import assert from "node:assert/strict";
import { portalTicketNotificationBlocks } from "./slack-builders";

test("portalTicketNotificationBlocks includes client identity and a deep link", () => {
  const blocks = portalTicketNotificationBlocks({
    client: { name: "Jane", company: "Acme" },
    subject: "Login broken",
    body: "Can't sign in since this morning.",
    ticketId: "11111111-2222-3333-4444-555555555555",
    adminUrl: "https://admin.gb2gllc.com",
  });
  const flat = JSON.stringify(blocks);
  assert.match(flat, /Jane/);
  assert.match(flat, /Acme/);
  assert.match(flat, /Login broken/);
  assert.match(flat, /Can't sign in/);
  assert.match(flat, /https:\/\/admin\.gb2gllc\.com\/support\/11111111/);
});

test("portalTicketNotificationBlocks truncates very long bodies to ~200 chars", () => {
  const long = "x".repeat(5_000);
  const blocks = portalTicketNotificationBlocks({
    client: { name: null, company: null },
    subject: "spam",
    body: long,
    ticketId: "id",
    adminUrl: "https://admin.gb2gllc.com",
  });
  const flat = JSON.stringify(blocks);
  assert.ok(flat.length < 1500, "body should be truncated");
  assert.match(flat, /…/, "expected an ellipsis marker on truncated body");
});
