# Wren Support Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Wren — a Gmail support-mailbox triage agent (sibling to Iris) — together with a shared "Speak to Support" email-footer helper and a minimal portal-tickets admin surface (Slack ping + `/support` pages).

**Architecture:** Three decoupled workstreams in one PR. Wren reuses Iris's Gmail/OAuth machinery (refactored from `lib/iris/google.ts` to a shared `lib/gmail.ts` with a parameterized redirect URI). Wren follows Iris's poll → classify → label → draft → admin-approve → send loop with a support-tuned classifier and a sender→client matcher for warm context. The CTA footer helper is a small string module consumed opt-in by client-facing email templates. The portal admin surface adds a Slack notification on portal-ticket create plus `/support` list + detail pages with a Mark-resolved action.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (Postgres), Anthropic (`claude-haiku-4-5`), Gmail API (OAuth + drafts), Resend, Slack Web API (Block Kit), `node:test` for unit tests, `tsx` as the TS loader.

**Spec:** `docs/superpowers/specs/2026-05-28-wren-support-triage-design.md`

**Codebase conventions to honor:**
- Next.js 16 specifics (`AGENTS.md`): read `node_modules/next/dist/docs/` for any area before writing; `proxy.ts` is the middleware filename; async `params` (`await params`); each route group renders its own `<html>` shell.
- Auth gates: `requireAdmin()` at the top of every `/api/admin/*` route; admin pages call `withAuth()` + email check.
- Supabase: every server query via `supabaseAdmin` (service-role); every new table ends with `ENABLE ROW LEVEL SECURITY` + `"service role only" FOR ALL USING (false)`.
- No Tailwind / no UI lib; admin UI uses classes from `public/admin/admin.css`; CSS tokens (`--ink`, `--parchment`, `--dusty-blue-deep`, etc.) preserved.
- Log via `logEvent({ category, level, message, metadata })`; never throw from triggers/crons.
- Match existing manager/inbox component shape (mirror `IrisInbox.tsx` for `WrenInbox.tsx`).

**Build order (phases ship in sequence; each ends at a clean checkpoint):**
- **Phase 0** — Test runner setup (idempotent w/ Ada's plan)
- **Phase 1** — CTA footer helper + Herald digest integration
- **Phase 2** — `lib/iris/google.ts` → `lib/gmail.ts` refactor (foundation for Wren OAuth)
- **Phase 3** — Wren migration (`019_wren.sql`)
- **Phase 4** — Wren classifier (`lib/wren/classify.ts` w/ TDD)
- **Phase 5** — Wren anchor (`lib/wren/anchor.ts` w/ TDD)
- **Phase 6** — Wren poll (`lib/wren/poll.ts`)
- **Phase 7** — Wren OAuth routes
- **Phase 8** — Wren cron routes + `vercel.json`
- **Phase 9** — Wren admin API routes
- **Phase 10** — Wren admin UI + nav
- **Phase 11** — Portal admin surface (Slack + `/support` + matcher)
- **Phase 12** — Deploy env + manual `support@` connect + smoke test

---

## File structure

### New files
- `lib/email-footer.ts` — CTA helper (HTML + text)
- `lib/email-footer.test.ts` — unit tests
- `lib/gmail.ts` — moved from `lib/iris/google.ts`, redirect URI parameterized
- `lib/wren/classify.ts` — support-tuned classifier+drafter
- `lib/wren/classify.test.ts` — JSON parse, escalation, sign-off stripping
- `lib/wren/anchor.ts` — sender→client matcher
- `lib/wren/anchor.test.ts`
- `lib/wren/poll.ts` — per-account poller (mirrors `lib/iris/poll.ts`)
- `lib/slack-builders.ts` — Slack Block Kit message builders
- `lib/slack-builders.test.ts`
- `supabase/migrations/019_wren.sql`
- `app/api/wren/oauth/start/route.ts`
- `app/api/wren/oauth/callback/route.ts`
- `app/api/admin/wren/accounts/[id]/poll/route.ts`
- `app/api/admin/wren/accounts/[id]/settings/route.ts`
- `app/api/admin/wren/messages/[id]/route.ts`
- `app/api/admin/wren/messages/[id]/reclassify/route.ts`
- `app/api/admin/wren/messages/[id]/send/route.ts`
- `app/api/cron/wren-poll/route.ts`
- `app/api/cron/wren-purge/route.ts`
- `app/(admin)/agents/wren/page.tsx` — accounts list
- `app/(admin)/agents/wren/[id]/page.tsx` — inbox view (server)
- `app/(admin)/agents/wren/[id]/WrenInbox.tsx` — client component
- `app/(admin)/support/page.tsx` — tickets list
- `app/(admin)/support/[id]/page.tsx` — ticket detail
- `app/(admin)/support/[id]/TicketActions.tsx` — Mark resolved client component
- `app/api/admin/support/[id]/route.ts` — PATCH status

### Modified files
- `package.json` — add `tsx` devDep + `"test"`/`"typecheck"` scripts (skip if Ada already added)
- `lib/iris/google.ts` — **deleted** (replaced by `lib/gmail.ts`)
- `lib/iris/poll.ts` — change imports `./google` → `@/lib/gmail`
- `app/api/iris/oauth/start/route.ts` — import from `@/lib/gmail`; pass `redirectUri`
- `app/api/iris/oauth/callback/route.ts` — import from `@/lib/gmail`; pass `redirectUri`
- `lib/email-templates/herald-digest.ts` — call `supportFooterHtml()` in the body
- `lib/slack.ts` — extend `postSlackMessage` to accept optional `blocks`
- `app/api/portal/tickets/route.ts` — fire Slack notification via `after()`
- `app/(admin)/layout.tsx` — add **Wren** and **Support** nav links
- `proxy.ts` — add `"/support/:path*"` to `config.matcher`
- `vercel.json` — add `wren-poll` (every 2 min) and `wren-purge` (daily) crons
- `.env.example` — document `SUPPORT_SLACK_CHANNEL` + `SLACK_ADMIN_BOT_TOKEN`

---

## Phase 0 — Test runner setup

**Purpose:** Add `node:test` + `tsx` so we can write unit tests. **Idempotent** with Ada's plan (Ada may have already added these — check first).

### Task 0.1: Add tsx + test script to package.json (if missing)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Check whether tsx + "test" script already exist**

Run:
```bash
node -e "const p=require('./package.json'); console.log(JSON.stringify({hasTsx: !!(p.devDependencies && p.devDependencies.tsx), hasTest: !!(p.scripts && p.scripts.test), hasTypecheck: !!(p.scripts && p.scripts.typecheck)}))"
```
If output shows all three `true`, skip the rest of this task — Ada already added them; jump to Task 0.2.

- [ ] **Step 2: Install tsx as a devDependency (if missing)**

Run:
```bash
npm install -D tsx
```
Expected: tsx added under `devDependencies`.

- [ ] **Step 3: Add `test` and `typecheck` scripts (if missing)**

Edit `package.json`. Inside `"scripts"`, ensure these lines are present (do not remove existing scripts):
```json
"test": "node --import tsx --test 'lib/**/*.test.ts'",
"typecheck": "tsc --noEmit"
```

- [ ] **Step 4: Verify scripts run**

Run:
```bash
npm run typecheck
```
Expected: exits 0 (clean baseline before our changes).

Run:
```bash
npm test
```
Expected: exits 0 with "tests 0" (no tests yet — the glob has no matches; node:test exits successfully on zero tests).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add tsx + node:test scripts for unit testing

Wires up Node's built-in test runner via tsx so pure-logic units can
have unit tests without a heavyweight framework. Idempotent if Ada's
plan already added these."
```

If `git diff --cached` is empty (Ada already added everything), skip the commit and move on.

---

## Phase 1 — CTA footer helper + Herald digest integration

**Purpose:** Ship a tiny, fully-tested helper that returns the "Speak to Support" CTA footer in HTML and plain-text form, then integrate it into the Herald weekly digest so the first client-facing email sender uses it. This phase produces shippable value on its own (clients start seeing the CTA in their Herald digests).

### Task 1.1: Failing test — `supportFooterText` returns the portal URL

**Files:**
- Create: `lib/email-footer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run — expect failure**

Run:
```bash
npm test -- --test-name-pattern="supportFooterText"
```
Expected: FAIL — `Cannot find module './email-footer'`.

### Task 1.2: Implement `supportFooterText`

**Files:**
- Create: `lib/email-footer.ts`

- [ ] **Step 1: Write the minimal implementation**

```ts
// lib/email-footer.ts
//
// Shared "Speak to Support" CTA footer for client-facing system emails.
// HTML variant goes in Resend templates (Herald digest, invites, etc.);
// plain-text variant goes in Wren's Gmail drafts. Opt-in per template —
// Avery cold outreach and Iris founder drafts deliberately don't call these.

const PORTAL_URL = () => process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com";

/** Plain-text footer for Gmail drafts. Composed at the end of the draft body. */
export function supportFooterText(): string {
  return `\n—\nNeed help? Open a ticket: ${PORTAL_URL()}/tickets`;
}
```

- [ ] **Step 2: Run — expect pass**

Run:
```bash
npm test -- --test-name-pattern="supportFooterText"
```
Expected: PASS (2 tests).

### Task 1.3: Failing test — `supportFooterHtml` shape

**Files:**
- Modify: `lib/email-footer.test.ts`

- [ ] **Step 1: Append the failing test**

Append to `lib/email-footer.test.ts`:
```ts
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
```

- [ ] **Step 2: Run — expect failure**

Run:
```bash
npm test -- --test-name-pattern="supportFooterHtml"
```
Expected: FAIL — `supportFooterHtml is not exported`.

### Task 1.4: Implement `supportFooterHtml`

**Files:**
- Modify: `lib/email-footer.ts`

- [ ] **Step 1: Append the implementation**

Add at the bottom of `lib/email-footer.ts`:
```ts
/** HTML footer block for Resend templates. Matches herald-digest aesthetic. */
export function supportFooterHtml(): string {
  const url = escapeAttr(`${PORTAL_URL()}/tickets`);
  return `
  <tr>
    <td style="padding:18px 32px 24px;border-top:1px solid rgba(28,30,27,0.06);">
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8A8C85;margin-bottom:10px;">
        Need help?
      </div>
      <a href="${url}" style="display:inline-block;padding:10px 18px;background:#7F9DB9;color:#FAF6EC;text-decoration:none;border-radius:8px;font-size:13px;font-weight:500;">
        Speak to Support →
      </a>
    </td>
  </tr>`;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

- [ ] **Step 2: Run — expect pass**

Run:
```bash
npm test
```
Expected: PASS (all 4 tests).

- [ ] **Step 3: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: exit 0.

### Task 1.5: Inject `supportFooterHtml` into the Herald digest template

**Files:**
- Modify: `lib/email-templates/herald-digest.ts:127-134`

- [ ] **Step 1: Read the current footer row of `heraldDigestHtml`**

Open `lib/email-templates/herald-digest.ts` and locate the trailing `<tr>` that contains the "GloryBe2God LLC · gb2gllc.com" line (around line 127–133). The CTA goes **above** that row.

- [ ] **Step 2: Add the import + inject the footer**

At the top of `lib/email-templates/herald-digest.ts`, add:
```ts
import { supportFooterHtml } from "@/lib/email-footer";
```

Then, in the template string returned by `heraldDigestHtml`, locate the `</td></tr>` that closes the "Open your dashboard →" CTA row (around line 124–126) and the `<tr>` that opens the GloryBe2God footer (around line 127). Insert the support footer between them by replacing:

```tsx
          <tr>
            <td style="padding:16px 32px 28px;border-top:1px solid rgba(28,30,27,0.06);">
              <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#8A8C85;letter-spacing:0.06em;">
                GloryBe2God LLC · gb2gllc.com
              </div>
            </td>
          </tr>
```

with:

```tsx
          ${supportFooterHtml()}
          <tr>
            <td style="padding:16px 32px 28px;border-top:1px solid rgba(28,30,27,0.06);">
              <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#8A8C85;letter-spacing:0.06em;">
                GloryBe2God LLC · gb2gllc.com
              </div>
            </td>
          </tr>
```

- [ ] **Step 3: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: exit 0.

- [ ] **Step 4: Commit Phase 1**

```bash
git add lib/email-footer.ts lib/email-footer.test.ts lib/email-templates/herald-digest.ts
git commit -m "Add Speak to Support CTA footer; apply to Herald digest

New lib/email-footer.ts exports supportFooterHtml() (Resend templates)
and supportFooterText() (plain-text drafts). Unit tests cover URL
embedding and attribute escaping. Herald weekly digest now includes the
CTA above its brand footer; other client-facing senders opt in later."
```

---

## Phase 2 — `lib/iris/google.ts` → `lib/gmail.ts` refactor

**Purpose:** Move the Gmail/OAuth helpers out of `lib/iris/` (they aren't Iris-specific) and parameterize the redirect URI so Wren can use them with its own callback path. Behavior preserved; `tsc --noEmit` must stay clean throughout.

### Task 2.1: Move `lib/iris/google.ts` to `lib/gmail.ts` preserving git history

**Files:**
- Move: `lib/iris/google.ts` → `lib/gmail.ts`

- [ ] **Step 1: Run `git mv`**

```bash
git mv lib/iris/google.ts lib/gmail.ts
```

- [ ] **Step 2: Verify the move is staged**

```bash
git status --short
```
Expected: `R  lib/iris/google.ts -> lib/gmail.ts` (rename detected).

### Task 2.2: Parameterize `googleInstallUrl` to take a redirect URI

**Files:**
- Modify: `lib/gmail.ts`

- [ ] **Step 1: Remove the module-level `GOOGLE_REDIRECT_URI` constant**

Delete these two lines near the top of `lib/gmail.ts` (they currently look like):
```ts
const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";
export const GOOGLE_REDIRECT_URI = `${ADMIN_URL}/api/iris/oauth/callback`;
```

(The `ADMIN_URL` constant is no longer needed here either — each caller knows its own admin URL.)

- [ ] **Step 2: Change `googleInstallUrl` signature**

Replace:
```ts
export function googleInstallUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID not set");
  const url = new URL(OAUTH_AUTH);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI);
