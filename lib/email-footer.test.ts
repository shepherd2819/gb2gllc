// lib/email-footer.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { supportFooterText } from "./email-footer";
import { supportFooterHtml } from "./email-footer";

let _originalHomeUrl: string | undefined;
before(() => { _originalHomeUrl = process.env.NEXT_PUBLIC_HOME_URL; });
after(() => {
  if (_originalHomeUrl === undefined) delete process.env.NEXT_PUBLIC_HOME_URL;
  else process.env.NEXT_PUBLIC_HOME_URL = _originalHomeUrl;
});

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
  assert.match(html, /href="https:\/\/home\.gb2gllc\.com\/&quot;/, "double-quote in URL must be escaped to &quot;");
});

test("supportFooterHtml falls back to default URL when scheme is unsafe", () => {
  process.env.NEXT_PUBLIC_HOME_URL = "javascript:alert(1)";
  const html = supportFooterHtml();
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /https:\/\/home\.gb2gllc\.com\/tickets/);
});

test("supportFooterText falls back to default URL when scheme is unsafe", () => {
  process.env.NEXT_PUBLIC_HOME_URL = "data:text/plain,oops";
  const text = supportFooterText();
  assert.doesNotMatch(text, /data:/);
  assert.match(text, /https:\/\/home\.gb2gllc\.com\/tickets/);
});

test("supportFooterHtml normalizes a trailing slash on the home URL", () => {
  process.env.NEXT_PUBLIC_HOME_URL = "https://home.gb2gllc.com/";
  const html = supportFooterHtml();
  assert.doesNotMatch(html, /home\.gb2gllc\.com\/\/tickets/);
  assert.match(html, /href="https:\/\/home\.gb2gllc\.com\/tickets"/);
});
