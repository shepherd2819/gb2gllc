// lib/email-footer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { supportFooterText } from "./email-footer";

test("supportFooterText embeds the portal /tickets URL from NEXT_PUBLIC_HOME_URL", () => {
  process.env.NEXT_PUBLIC_HOME_URL = "https://home.gb2gllc.com";
  const out = supportFooterText();
  assert.match(out, /https:\/\/home\.gb2gllc\.com\/tickets/);
  assert.match(out, /Speak to Support|Open a ticket/);
});

test("supportFooterText is prefixed with a blank line + divider so it composes cleanly", () => {
  process.env.NEXT_PUBLIC_HOME_URL = "https://home.gb2gllc.com";
  const out = supportFooterText();
  assert.match(out, /^\n*—/m, "expected an em-dash divider at the start of a line");
});

import { supportFooterHtml } from "./email-footer";

test("supportFooterHtml renders a link button to the portal tickets URL", () => {
  process.env.NEXT_PUBLIC_HOME_URL = "https://home.gb2gllc.com";
  const html = supportFooterHtml();
  assert.match(html, /<a[^>]+href="https:\/\/home\.gb2gllc\.com\/tickets"/);
  assert.match(html, /Speak to Support/);
});

test("supportFooterHtml escapes attribute-unsafe characters in the URL", () => {
  process.env.NEXT_PUBLIC_HOME_URL = 'https://home.gb2gllc.com/"<x>';
  const html = supportFooterHtml();
  assert.doesNotMatch(html, /"<x>/, "URL must be attribute-escaped");
});