```

with:
```ts
export function googleInstallUrl(opts: { state: string; redirectUri: string }): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID not set");
  const url = new URL(OAUTH_AUTH);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
```

And further down in the same function, replace `url.searchParams.set("state", state);` with `url.searchParams.set("state", opts.state);`.

### Task 2.3: Parameterize `exchangeGoogleCode`

**Files:**
- Modify: `lib/gmail.ts`

- [ ] **Step 1: Change signature + body**

Replace:
```ts
export async function exchangeGoogleCode(code: string): Promise<GoogleTokenResponse> {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set");

  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: GOOGLE_REDIRECT_URI,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
```

with:
```ts
export async function exchangeGoogleCode(opts: { code: string; redirectUri: string }): Promise<GoogleTokenResponse> {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set");

  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
```

### Task 2.4: Update Iris's `poll.ts` import

**Files:**
- Modify: `lib/iris/poll.ts:3-11`

- [ ] **Step 1: Change the import path**

Replace:
```ts
import {
  refreshGoogleToken,
  listInboxMessageIds,
  getGmailMessage,
  parseGmailMessage,
  getOrCreateLabel,
  addLabelToMessage,
  createGmailDraft,
} from "./google";
```

with:
```ts
import {
  refreshGoogleToken,
  listInboxMessageIds,
  getGmailMessage,
  parseGmailMessage,
  getOrCreateLabel,
  addLabelToMessage,
  createGmailDraft,
} from "@/lib/gmail";
```

### Task 2.5: Update Iris OAuth start route

**Files:**
- Modify: `app/api/iris/oauth/start/route.ts`

- [ ] **Step 1: Update import + define redirectUri + pass it through**

Replace the file's contents (4-line section) so it reads:

```ts
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { googleInstallUrl } from "@/lib/gmail";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";
const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";
const IRIS_REDIRECT_URI = `${ADMIN_URL}/api/iris/oauth/callback`;

// GET /api/iris/oauth/start
// Admin clicks "Connect inbox" → we generate a state nonce, set a cookie,
// and redirect to Google. State format: `<workos-user-id>:<nonce>`.
export async function GET(_req: NextRequest) {
  const { user } = await withAuth();
  if (!user) return NextResponse.redirect(new URL("/auth/signin?next=/agents/iris", _req.url));
  if (user.email !== ADMIN_EMAIL) return NextResponse.redirect(new URL("/auth/no-account", _req.url));

  const nonce = randomBytes(16).toString("hex");
  const state = `${user.id}:${nonce}`;
  const url = googleInstallUrl({ state, redirectUri: IRIS_REDIRECT_URI });

  const res = NextResponse.redirect(url);
  res.cookies.set("iris_install_state", state, {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/", domain: ".gb2gllc.com",
  });
  return res;
}
```

### Task 2.6: Update Iris OAuth callback route

**Files:**
- Modify: `app/api/iris/oauth/callback/route.ts`

- [ ] **Step 1: Update import + add redirectUri constant + pass it to exchangeGoogleCode**

In `app/api/iris/oauth/callback/route.ts`, change the import line:
```ts
import { exchangeGoogleCode, getGoogleUserInfo, getGmailProfile, getGmailSendAs } from "@/lib/iris/google";
```
to:
```ts
import { exchangeGoogleCode, getGoogleUserInfo, getGmailProfile, getGmailSendAs } from "@/lib/gmail";
```

Add this constant below the existing `ADMIN_URL` line:
```ts
const IRIS_REDIRECT_URI = `${ADMIN_URL}/api/iris/oauth/callback`;
```

And change the call:
```ts
token = await exchangeGoogleCode(code);
```
to:
```ts
token = await exchangeGoogleCode({ code, redirectUri: IRIS_REDIRECT_URI });
```

### Task 2.7: Verify the refactor

- [ ] **Step 1: Typecheck**

```bash
npm run typecheck
```
Expected: exit 0, zero errors.

- [ ] **Step 2: Grep for stale `./google` imports**

```bash
git grep -n "from \"./google\"\\|from '\\./google'" -- 'lib/' 'app/' || echo "NONE — good"
```
Expected: `NONE — good`.

- [ ] **Step 3: Grep that `lib/iris/google.ts` is gone**

```bash
ls lib/iris/ 2>&1
```
Expected: shows `classify.ts`, `poll.ts` — no `google.ts`.

- [ ] **Step 4: Commit Phase 2**

```bash
git add lib/gmail.ts lib/iris/poll.ts app/api/iris/oauth/start/route.ts app/api/iris/oauth/callback/route.ts
git commit -m "Move lib/iris/google.ts to lib/gmail.ts; parameterize redirect URI

The Gmail/OAuth helpers aren't Iris-specific — Wren needs them too. Move
the file to lib/gmail.ts (preserving git history via git mv) and turn
the previously-hardcoded redirect URI into a parameter on
googleInstallUrl and exchangeGoogleCode. Iris's OAuth routes now pass
their own redirectUri; behavior unchanged. tsc --noEmit clean."
```

---

## Phase 3 — Wren migration `019_wren.sql`

### Task 3.1: Write the migration

**Files:**
- Create: `supabase/migrations/019_wren.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- 019_wren.sql — Wren (support-mailbox triage agent, sibling to Iris)
-- ============================================================
-- Admin-only tool. Single Google account connected at support@gb2gllc.com
-- (the schema supports many, but v1 uses one). Mirrors 018_iris_inbox.sql
-- with: support-tuned categories, a matched_client_id reference for warm
-- context, and a Wren/{category} Gmail label namespace.
--
-- Pipeline: poll Gmail every 2m → classify w/ Haiku → label in Gmail +
-- (optionally) save a draft reply in the thread → surface in /agents/wren.
-- No auto-send. Human approves every send.

CREATE TABLE wren_inbox_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_user_id    TEXT NOT NULL,
  provider          TEXT NOT NULL DEFAULT 'gmail' CHECK (provider IN ('gmail')),
  email_address     TEXT NOT NULL,
  aliases           TEXT[] NOT NULL DEFAULT '{}',
  access_token      TEXT NOT NULL,
  refresh_token     TEXT NOT NULL,
  token_expires_at  TIMESTAMPTZ NOT NULL,
  scope             TEXT,
  history_id        TEXT,
  last_polled_at    TIMESTAMPTZ,
  last_poll_error   TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workos_user_id, email_address)
);

CREATE INDEX idx_wren_accounts_status ON wren_inbox_accounts(status) WHERE status = 'active';

CREATE TABLE wren_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES wren_inbox_accounts(id) ON DELETE CASCADE,
  gmail_message_id    TEXT NOT NULL,
  gmail_thread_id     TEXT NOT NULL,
  from_email          TEXT,
  from_name           TEXT,
  to_addresses        TEXT[] NOT NULL DEFAULT '{}',
  delivered_to        TEXT,
  subject             TEXT,
  snippet             TEXT,
  received_at         TIMESTAMPTZ NOT NULL,
  body_text           TEXT,
  body_html           TEXT,
  body_purged_at      TIMESTAMPTZ,
  category            TEXT,    -- bug | feature_request | account_help | billing_question | general | spam
  priority            TEXT,    -- high | med | low
  reasoning           TEXT,
  suggested_action    TEXT,
  draft_reply         TEXT,
  matched_client_id   UUID REFERENCES clients(id),
  classified_at       TIMESTAMPTZ,
  classify_model      TEXT,
  classify_error      TEXT,
  gmail_draft_id      TEXT,
  gmail_label_id      TEXT,
  status              TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'classified', 'sent', 'archived', 'flagged'
  )),
  sent_at             TIMESTAMPTZ,
  archived_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, gmail_message_id)
);

