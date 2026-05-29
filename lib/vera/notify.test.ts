import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildForSignatureEmail,
  buildReminderEmail,
  buildSignedClientEmail,
  buildSignedAdminEmail,
  buildSignedSlackBlocks,
} from "./notify";

const baseArgs = {
  clientName: "Acme",
  clientCompany: "Acme, Inc.",
  productLabel: "Herald",
  amountFormatted: "$2,400.00",
  cadenceLabel: "per month",
  signingUrl: "https://gb2gllc.com/sign/abc123",
  notionUrl: "https://www.notion.so/page/x",
  signerName: "Jane Doe",
};

test("buildForSignatureEmail includes the signing URL and product", () => {
  const e = buildForSignatureEmail(baseArgs);
  assert.match(e.subject, /Herald/);
  assert.match(e.html, /https:\/\/gb2gllc\.com\/sign\/abc123/);
  assert.match(e.text, /https:\/\/gb2gllc\.com\/sign\/abc123/);
});

test("buildReminderEmail mentions it's a reminder", () => {
  const e = buildReminderEmail(baseArgs);
  assert.match(e.subject, /reminder/i);
  assert.match(e.html, /https:\/\/gb2gllc\.com\/sign\/abc123/);
});

test("buildSignedClientEmail thanks the client", () => {
  const e = buildSignedClientEmail({ ...baseArgs });
  assert.match(e.subject, /signed|thanks/i);
});

test("buildSignedAdminEmail names the signer", () => {
  const e = buildSignedAdminEmail({ ...baseArgs });
  assert.match(e.html, /Jane Doe/);
  assert.match(e.html, /Acme, Inc\./);
});

test("buildSignedSlackBlocks names the product and amount", () => {
  const blocks = buildSignedSlackBlocks({ ...baseArgs });
  const flat = JSON.stringify(blocks);
  assert.match(flat, /Herald/);
  assert.match(flat, /\$2,400/);
});