CREATE INDEX idx_wren_messages_account_received ON wren_messages(account_id, received_at DESC);
CREATE INDEX idx_wren_messages_status           ON wren_messages(account_id, status, received_at DESC);
CREATE INDEX idx_wren_messages_category         ON wren_messages(account_id, category, received_at DESC);
CREATE INDEX idx_wren_messages_pending_classify ON wren_messages(account_id) WHERE status = 'new';
CREATE INDEX idx_wren_messages_purge_candidates ON wren_messages(received_at) WHERE body_purged_at IS NULL;

CREATE TABLE wren_settings (
  account_id              UUID PRIMARY KEY REFERENCES wren_inbox_accounts(id) ON DELETE CASCADE,
  draft_categories        TEXT[] NOT NULL DEFAULT ARRAY['bug','feature_request','account_help','billing_question','general']::TEXT[],
  ignore_from_patterns    TEXT[] NOT NULL DEFAULT ARRAY['noreply@','no-reply@','donotreply@','mailer-daemon@']::TEXT[],
  voice_notes             TEXT,
  signature               TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wren_inbox_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wren_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE wren_settings       ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON wren_inbox_accounts FOR ALL USING (false);
CREATE POLICY "service role only" ON wren_messages       FOR ALL USING (false);
CREATE POLICY "service role only" ON wren_settings       FOR ALL USING (false);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/019_wren.sql
git commit -m "Add 019_wren.sql migration for support-mailbox triage agent

Mirrors 018_iris_inbox.sql shape with: support-tuned default categories,
matched_client_id FK for warm draft context, indexes parallel to Iris's,
and service-role-only RLS on all three tables."
```

> **Note for the engineer:** the migration is not applied here. Apply manually via `supabase db push` (or the Supabase dashboard SQL editor) when ready to test — same workflow as 018.

---

## Phase 4 — Wren classifier (`lib/wren/classify.ts`)

**Purpose:** The Haiku-powered classifier+drafter. Mirrors `lib/iris/classify.ts` in shape (`Classification` type, JSON-only output, sign-off stripping, signature append) but with support-tuned categories, warm-context injection, and the CTA footer appended *between* draft body and signature.

### Task 4.1: Failing test — category normalization

**Files:**
- Create: `lib/wren/classify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/wren/classify.test.ts
import { test } from "node:test";
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
```

- [ ] **Step 2: Run — expect failure**

Run:
```bash
npm test -- --test-name-pattern="CATEGORIES|PRIORITIES|normalizeClassification"
```
Expected: FAIL — module not found.

### Task 4.2: Implement classifier scaffolding (constants + normalizer)

**Files:**
- Create: `lib/wren/classify.ts`

- [ ] **Step 1: Write the minimal scaffolding**

```ts
// lib/wren/classify.ts
//
// Wren — support-mailbox triage classifier + drafter. Mirrors lib/iris/classify.ts
// in shape but tuned for support emails: support-specific category set, warm
// client-context injection, and the Speak-to-Support CTA appended between
// draft body and signature.

import { anthropic } from "@/lib/anthropic";
import { supportFooterText } from "@/lib/email-footer";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1_500;

export const CATEGORIES = [
  "bug",
  "feature_request",
  "account_help",
  "billing_question",
  "general",
  "spam",
] as const;

export const PRIORITIES = ["high", "med", "low"] as const;

export type Classification = {
  category: (typeof CATEGORIES)[number];
  priority: (typeof PRIORITIES)[number];
  reasoning: string;
  suggested_action: string;
  draft_reply: string;
};

export type MatchedClient = {
  id: string;
  name: string | null;
  company: string | null;
  active_products: string[];
  recent_logs_summary: string | null;
};

export type ClassifyInput = {
  from_email: string;
  from_name: string | null;
  delivered_to: string | null;
  subject: string;
  body_text: string;
  voice_notes?: string;
  signature?: string;
  draft_categories: string[];
  matched_client?: MatchedClient | null;
};

/** Defensively normalize a possibly-malformed model response. Used by the classifier and by tests. */
export function normalizeClassification(raw: Partial<Classification> | Record<string, unknown>): Classification {
  const cat = String(raw.category ?? "").toLowerCase();
  const pri = String(raw.priority ?? "").toLowerCase();
  return {
    category: (CATEGORIES as readonly string[]).includes(cat)
      ? (cat as Classification["category"])
      : "general",
    priority: (PRIORITIES as readonly string[]).includes(pri)
      ? (pri as Classification["priority"])
      : "low",
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning.trim() : "",
    suggested_action: typeof raw.suggested_action === "string" ? raw.suggested_action.trim() : "",
    draft_reply: typeof raw.draft_reply === "string" ? raw.draft_reply : "",
  };
}

export const MODEL_NAME = MODEL;
```

- [ ] **Step 2: Run — expect pass**

Run:
```bash
npm test -- --test-name-pattern="CATEGORIES|PRIORITIES|normalizeClassification"
```
Expected: PASS (5 tests).

### Task 4.3: Failing test — sign-off stripping + signature append

**Files:**
- Modify: `lib/wren/classify.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `lib/wren/classify.test.ts`:
```ts
import { finalizeDraftBody } from "./classify";

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
```

- [ ] **Step 2: Run — expect failure**

Run:
```bash
npm test -- --test-name-pattern="finalizeDraftBody"
```
Expected: FAIL — `finalizeDraftBody is not exported`.

### Task 4.4: Implement `finalizeDraftBody`

**Files:**
- Modify: `lib/wren/classify.ts`

- [ ] **Step 1: Append the implementation**

Add at the bottom of `lib/wren/classify.ts`:
```ts
/**
 * Assemble the final draft body that gets written to the Gmail draft:
 * `{model draft}\n\n{CTA footer}\n\n{signature}`
 *
 * - Strips the model's well-meaning sign-off (Best/Thanks/Cheers/etc.) since we
 *   always append our own signature and double sign-offs look silly.
 * - Returns "" if the input draft is empty/whitespace.
 */
export function finalizeDraftBody(draft: string, signature: string | undefined): string {
  let body = draft.replace(/\n+(best|thanks|thank you|cheers|sincerely|warmly|regards|—|--)[\s\S]*$/i, "").trim();
  if (!body) return "";
  body = `${body}\n${supportFooterText()}`;
  if (signature?.trim()) body = `${body}\n\n${signature.trim()}`;
  return body;
}
```

- [ ] **Step 2: Run — expect pass**

Run:
```bash
npm test -- --test-name-pattern="finalizeDraftBody"
```
Expected: PASS (3 tests).

### Task 4.5: Implement `classifyAndDraft` (the I/O method calling Anthropic)

**Files:**
- Modify: `lib/wren/classify.ts`

- [ ] **Step 1: Append the main classifier**

Add at the bottom of `lib/wren/classify.ts`:
```ts
export async function classifyAndDraft(input: ClassifyInput): Promise<Classification> {
  const system = `You are Wren, a support-mailbox triage agent for GB2GLLC (a faith-rooted, business-first AI software studio). For every incoming support email:

1. Classify it into ONE category from this exact list:
   ${CATEGORIES.join(", ")}

2. Assign a priority:
   - high → needs a same-day human reply (paying customer in trouble, outage, time-sensitive ask)
   - med  → reply within a few days (normal support question, account question)
   - low  → can wait or doesn't need a reply (FYI, vague follow-up, spam)

3. Write a one-sentence "suggested_action" (e.g. "Reply with reset instructions", "Investigate bug", "Archive — spam", "Escalate to founder").

4. If the category is one of: ${input.draft_categories.join(", ")} — AND a reply is actually warranted — write a "draft_reply" body. Otherwise return "" for draft_reply.

Draft-reply rules:
- Plain text. No markdown, no bullet points unless natural.
- GB2G voice: warm, direct, plain-spoken. No jargon, no hype. No exclamation points unless the sender used them first.
- Address the sender by first name if known.
- DO NOT invent commitments, pricing, calendar slots, links, or specifics not in the original email or warm-client context. If you'd need info you don't have, write a short reply that asks for it.
- DO NOT include a signature — one will be appended automatically.
- Length: 2–5 sentences for most. Longer only if the sender asked multiple distinct questions.
- If the email is hostile, legal, asks for a refund, or is clearly outside what a polite assistant should answer without the founder, leave draft_reply as "" and set suggested_action to "Founder must reply personally".

${input.matched_client ? `Warm client context (this sender is a known client):
- Name: ${input.matched_client.name ?? "(unknown)"}
- Company: ${input.matched_client.company ?? "(unknown)"}
- Active products: ${input.matched_client.active_products.join(", ") || "(none)"}
- Recent activity: ${input.matched_client.recent_logs_summary ?? "(none)"}
Use this context to ground the reply, but don't recite it back at them.\n` : ""}
Voice notes from the founder:
${input.voice_notes?.trim() || "(none — use default warm/direct style)"}

Return ONLY a single valid JSON object. No prose, no markdown fences.

{
  "category": "${CATEGORIES.join(" | ")}",
  "priority": "${PRIORITIES.join(" | ")}",
  "reasoning": "<1-2 sentence explanation of category + priority>",
  "suggested_action": "<short imperative phrase>",
  "draft_reply": "<body text OR empty string>"
}`;

  const userMsg = `From: ${input.from_name ?? "(no name)"} <${input.from_email}>
To (alias hit): ${input.delivered_to ?? "(unknown)"}
Subject: ${input.subject || "(no subject)"}

----- BODY -----
${input.body_text.slice(0, 8_000)}
----- END BODY -----

Classify and (if appropriate) draft. JSON only.`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: userMsg }],
  });

  const raw = (res.content[0]?.type === "text" ? res.content[0].text : "").trim();
  const jsonStr = raw.startsWith("```")
    ? raw.replace(/^```(?:json)?/, "").replace(/```$/, "").trim()
    : raw;

  let parsed: Partial<Classification>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Wren classifier returned non-JSON: ${raw.slice(0, 200)}`);
  }

  const normalized = normalizeClassification(parsed);
  return {
    ...normalized,
    draft_reply: finalizeDraftBody(normalized.draft_reply, input.signature),
  };
}
```

- [ ] **Step 2: Typecheck + test pass**

```bash
npm run typecheck && npm test -- --test-name-pattern="CATEGORIES|PRIORITIES|normalizeClassification|finalizeDraftBody"
```
Expected: typecheck exit 0; all 8 tests pass.

- [ ] **Step 3: Commit Phase 4**

```bash
git add lib/wren/classify.ts lib/wren/classify.test.ts
git commit -m "Add Wren classifier with support-tuned categories

lib/wren/classify.ts mirrors lib/iris/classify.ts shape but uses
support categories (bug/feature_request/account_help/billing_question/
general/spam), takes warm client context, and final-assembles the
draft body as {model draft}\\n\\n{CTA footer}\\n\\n{signature}. Pure
helpers (normalizeClassification, finalizeDraftBody) have unit tests."
```

---

## Phase 5 — Wren anchor (`lib/wren/anchor.ts`)

**Purpose:** Given an inbound message's `from_email`, look up a matching `clients` row and hydrate warm context for the classifier. Pure DB query; isolated for testability.

### Task 5.1: Failing test — match by exact email (case-insensitive)

**Files:**
- Create: `lib/wren/anchor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/wren/anchor.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeRecentLogs } from "./anchor";

test("summarizeRecentLogs returns null for empty input", () => {
  assert.equal(summarizeRecentLogs([]), null);
});

test("summarizeRecentLogs joins up to 3 recent entries with dates", () => {
  const out = summarizeRecentLogs([
    { created_at: "2026-05-27T10:00:00Z", message: "Herald digest sent" },
    { created_at: "2026-05-26T10:00:00Z", message: "Onboarding step 2 done" },
    { created_at: "2026-05-25T10:00:00Z", message: "Account created" },
    { created_at: "2026-05-24T10:00:00Z", message: "Should be dropped" },
  ]);
  assert.ok(out && out.includes("Herald digest sent"));
  assert.ok(out && out.includes("Onboarding step 2 done"));
  assert.ok(out && out.includes("Account created"));
  assert.ok(out && !out.includes("Should be dropped"));
});
```

- [ ] **Step 2: Run — expect failure**

Run:
```bash
npm test -- --test-name-pattern="summarizeRecentLogs"
```
Expected: FAIL — module not found.

### Task 5.2: Implement anchor

**Files:**
- Create: `lib/wren/anchor.ts`

- [ ] **Step 1: Write the implementation**

```ts
// lib/wren/anchor.ts
//
// Match an inbound support email's sender to a known client and hydrate
// the warm context the classifier uses to ground its draft. Single I/O
// function (findClientForSender) plus a pure summary helper that's tested.

import { supabaseAdmin } from "@/lib/supabase";
import type { MatchedClient } from "./classify";

type LogEntry = { created_at: string; message: string };

/** Pure: format the last 3 client_logs into a one-line summary. */
export function summarizeRecentLogs(logs: LogEntry[]): string | null {
  if (!logs.length) return null;
  const top = logs.slice(0, 3).map((l) => {
    const d = new Date(l.created_at);
    const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${day}: ${l.message}`;
  });
  return top.join(" · ");
}

/**
 * Look up a client by sender email (case-insensitive). Returns null if no
 * matching client. When a match is found, also hydrates active products and
 * a short recent-logs summary for the classifier prompt.
 */
export async function findClientForSender(fromEmail: string): Promise<MatchedClient | null> {
  const email = fromEmail.trim().toLowerCase();
  if (!email) return null;

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name, company")
    .ilike("email", email)
    .maybeSingle<{ id: string; name: string | null; company: string | null }>();
  if (!client) return null;

  const [{ data: products }, { data: logs }] = await Promise.all([
    supabaseAdmin.from("client_products").select("product").eq("client_id", client.id).eq("active", true),
    supabaseAdmin
      .from("client_logs")
      .select("created_at, message")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  return {
    id: client.id,
    name: client.name,
    company: client.company,
    active_products: (products ?? []).map((p: { product: string }) => p.product),
    recent_logs_summary: summarizeRecentLogs((logs ?? []) as LogEntry[]),
  };
}
```

- [ ] **Step 2: Run — expect pass**

Run:
```bash
npm test -- --test-name-pattern="summarizeRecentLogs"
```
Expected: PASS (2 tests).

- [ ] **Step 3: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: exit 0.

- [ ] **Step 4: Commit Phase 5**

```bash
git add lib/wren/anchor.ts lib/wren/anchor.test.ts
git commit -m "Add Wren anchor: sender→client matching for warm draft context

findClientForSender looks up a client by sender email and hydrates
{name, company, active_products, recent_logs_summary} for the
classifier prompt. summarizeRecentLogs is a pure formatter with
unit tests."
```

---

## Phase 6 — Wren poll (`lib/wren/poll.ts`)

**Purpose:** Per-account poller that mirrors `lib/iris/poll.ts` with three deltas: uses `wren_*` tables, calls `findClientForSender` before classify, and labels with `Wren/{category}` instead of `Iris/{category}`.

### Task 6.1: Write `lib/wren/poll.ts`

**Files:**
- Create: `lib/wren/poll.ts`

- [ ] **Step 1: Write the file**

```ts
// lib/wren/poll.ts
//
// Per-account poller for Wren — the support-mailbox triage agent.
// Mirrors lib/iris/poll.ts with three deltas: uses wren_* tables,
// calls findClientForSender before classify, and labels with
// Wren/{category} instead of Iris/{category}.

import { supabaseAdmin } from "@/lib/supabase";
import { logEvent } from "@/lib/logger";
import {
  refreshGoogleToken,
  listInboxMessageIds,
  getGmailMessage,
  parseGmailMessage,
  getOrCreateLabel,
  addLabelToMessage,
  createGmailDraft,
} from "@/lib/gmail";
import type { ParsedMessage } from "@/lib/gmail";
import { classifyAndDraft, MODEL_NAME } from "./classify";
import type { Classification } from "./classify";
import { findClientForSender } from "./anchor";

const LOOKBACK_SEC = 60 * 10;             // 10 min — 2x the cron interval
const MAX_PER_POLL_PER_ACCOUNT = 25;

export type AccountRow = {
  id: string;
  workos_user_id: string;
  email_address: string;
  aliases: string[];
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  history_id: string | null;
  status: "active" | "paused" | "revoked";
};

export type SettingsRow = {
  account_id: string;
  draft_categories: string[];
  ignore_from_patterns: string[];
  voice_notes: string | null;
  signature: string | null;
};

export type PollResult = {
  account_id: string;
  email: string;
  fetched: number;
  classified: number;
  drafted: number;
  skipped: number;
  errors: string[];
};

export async function pollAccount(accountId: string): Promise<PollResult> {
  const { data: acct, error: acctErr } = await supabaseAdmin
    .from("wren_inbox_accounts")
    .select("*")
    .eq("id", accountId)
    .single<AccountRow>();

  if (acctErr || !acct) {
    return { account_id: accountId, email: "", fetched: 0, classified: 0, drafted: 0, skipped: 0, errors: [`account not found: ${acctErr?.message}`] };
  }
  if (acct.status !== "active") {
    return { account_id: acct.id, email: acct.email_address, fetched: 0, classified: 0, drafted: 0, skipped: 0, errors: [`account status=${acct.status}`] };
  }

  const result: PollResult = {
    account_id: acct.id,
    email: acct.email_address,
    fetched: 0,
    classified: 0,
    drafted: 0,
    skipped: 0,
    errors: [],
  };

  // Refresh access token if expiring within 60s.
  let accessToken = acct.access_token;
  try {
    accessToken = await ensureFreshToken(acct);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markPollError(acct.id, `token refresh: ${msg}`);
    result.errors.push(`token refresh: ${msg}`);
    return result;
  }

  // Settings (or defaults).
  const { data: settingsRow } = await supabaseAdmin
    .from("wren_settings")
    .select("*")
    .eq("account_id", acct.id)
    .maybeSingle<SettingsRow>();
  const settings: SettingsRow = settingsRow ?? {
    account_id: acct.id,
    draft_categories: ["bug", "feature_request", "account_help", "billing_question", "general"],
    ignore_from_patterns: ["noreply@", "no-reply@", "donotreply@", "mailer-daemon@"],
    voice_notes: null,
    signature: null,
  };

  // 1. List recent inbox ids.
  const afterSec = Math.floor(Date.now() / 1000) - LOOKBACK_SEC;
  let ids: string[] = [];
  try {
    const list = await listInboxMessageIds(accessToken, { afterSec, maxResults: MAX_PER_POLL_PER_ACCOUNT });
    ids = list.ids;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markPollError(acct.id, `messages.list: ${msg}`);
    result.errors.push(`messages.list: ${msg}`);
    return result;
  }

  // 2. Dedupe against what we already have.
  if (ids.length) {
    const { data: existing } = await supabaseAdmin
      .from("wren_messages")
      .select("gmail_message_id")
      .eq("account_id", acct.id)
      .in("gmail_message_id", ids);
    const seen = new Set((existing ?? []).map((r: { gmail_message_id: string }) => r.gmail_message_id));
    ids = ids.filter((id) => !seen.has(id));
  }

  // 3. For each new message: fetch, ingest, anchor, classify, label, draft.
  for (const id of ids) {
    try {
      const msg = await getGmailMessage(accessToken, id);
      const parsed = parseGmailMessage(msg);
      result.fetched++;

      const ignore = shouldIgnore(parsed, settings.ignore_from_patterns);
      const inserted = await insertMessage(acct.id, parsed);
      if (!inserted) { result.skipped++; continue; }

      if (ignore) {
        await markIgnored(inserted.id, "ignored by from-pattern");
        result.skipped++;
        continue;
      }

      // Warm context: try to match the sender to a known client.
      const matched = parsed.from_email ? await findClientForSender(parsed.from_email).catch(() => null) : null;

      // Classify.
      let classification: Classification;
      try {
        classification = await classifyAndDraft({
          from_email: parsed.from_email ?? "(unknown)",
          from_name: parsed.from_name,
          delivered_to: parsed.delivered_to,
          subject: parsed.subject,
          body_text: parsed.body_text,
          voice_notes: settings.voice_notes ?? undefined,
          signature: settings.signature ?? undefined,
          draft_categories: settings.draft_categories,
          matched_client: matched,
        });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        await markClassifyError(inserted.id, m);
        result.errors.push(`classify ${id}: ${m}`);
        continue;
      }
      result.classified++;

      // Label.
      let labelId: string | null = null;
      try {
        labelId = await getOrCreateLabel(accessToken, `Wren/${classification.category}`);
        await addLabelToMessage(accessToken, parsed.id, labelId);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        result.errors.push(`label ${id}: ${m}`);
      }

      // Draft.
      let draftId: string | null = null;
      if (classification.draft_reply && parsed.from_email) {
        try {
          const fromAlias = parsed.delivered_to || acct.email_address;
          const messageIdHeader = headerValue(msg.payload?.headers, "Message-Id");
          const replySubject = parsed.subject || "(no subject)";
          const draft = await createGmailDraft(accessToken, {
            threadId: parsed.threadId,
            to: parsed.from_email,
            from: fromAlias,
            inReplyToMessageId: messageIdHeader || undefined,
            subject: replySubject,
            body: classification.draft_reply,
          });
          draftId = draft.id;
          result.drafted++;
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          result.errors.push(`draft ${id}: ${m}`);
        }
      }

      // Persist classification + artifact ids.
      await supabaseAdmin
        .from("wren_messages")
        .update({
          category: classification.category,
          priority: classification.priority,
          reasoning: classification.reasoning,
          suggested_action: classification.suggested_action,
          draft_reply: classification.draft_reply || null,
          matched_client_id: matched?.id ?? null,
          classified_at: new Date().toISOString(),
          classify_model: MODEL_NAME,
          gmail_label_id: labelId,
          gmail_draft_id: draftId,
          status: "classified",
          updated_at: new Date().toISOString(),
        })
        .eq("id", inserted.id);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      result.errors.push(`${id}: ${m}`);
    }
  }

  await supabaseAdmin
    .from("wren_inbox_accounts")
    .update({
      last_polled_at: new Date().toISOString(),
      last_poll_error: result.errors.length ? result.errors.slice(0, 3).join(" | ").slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", acct.id);

  if (result.fetched || result.errors.length) {
    await logEvent({
      category: "system",
      level: result.errors.length ? "warn" : "info",
      message: `Wren poll ${acct.email_address}: ${result.fetched} new, ${result.classified} classified, ${result.drafted} drafted, ${result.skipped} skipped, ${result.errors.length} errors`,
      metadata: { account_id: acct.id, errors: result.errors.slice(0, 5) },
    });
  }

  return result;
}

export async function pollAllActiveAccounts(): Promise<PollResult[]> {
  const { data: accounts } = await supabaseAdmin
    .from("wren_inbox_accounts")
    .select("id")
    .eq("status", "active");
  const results: PollResult[] = [];
  for (const a of accounts ?? []) results.push(await pollAccount(a.id));
  return results;
}

// ─── helpers (parallel to lib/iris/poll.ts) ───────────────────────────────

async function ensureFreshToken(acct: AccountRow): Promise<string> {
  const expiresAt = new Date(acct.token_expires_at).getTime();
  if (Date.now() < expiresAt - 60_000) return acct.access_token;
  const refreshed = await refreshGoogleToken(acct.refresh_token);
  const newExpires = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await supabaseAdmin
    .from("wren_inbox_accounts")
    .update({
      access_token: refreshed.access_token,
      token_expires_at: newExpires,
      ...(refreshed.refresh_token ? { refresh_token: refreshed.refresh_token } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", acct.id);
  return refreshed.access_token;
}

function shouldIgnore(p: ParsedMessage, patterns: string[]): boolean {
  if (!p.from_email) return true;
  const from = p.from_email.toLowerCase();
  for (const pat of patterns) {
    if (!pat) continue;
    if (from.includes(pat.toLowerCase())) return true;
  }
  return false;
}

async function insertMessage(accountId: string, p: ParsedMessage): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("wren_messages")
    .insert({
      account_id: accountId,
      gmail_message_id: p.id,
      gmail_thread_id: p.threadId,
      from_email: p.from_email,
      from_name: p.from_name,
      to_addresses: p.to_addresses,
      delivered_to: p.delivered_to,
      subject: p.subject,
      snippet: p.snippet,
      received_at: p.received_at,
      body_text: p.body_text || null,
      body_html: p.body_html || null,
      status: "new",
    })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    if (error.code === "23505") return null; // duplicate from a concurrent poll — fine
    throw new Error(`insert ${p.id}: ${error.message}`);
  }
  return data ?? null;
}

async function markIgnored(messageId: string, reason: string): Promise<void> {
  await supabaseAdmin
    .from("wren_messages")
    .update({
      category: "spam",
      priority: "low",
      reasoning: reason,
      suggested_action: "Archive — auto-ignored",
      status: "classified",
      classified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", messageId);
}

async function markClassifyError(messageId: string, error: string): Promise<void> {
  await supabaseAdmin
    .from("wren_messages")
    .update({ classify_error: error.slice(0, 1000), updated_at: new Date().toISOString() })
    .eq("id", messageId);
}

async function markPollError(accountId: string, error: string): Promise<void> {
  await supabaseAdmin
    .from("wren_inbox_accounts")
    .update({
      last_polled_at: new Date().toISOString(),
      last_poll_error: error.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);
}

function headerValue(headers: { name: string; value: string }[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: exit 0.

> **Note:** `logEvent` accepts `category` from a fixed set in `lib/logger.ts` (`herald | intake | steward | system`). Wren logs under `system` until/unless `wren` is added to the union — keep it simple for now.

- [ ] **Step 3: Commit Phase 6**

```bash
git add lib/wren/poll.ts
git commit -m "Add Wren per-account poller

Mirrors lib/iris/poll.ts: list new inbox ids since lookback, dedupe by
UNIQUE(account_id, gmail_message_id), classify with Haiku (warm client
context via findClientForSender), label Wren/{category}, save a Gmail
draft in-thread when warranted. logEvent on summary/error."
```

---

## Phase 7 — Wren OAuth routes

**Purpose:** Mirror of Iris's OAuth start + callback, pointed at the `wren_inbox_accounts` table and the `/agents/wren` landing page.

### Task 7.1: Write OAuth start route

**Files:**
- Create: `app/api/wren/oauth/start/route.ts`

- [ ] **Step 1: Write the file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { googleInstallUrl } from "@/lib/gmail";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";
const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";
const WREN_REDIRECT_URI = `${ADMIN_URL}/api/wren/oauth/callback`;

// GET /api/wren/oauth/start
// Admin clicks "Connect mailbox" → generate state nonce, set cookie, redirect to Google.
export async function GET(_req: NextRequest) {
  const { user } = await withAuth();
  if (!user) return NextResponse.redirect(new URL("/auth/signin?next=/agents/wren", _req.url));
  if (user.email !== ADMIN_EMAIL) return NextResponse.redirect(new URL("/auth/no-account", _req.url));

  const nonce = randomBytes(16).toString("hex");
  const state = `${user.id}:${nonce}`;
  const url = googleInstallUrl({ state, redirectUri: WREN_REDIRECT_URI });

  const res = NextResponse.redirect(url);
  res.cookies.set("wren_install_state", state, {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/", domain: ".gb2gllc.com",
  });
  return res;
}
```

### Task 7.2: Write OAuth callback route

**Files:**
- Create: `app/api/wren/oauth/callback/route.ts`

- [ ] **Step 1: Write the file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exchangeGoogleCode, getGoogleUserInfo, getGmailProfile, getGmailSendAs } from "@/lib/gmail";
import { logEvent } from "@/lib/logger";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";
const WREN_REDIRECT_URI = `${ADMIN_URL}/api/wren/oauth/callback`;

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("wren_install_state")?.value;
  const land = (p: string) => NextResponse.redirect(`${ADMIN_URL}/agents/wren?wren_install=${p}`);

  if (!code || !stateParam) return land("missing_code");
  if (!cookieState || cookieState !== stateParam) return land("state_mismatch");

  const [workosUserId] = stateParam.split(":");
  if (!workosUserId) return land("bad_state");

  let token, userInfo, profile, aliases: string[] = [];
  try {
    token = await exchangeGoogleCode({ code, redirectUri: WREN_REDIRECT_URI });
    if (!token.refresh_token) return land("no_refresh_token");
    [userInfo, profile, aliases] = await Promise.all([
      getGoogleUserInfo(token.access_token),
      getGmailProfile(token.access_token),
      getGmailSendAs(token.access_token).catch(() => []),
    ]);
  } catch (err) {
    console.error("[wren oauth] exchange failed", err);
    await logEvent({ category: "system", level: "error", message: `Wren OAuth failed: ${err instanceof Error ? err.message : String(err)}` });
    return land("exchange_failed");
  }

  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

  const { error } = await supabaseAdmin.from("wren_inbox_accounts").upsert(
    {
      workos_user_id: workosUserId,
      provider: "gmail",
      email_address: profile.emailAddress.toLowerCase(),
      aliases: aliases.filter((a) => a.toLowerCase() !== profile.emailAddress.toLowerCase()),
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      token_expires_at: expiresAt,
      scope: token.scope,
      history_id: profile.historyId,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workos_user_id,email_address" }
  );

  if (error) {
    console.error("[wren oauth] upsert failed", error);
    return land("save_failed");
  }

  await logEvent({
    category: "system",
    level: "info",
    message: `Wren inbox connected: ${profile.emailAddress} (${aliases.length} aliases)`,
    metadata: { sub: userInfo.sub, aliases },
  });

  const res = NextResponse.redirect(`${ADMIN_URL}/agents/wren?wren_install=connected`);
  res.cookies.set("wren_install_state", "", { httpOnly: true, secure: true, sameSite: "lax", maxAge: 0, path: "/", domain: ".gb2gllc.com" });
  return res;
}
```

### Task 7.3: Verify + commit Phase 7

- [ ] **Step 1: Typecheck**

```bash
npm run typecheck
```
Expected: exit 0.

- [ ] **Step 2: Commit**

```bash
git add app/api/wren/oauth/start/route.ts app/api/wren/oauth/callback/route.ts
git commit -m "Add Wren Google OAuth start + callback routes

Mirror Iris's OAuth flow but write to wren_inbox_accounts and land back
on /agents/wren. Uses lib/gmail.ts with WREN_REDIRECT_URI."
```

---

## Phase 8 — Wren cron routes + vercel.json

### Task 8.1: Write `wren-poll` cron route

**Files:**
- Create: `app/api/cron/wren-poll/route.ts`

- [ ] **Step 1: Write the file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { pollAllActiveAccounts } from "@/lib/wren/poll";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await pollAllActiveAccounts();
  const summary = results.reduce(
    (acc, r) => ({
      accounts: acc.accounts + 1,
      fetched: acc.fetched + r.fetched,
      classified: acc.classified + r.classified,
      drafted: acc.drafted + r.drafted,
      skipped: acc.skipped + r.skipped,
      errors: acc.errors + r.errors.length,
    }),
    { accounts: 0, fetched: 0, classified: 0, drafted: 0, skipped: 0, errors: 0 }
  );

  return NextResponse.json({ ok: true, summary, results });
}
```

### Task 8.2: Write `wren-purge` cron route

**Files:**
- Create: `app/api/cron/wren-purge/route.ts`

- [ ] **Step 1: Write the file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Nullify body_text/body_html and stamp body_purged_at for messages
// older than 30 days where body_purged_at IS NULL. Headers + classification
// stay forever so the dashboard stays searchable.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabaseAdmin
    .from("wren_messages")
    .update({
      body_text: null,
      body_html: null,
      body_purged_at: new Date().toISOString(),
    }, { count: "exact" })
    .is("body_purged_at", null)
    .lt("received_at", cutoff);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, purged: count ?? 0 });
}
```

### Task 8.3: Register both crons in vercel.json

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Read current vercel.json**

Open `vercel.json`. It currently has `crons` for `chatbot-digest` (weekly) and `reese-draft` (daily). Add two entries.

- [ ] **Step 2: Append Wren cron entries**

Replace the existing `"crons"` array with the union (keep existing, add Wren):
```json
{
  "crons": [
    { "path": "/api/cron/chatbot-digest", "schedule": "0 13 * * 1" },
    { "path": "/api/cron/reese-draft",    "schedule": "0 13 * * *" },
    { "path": "/api/cron/wren-poll",      "schedule": "*/2 * * * *" },
    { "path": "/api/cron/wren-purge",     "schedule": "0 4 * * *" }
  ]
}
```

(Note: if Ada's plan has added crons here too, merge — keep all of them.)

### Task 8.4: Verify + commit Phase 8

- [ ] **Step 1: Typecheck**

```bash
npm run typecheck
```
Expected: exit 0.

- [ ] **Step 2: Commit**

```bash
git add app/api/cron/wren-poll/route.ts app/api/cron/wren-purge/route.ts vercel.json
git commit -m "Add Wren cron routes (poll every 2m, purge daily)

/api/cron/wren-poll calls pollAllActiveAccounts() — Bearer-authed.
/api/cron/wren-purge nullifies body_text/body_html on messages
older than 30d, stamping body_purged_at. Both registered in vercel.json."
```

---

## Phase 9 — Wren admin API routes

**Purpose:** Per-message admin actions (detail / reclassify / send) and per-account actions (poll / settings). All `requireAdmin`.

### Task 9.1: Write message detail route

**Files:**
- Create: `app/api/admin/wren/messages/[id]/route.ts`

- [ ] **Step 1: Write the file**

```ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from("wren_messages")
    .select("*, matched_client:clients(id, name, company, email)")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ message: data });
}
```

### Task 9.2: Write reclassify route

**Files:**
- Create: `app/api/admin/wren/messages/[id]/reclassify/route.ts`

- [ ] **Step 1: Write the file**

```ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { classifyAndDraft, MODEL_NAME } from "@/lib/wren/classify";
import { findClientForSender } from "@/lib/wren/anchor";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const { data: msg, error } = await supabaseAdmin
    .from("wren_messages")
    .select("*, account:wren_inbox_accounts(*)")
    .eq("id", id)
    .single();
  if (error || !msg) return NextResponse.json({ error: error?.message ?? "not found" }, { status: 404 });
  if (!msg.body_text) return NextResponse.json({ error: "body purged" }, { status: 410 });

  const { data: settings } = await supabaseAdmin
    .from("wren_settings")
    .select("draft_categories, voice_notes, signature")
    .eq("account_id", msg.account_id)
    .maybeSingle();

  const matched = msg.from_email ? await findClientForSender(msg.from_email).catch(() => null) : null;

  try {
    const c = await classifyAndDraft({
      from_email: msg.from_email ?? "(unknown)",
      from_name: msg.from_name,
      delivered_to: msg.delivered_to,
      subject: msg.subject ?? "",
      body_text: msg.body_text,
      voice_notes: settings?.voice_notes ?? undefined,
      signature: settings?.signature ?? undefined,
      draft_categories: settings?.draft_categories ?? ["bug", "feature_request", "account_help", "billing_question", "general"],
      matched_client: matched,
    });
    await supabaseAdmin
      .from("wren_messages")
      .update({
        category: c.category,
        priority: c.priority,
        reasoning: c.reasoning,
        suggested_action: c.suggested_action,
        draft_reply: c.draft_reply || null,
        matched_client_id: matched?.id ?? null,
        classified_at: new Date().toISOString(),
        classify_model: MODEL_NAME,
        classify_error: null,
        status: "classified",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return NextResponse.json({ ok: true, classification: c });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from("wren_messages")
      .update({ classify_error: m.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("id", id);
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
```

### Task 9.3: Write send route

**Files:**
- Create: `app/api/admin/wren/messages/[id]/send/route.ts`

- [ ] **Step 1: Write the file**

```ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { sendGmailDraft, refreshGoogleToken } from "@/lib/gmail";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data: msg, error } = await supabaseAdmin
    .from("wren_messages")
    .select("*, account:wren_inbox_accounts(*)")
    .eq("id", id)
    .single();
  if (error || !msg) return NextResponse.json({ error: error?.message ?? "not found" }, { status: 404 });
  if (!msg.gmail_draft_id) return NextResponse.json({ error: "no draft to send" }, { status: 400 });

  // Refresh token if needed.
  const acct = msg.account;
  let accessToken: string = acct.access_token;
  const expiresAt = new Date(acct.token_expires_at).getTime();
  if (Date.now() >= expiresAt - 60_000) {
    try {
      const r = await refreshGoogleToken(acct.refresh_token);
      accessToken = r.access_token;
      await supabaseAdmin
        .from("wren_inbox_accounts")
        .update({
          access_token: r.access_token,
          token_expires_at: new Date(Date.now() + r.expires_in * 1000).toISOString(),
          ...(r.refresh_token ? { refresh_token: r.refresh_token } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", acct.id);
    } catch (err) {
      return NextResponse.json({ error: `token refresh failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }
  }

  try {
    const sent = await sendGmailDraft(accessToken, msg.gmail_draft_id);
    await supabaseAdmin
      .from("wren_messages")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return NextResponse.json({ ok: true, messageId: sent.messageId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

### Task 9.4: Write account-poll route

**Files:**
- Create: `app/api/admin/wren/accounts/[id]/poll/route.ts`

- [ ] **Step 1: Write the file**

```ts
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { pollAccount } from "@/lib/wren/poll";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const result = await pollAccount(id);
  return NextResponse.json({ ok: true, result });
}
```

### Task 9.5: Write account-settings route

**Files:**
- Create: `app/api/admin/wren/accounts/[id]/settings/route.ts`

- [ ] **Step 1: Write the file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

const ARRAY_FIELDS = ["draft_categories", "ignore_from_patterns"] as const;
const TEXT_FIELDS  = ["voice_notes", "signature"] as const;

export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from("wren_settings")
    .select("*")
    .eq("account_id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data ?? null });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { account_id: id, updated_at: new Date().toISOString() };
  for (const f of ARRAY_FIELDS) if (f in body) row[f] = sanitizeArray(body[f]);
  for (const f of TEXT_FIELDS)  if (f in body) row[f] = sanitizeText(body[f]);

  const { error } = await supabaseAdmin
    .from("wren_settings")
    .upsert(row, { onConflict: "account_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

function sanitizeArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter((x) => x.length > 0);
  if (typeof v === "string") return v.split(/[,\n]/).map((x) => x.trim()).filter((x) => x.length > 0);
  return [];
}
function sanitizeText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}
```

### Task 9.6: Verify + commit Phase 9

- [ ] **Step 1: Typecheck**

```bash
npm run typecheck
```
Expected: exit 0.

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/wren/
git commit -m "Add Wren admin API routes

Message detail (GET), reclassify (POST), send (POST via sendGmailDraft).
Account: manual poll (POST), settings GET/PATCH (voice_notes, signature,
draft_categories, ignore_from_patterns). All requireAdmin-gated."
```

---

## Phase 10 — Wren admin UI + nav

**Purpose:** A `/agents/wren` accounts list and a `/agents/wren/[id]` inbox page (mirroring `IrisInbox.tsx`). Plus a **Wren** link in admin nav.

### Task 10.1: Accounts list page

**Files:**
- Create: `app/(admin)/agents/wren/page.tsx`

- [ ] **Step 1: Write the file**

```tsx
import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

export default async function WrenAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ wren_install?: string }>;
}) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/agents/wren");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { wren_install } = await searchParams;
  const { data: accounts } = await supabaseAdmin
    .from("wren_inbox_accounts")
    .select("id, email_address, status, last_polled_at, last_poll_error, created_at")
    .order("created_at", { ascending: false });

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Wren · Support inbox triage</h1>
        <p className="page-sub">Connects to a Gmail mailbox (e.g. support@), classifies new mail, drafts replies for your approval.</p>
      </div>

      {wren_install === "connected" && <div className="admin-flash success">Mailbox connected.</div>}
      {wren_install && wren_install !== "connected" && <div className="admin-flash error">Install failed: {wren_install}</div>}

      <div style={{ marginBottom: 16 }}>
        <a className="admin-btn primary" href="/api/wren/oauth/start">Connect mailbox</a>
      </div>

      {(accounts ?? []).length === 0 ? (
        <p className="muted">No mailboxes connected yet.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Mailbox</th><th>Status</th><th>Last polled</th><th>Last error</th><th /></tr>
            </thead>
            <tbody>
              {accounts!.map((a) => (
                <tr key={a.id}>
                  <td><a href={`/agents/wren/${a.id}`}>{a.email_address}</a></td>
                  <td><span className={`badge ${a.status}`}>{a.status}</span></td>
                  <td>{a.last_polled_at ? new Date(a.last_polled_at).toLocaleString() : "—"}</td>
                  <td className="muted">{a.last_poll_error ?? "—"}</td>
                  <td><a href={`/agents/wren/${a.id}`}>Open →</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
```

### Task 10.2: Inbox view (server page)

**Files:**
- Create: `app/(admin)/agents/wren/[id]/page.tsx`

- [ ] **Step 1: Write the file**

```tsx
import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { WrenInbox } from "./WrenInbox";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

export default async function WrenInboxPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { id } = await params;
  const { data: account } = await supabaseAdmin
    .from("wren_inbox_accounts")
    .select("id, email_address, status, last_polled_at, last_poll_error")
    .eq("id", id)
    .single();
  if (!account) redirect("/agents/wren");

  const { data: messages } = await supabaseAdmin
    .from("wren_messages")
    .select("id, from_email, from_name, subject, snippet, category, priority, suggested_action, draft_reply, status, received_at, classify_error, matched_client_id")
    .eq("account_id", id)
    .order("received_at", { ascending: false })
    .limit(100);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">{account.email_address}</h1>
        <p className="page-sub">{messages?.length ?? 0} recent messages · status {account.status}</p>
      </div>
      <WrenInbox accountId={account.id} messages={messages ?? []} />
    </>
  );
}
```

### Task 10.3: WrenInbox client component

**Files:**
- Create: `app/(admin)/agents/wren/[id]/WrenInbox.tsx`

- [ ] **Step 1: Write the file**

```tsx
"use client";
import { useState } from "react";

type Msg = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  category: string | null;
  priority: string | null;
  suggested_action: string | null;
  draft_reply: string | null;
  status: string;
  received_at: string;
  classify_error: string | null;
  matched_client_id: string | null;
};

export function WrenInbox({ accountId, messages }: { accountId: string; messages: Msg[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function pollNow() {
    setBusy("poll");
    try {
      const res = await fetch(`/api/admin/wren/accounts/${accountId}/poll`, { method: "POST" });
      if (!res.ok) alert("Poll failed");
      else location.reload();
    } finally {
      setBusy(null);
    }
  }

  async function reclassify(messageId: string) {
    setBusy(messageId);
    try {
      const res = await fetch(`/api/admin/wren/messages/${messageId}/reclassify`, { method: "POST" });
      if (!res.ok) alert((await res.json()).error ?? "Reclassify failed");
      else location.reload();
    } finally {
      setBusy(null);
    }
  }

  async function send(messageId: string) {
    if (!confirm("Send this draft to the client?")) return;
    setBusy(messageId);
    try {
      const res = await fetch(`/api/admin/wren/messages/${messageId}/send`, { method: "POST" });
      if (!res.ok) alert((await res.json()).error ?? "Send failed");
      else location.reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="wren-inbox">
      <div style={{ marginBottom: 12 }}>
        <button className="admin-btn" onClick={pollNow} disabled={busy !== null}>
          {busy === "poll" ? "Polling…" : "Poll now"}
        </button>
      </div>
      {messages.length === 0 ? (
        <p className="muted">No messages yet.</p>
      ) : (
        <ul className="message-list">
          {messages.map((m) => (
            <li key={m.id} className={`message-row status-${m.status}`}>
              <button className="message-summary" onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                <span className={`chip cat ${m.category ?? "unclassified"}`}>{m.category ?? "—"}</span>
                <span className={`chip pri ${m.priority ?? "low"}`}>{m.priority ?? "—"}</span>
                <span className="from">{m.from_name || m.from_email || "(unknown)"}</span>
                <span className="subject">{m.subject || "(no subject)"}</span>
                <span className="date">{new Date(m.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </button>
              {expanded === m.id && (
                <div className="message-detail">
                  <p className="snippet">{m.snippet}</p>
                  {m.suggested_action && <p><strong>Action:</strong> {m.suggested_action}</p>}
                  {m.classify_error && <p className="error">Classify error: {m.classify_error}</p>}
                  {m.draft_reply ? (
                    <>
                      <h4>Draft reply</h4>
                      <pre className="draft">{m.draft_reply}</pre>
                      <div className="actions">
                        <button className="admin-btn" onClick={() => reclassify(m.id)} disabled={busy === m.id}>Re-draft</button>
                        <button className="admin-btn primary" onClick={() => send(m.id)} disabled={busy === m.id}>
                          {busy === m.id ? "Sending…" : "Send"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="muted">No draft for this message.</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### Task 10.4: Add Wren nav link

**Files:**
- Modify: `app/(admin)/layout.tsx:33-40`

- [ ] **Step 1: Add the link**

In `app/(admin)/layout.tsx`, locate the `<div className="admin-nav-links">` block. Insert a new `<a>` after the `<a href="/agents/june">June</a>` line:

```tsx
            <a href="/agents/wren">Wren</a>
```

So the block reads:
```tsx
          <div className="admin-nav-links">
            <a href="/admin">Overview</a>
            <a href="/clients">Clients</a>
            <a href="/submissions">Submissions</a>
            <a href="/billing">Billing</a>
            <a href="/agents/avery">Avery</a>
            <a href="/agents/june">June</a>
            <a href="/agents/wren">Wren</a>
          </div>
```

### Task 10.5: Verify + commit Phase 10

- [ ] **Step 1: Typecheck**

```bash
npm run typecheck
```
Expected: exit 0.

- [ ] **Step 2: Commit**

```bash
git add app/\(admin\)/agents/wren/ app/\(admin\)/layout.tsx
git commit -m "Add Wren admin UI (accounts list + inbox view) and nav link

Pages: /agents/wren accounts list with Connect mailbox button;
/agents/wren/[id] inbox view with category/priority chips, expandable
draft preview, and Re-draft / Send actions. Inline classify errors
surface in the detail. Nav link added to AdminLayout."
```

---

## Phase 11 — Portal admin surface (Slack + `/support` + matcher)

### Task 11.1: Extend `postSlackMessage` to accept Block Kit `blocks`

**Files:**
- Modify: `lib/slack.ts:110-130`

- [ ] **Step 1: Update the helper signature**

Replace the `postSlackMessage` function:
```ts
export async function postSlackMessage(opts: {
  botToken: string;
  channel: string;
  text: string;
  thread_ts?: string;
}): Promise<{ ok: boolean; error?: string; ts?: string }> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: opts.channel,
      text: opts.text,
      thread_ts: opts.thread_ts,
      mrkdwn: true,
    }),
  });
  return res.json();
}
```

with:
```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SlackBlock = Record<string, any>;

export async function postSlackMessage(opts: {
  botToken: string;
  channel: string;
  text: string;                      // fallback / notification text (required by Slack even with blocks)
  thread_ts?: string;
  blocks?: SlackBlock[];
}): Promise<{ ok: boolean; error?: string; ts?: string }> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: opts.channel,
      text: opts.text,
      thread_ts: opts.thread_ts,
      mrkdwn: true,
      ...(opts.blocks ? { blocks: opts.blocks } : {}),
    }),
  });
  return res.json();
}
```

### Task 11.2: Failing test — `portalTicketNotificationBlocks` shape

**Files:**
- Create: `lib/slack-builders.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/slack-builders.test.ts
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
  // Should not contain the entire 5000-char string.
  assert.ok(flat.length < 1500, "body should be truncated");
  assert.match(flat, /…/, "expected an ellipsis marker on truncated body");
});
```

- [ ] **Step 2: Run — expect failure**

Run:
```bash
npm test -- --test-name-pattern="portalTicketNotificationBlocks"
```
Expected: FAIL — module not found.

### Task 11.3: Implement `slack-builders.ts`

**Files:**
- Create: `lib/slack-builders.ts`

- [ ] **Step 1: Write the implementation**

```ts
// lib/slack-builders.ts
//
// Slack Block Kit message builders. Pure functions, fully testable.
// Add a new builder per use case rather than overgrowing one.

import type { SlackBlock } from "./slack";

const BODY_SNIPPET_LIMIT = 200;

export function portalTicketNotificationBlocks(opts: {
  client: { name: string | null; company: string | null };
  subject: string;
  body: string;
  ticketId: string;
  adminUrl: string;
}): SlackBlock[] {
  const who = [opts.client.name, opts.client.company].filter(Boolean).join(" · ") || "(unknown client)";
  const snippet = opts.body.length > BODY_SNIPPET_LIMIT
    ? `${opts.body.slice(0, BODY_SNIPPET_LIMIT)}…`
    : opts.body;
  return [
    { type: "section", text: { type: "mrkdwn", text: `*New ticket from ${who}*` } },
    { type: "section", text: { type: "mrkdwn", text: `*${escape(opts.subject)}*\n${escape(snippet)}` } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open in admin" },
          url: `${opts.adminUrl}/support/${opts.ticketId}`,
        },
      ],
    },
  ];
}

function escape(s: string): string {
  // Slack mrkdwn: just need to neutralize stray < > & that aren't part of our links.
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
```

- [ ] **Step 2: Run — expect pass**

Run:
```bash
npm test -- --test-name-pattern="portalTicketNotificationBlocks"
```
Expected: PASS (2 tests).

### Task 11.4: Wire Slack notification into `app/api/portal/tickets/route.ts`

**Files:**
- Modify: `app/api/portal/tickets/route.ts`

- [ ] **Step 1: Replace the file contents**

```ts
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { postSlackMessage } from "@/lib/slack";
import { portalTicketNotificationBlocks } from "@/lib/slack-builders";
import { logEvent } from "@/lib/logger";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";
const SUPPORT_SLACK_CHANNEL = process.env.SUPPORT_SLACK_CHANNEL ?? "";
const SLACK_ADMIN_BOT_TOKEN = process.env.SLACK_ADMIN_BOT_TOKEN ?? "";

export async function POST(req: NextRequest) {
  const { clientId, subject, body } = await req.json();

  if (!clientId || !subject || !body) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const safeSubject = String(subject).slice(0, 200);
  const safeBody = String(body).slice(0, 5000);

  const { data: ticket, error } = await supabaseAdmin
    .from("tickets")
    .insert({ client_id: clientId, subject: safeSubject, body: safeBody })
    .select("id")
    .single<{ id: string }>();

  if (error || !ticket) return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });

  // Fire-and-forget Slack notification after the response.
  after(async () => {
    try {
      if (!SUPPORT_SLACK_CHANNEL || !SLACK_ADMIN_BOT_TOKEN) {
        await logEvent({
          category: "system",
          level: "warn",
          message: "Portal ticket created but Slack notification skipped (env unset)",
          clientId,
          metadata: { ticketId: ticket.id },
        });
        return;
      }
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("name, company")
        .eq("id", clientId)
        .single<{ name: string | null; company: string | null }>();

      const blocks = portalTicketNotificationBlocks({
        client: client ?? { name: null, company: null },
        subject: safeSubject,
        body: safeBody,
        ticketId: ticket.id,
        adminUrl: ADMIN_URL,
      });

      const slackRes = await postSlackMessage({
        botToken: SLACK_ADMIN_BOT_TOKEN,
        channel: SUPPORT_SLACK_CHANNEL,
        text: `New support ticket: ${safeSubject}`,
        blocks,
      });

      if (!slackRes.ok) {
        await logEvent({
          category: "system",
          level: "error",
          message: `Slack ticket notification failed: ${slackRes.error}`,
          clientId,
          metadata: { ticketId: ticket.id },
        });
      }
    } catch (err) {
      await logEvent({
        category: "system",
        level: "error",
        message: `Slack ticket notification threw: ${err instanceof Error ? err.message : String(err)}`,
        clientId,
        metadata: { ticketId: ticket.id },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
```

### Task 11.5: Admin `/support` list page

**Files:**
- Create: `app/(admin)/support/page.tsx`

- [ ] **Step 1: Write the file**

```tsx
import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

export default async function SupportListPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/support");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { all } = await searchParams;
  const showAll = all === "1";

  let q = supabaseAdmin
    .from("tickets")
    .select("id, subject, status, created_at, client:clients(name, company)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (!showAll) q = q.in("status", ["open", "in_progress"]);
  const { data: tickets } = await q;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Support tickets</h1>
        <p className="page-sub">Submitted via the portal · {showAll ? "all" : "open only"}</p>
      </div>
      <div style={{ marginBottom: 12 }}>
        <a className="admin-btn" href={showAll ? "/support" : "/support?all=1"}>
          {showAll ? "Show open only" : "Show all"}
        </a>
      </div>
      {(tickets ?? []).length === 0 ? (
        <p className="muted">No tickets to show.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Client</th><th>Subject</th><th>Status</th><th>Created</th><th /></tr>
            </thead>
            <tbody>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {tickets!.map((t: any) => (
                <tr key={t.id}>
                  <td>{t.client?.name ?? "—"}{t.client?.company ? ` · ${t.client.company}` : ""}</td>
                  <td><a href={`/support/${t.id}`}>{t.subject}</a></td>
                  <td><span className={`badge ${t.status}`}>{t.status.replace("_", " ")}</span></td>
                  <td>{new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                  <td><a href={`/support/${t.id}`}>Open →</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
```

### Task 11.6: Admin `/support/[id]` detail page + Actions client component

**Files:**
- Create: `app/(admin)/support/[id]/page.tsx`
- Create: `app/(admin)/support/[id]/TicketActions.tsx`

- [ ] **Step 1: Write the detail page**

```tsx
// app/(admin)/support/[id]/page.tsx
import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { TicketActions } from "./TicketActions";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { id } = await params;
  const { data: ticket } = await supabaseAdmin
    .from("tickets")
    .select("*, client:clients(id, name, email, company)")
    .eq("id", id)
    .single();
  if (!ticket) redirect("/support");

  return (
    <>
      <div className="page-header">
        <a className="muted" href="/support">← All tickets</a>
        <h1 className="page-title">{ticket.subject}</h1>
        <p className="page-sub">
          {ticket.client?.name} · {ticket.client?.email}
          {ticket.client?.company ? ` · ${ticket.client.company}` : ""}
          {" · "}
          <span className={`badge ${ticket.status}`}>{ticket.status.replace("_", " ")}</span>
        </p>
      </div>

      <section className="ticket-body">
        <h2 className="section-title">Message</h2>
        <pre className="ticket-body-text">{ticket.body}</pre>
      </section>

      <section className="ticket-meta">
        <p><strong>Submitted:</strong> {new Date(ticket.created_at).toLocaleString()}</p>
        {ticket.resolved_at && <p><strong>Resolved:</strong> {new Date(ticket.resolved_at).toLocaleString()}</p>}
      </section>

      <TicketActions ticketId={ticket.id} status={ticket.status} />
    </>
  );
}
```

- [ ] **Step 2: Write the actions client component**

```tsx
// app/(admin)/support/[id]/TicketActions.tsx
"use client";
import { useState } from "react";

export function TicketActions({ ticketId, status }: { ticketId: string; status: string }) {
  const [busy, setBusy] = useState(false);

  async function setStatus(next: "open" | "in_progress" | "resolved") {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/support/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) alert((await res.json()).error ?? "Update failed");
      else location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ticket-actions" style={{ display: "flex", gap: 8, marginTop: 16 }}>
      {status !== "in_progress" && (
        <button className="admin-btn" onClick={() => setStatus("in_progress")} disabled={busy}>Mark in progress</button>
      )}
      {status !== "resolved" && (
        <button className="admin-btn primary" onClick={() => setStatus("resolved")} disabled={busy}>
          {busy ? "Saving…" : "Mark resolved"}
        </button>
      )}
      {status === "resolved" && (
        <button className="admin-btn" onClick={() => setStatus("open")} disabled={busy}>Re-open</button>
      )}
    </div>
  );
}
```

### Task 11.7: `/api/admin/support/[id]` PATCH route

**Files:**
- Create: `app/api/admin/support/[id]/route.ts`

- [ ] **Step 1: Write the file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };
const VALID = new Set(["open", "in_progress", "resolved"]);

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json();
  const next = String(body.status ?? "");
  if (!VALID.has(next)) return NextResponse.json({ error: "invalid status" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { status: next };
  if (next === "resolved") patch.resolved_at = new Date().toISOString();
  else patch.resolved_at = null;

  const { error } = await supabaseAdmin.from("tickets").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

### Task 11.8: Add Support nav link + proxy matcher

**Files:**
- Modify: `app/(admin)/layout.tsx`
- Modify: `proxy.ts`

- [ ] **Step 1: Add nav link**

In `app/(admin)/layout.tsx`, insert a new `<a href="/support">Support</a>` after the `<a href="/submissions">Submissions</a>` line so the nav reads:

```tsx
            <a href="/admin">Overview</a>
            <a href="/clients">Clients</a>
            <a href="/submissions">Submissions</a>
            <a href="/support">Support</a>
            <a href="/billing">Billing</a>
            <a href="/agents/avery">Avery</a>
            <a href="/agents/june">June</a>
            <a href="/agents/wren">Wren</a>
```

- [ ] **Step 2: Add `/support/:path*` to proxy.ts matcher**

In `proxy.ts`, find `config.matcher` and add the line shown:

```ts
export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/connections/:path*",
    "/tickets/:path*",
    "/account/:path*",
    "/admin/:path*",
    "/clients/:path*",
    "/submissions/:path*",
    "/support/:path*",
    "/billing/:path*",
    "/agents/:path*",
    "/welcome",
    "/auth/:path*",
  ],
};
```

### Task 11.9: Verify + commit Phase 11

- [ ] **Step 1: Typecheck**

```bash
npm run typecheck
```
Expected: exit 0.

- [ ] **Step 2: Test pass**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add lib/slack.ts lib/slack-builders.ts lib/slack-builders.test.ts \
  app/api/portal/tickets/route.ts app/\(admin\)/support/ \
  app/api/admin/support/ app/\(admin\)/layout.tsx proxy.ts
git commit -m "Add Slack ticket notification + /support admin pages

postSlackMessage now accepts optional Block Kit blocks. New
lib/slack-builders.ts builds the portal-ticket notification (unit tested).
Portal POST fires the notification via after(); SUPPORT_SLACK_CHANNEL +
SLACK_ADMIN_BOT_TOKEN gate it (no-op + warn if unset). New /support
list and /support/[id] detail pages with Mark resolved / Re-open
actions. Support nav link + /support/:path* added to proxy matcher."
```

---

## Phase 12 — Deploy env + manual `support@` connect + smoke test

**Purpose:** One-time operational tasks that aren't code. Do these in order on Vercel + locally.

### Task 12.1: Update `.env.example` (documentation)

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the new env vars at the bottom**

Append to `.env.example`:
```bash

# Wren — support-mailbox triage (reuses GOOGLE_CLIENT_ID/SECRET with Iris)
# Connected mailbox: support@gb2gllc.com (one-time OAuth via /api/wren/oauth/start)

# Portal-ticket Slack notification (GB2G's own Slack workspace)
SUPPORT_SLACK_CHANNEL=C0123456789
SLACK_ADMIN_BOT_TOKEN=xoxb-your-bot-token
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "Document Wren + portal-Slack env vars in .env.example"
```

### Task 12.2: Set env vars in Vercel

- [ ] **Step 1: Add `SUPPORT_SLACK_CHANNEL`**

Run (interactive):
```bash
vercel env add SUPPORT_SLACK_CHANNEL production
```
Paste the Slack channel ID where ticket notifications should land.

- [ ] **Step 2: Add `SLACK_ADMIN_BOT_TOKEN`**

```bash
vercel env add SLACK_ADMIN_BOT_TOKEN production
```
Paste the bot token (`xoxb-…`) for GB2G's Slack workspace.

- [ ] **Step 3: Re-deploy (so the new env vars load)**

```bash
vercel --prod
```

### Task 12.3: Apply the `019_wren.sql` migration

- [ ] **Step 1: Push the migration**

Run (from repo root):
```bash
supabase db push
```
Expected: applies `019_wren.sql` against the project.

Confirm via the Supabase dashboard or:
```bash
supabase db remote diff
```
Expected: no diff between local migrations and remote.

### Task 12.4: Connect `support@gb2gllc.com` via Wren OAuth

- [ ] **Step 1: Open admin → Wren**

In your browser, go to `https://admin.gb2gllc.com/agents/wren`, signed in as `ADMIN_EMAIL`.

- [ ] **Step 2: Click "Connect mailbox"**

You'll be redirected to Google. **Sign in to the `support@gb2gllc.com` account** (not your founder inbox). Approve the Gmail scopes.

- [ ] **Step 3: Confirm landing**

You should land back on `/agents/wren?wren_install=connected` with the new mailbox in the accounts table.

### Task 12.5: Smoke test the full loop

- [ ] **Step 1: Trigger an inbound message**

Email `support@gb2gllc.com` from any external address with a subject like "Test from {your name}" and a short body.

- [ ] **Step 2: Manually poll** (don't wait for the cron)

In admin, open `/agents/wren/{accountId}` and click **Poll now**. Wait for it to finish, then refresh.

- [ ] **Step 3: Verify**

Expected:
- New row in the inbox with category/priority chips and an expandable draft.
- A `Wren/{category}` label visible in the `support@` Gmail UI.
- A Gmail draft saved in the original thread (visible in Gmail too).

- [ ] **Step 4: Test the send loop**

Click **Send** on the draft. Confirm:
- Row status flips to `sent`.
- Real email arrives in your external inbox.
- The draft is replaced by a real sent message in the `support@` Gmail thread.

- [ ] **Step 5: Test the portal-ticket Slack notification**

In a fresh browser session, sign into the portal at `https://home.gb2gllc.com` and submit a test ticket via `/tickets`. Expected: a Slack message lands in `SUPPORT_SLACK_CHANNEL` within seconds, with client name, subject, body snippet, and an "Open in admin" button linking to `/support/<id>`.

- [ ] **Step 6: Test Mark resolved**

In admin, click the **Open in admin** link → click **Mark resolved**. Confirm the ticket status updates and the row drops out of the default `/support` list.

### Task 12.6: Final cleanup commit (if any tweaks made during smoke test)

Only commit if changes were necessary during smoke testing. If everything worked first try, skip this task.

```bash
git add -p   # review each hunk
git commit -m "Smoke-test tweaks for Wren / portal-ticket Slack"
```

---

## Self-review checklist (the engineer runs this after Phase 11)

Once Phase 11 is committed, before Phase 12 operational tasks, verify:

- [ ] `npm run typecheck` exits 0.
- [ ] `npm test` passes (≥ 10 tests across CTA, classify, anchor, slack-builders).
- [ ] `git grep -n "from \"./google\"\|from '\\./google'" -- 'lib/' 'app/'` returns nothing.
- [ ] `git grep -n "HERALD_MODEL\|HERALD_MAX_TOKENS"` returns only the unrelated commit on `main` (not introduced by this branch).
- [ ] Admin nav shows new **Wren** and **Support** links.
- [ ] `vercel.json` lists 4 crons: `chatbot-digest`, `reese-draft`, `wren-poll`, `wren-purge`.
- [ ] `lib/iris/google.ts` no longer exists; `lib/gmail.ts` does.

## Notes for the engineer

- **`logEvent` `category` union.** `lib/logger.ts` defines `Category` as `"herald" | "intake" | "steward" | "system"`. Wren logs under `"system"` until/unless `"wren"` is added. Do not silently extend the union without checking who else consumes `client_logs` views.
- **Slack bot token sourcing.** `SLACK_ADMIN_BOT_TOKEN` is a separate env var on purpose — it's GB2G's own workspace bot for *internal* notifications, distinct from the per-client Steward Slack installs in `steward_platform_tokens`.
- **Migrations apply manually.** This repo doesn't run migrations as part of build/deploy. After landing the code, `supabase db push` against the connected project.
- **Branch.** Per repo norm (per `project_gb2g_build_conventions` memory), commits go directly to `main` when the user says commit. But this feature branched off `feat/ada-phase-1` because that's the active branch. Confirm with John before merging to main — he may want a `feat/wren` branch first.

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-28-wren-support-triage.md`.
