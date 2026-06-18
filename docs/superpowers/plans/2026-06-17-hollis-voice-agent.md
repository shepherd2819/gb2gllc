# Hollis — AI Phone Receptionist: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Hollis, a per-client **inbound AI phone receptionist** that answers each client business's phone, sounds human, and handles four jobs — book appointments, qualify/capture leads, answer FAQs, take messages / warm-transfer. Inbound-only, general-SMB, English-only for v1.

**Architecture:** The realtime voice loop is **hosted by Retell AI** (telephony + Deepgram STT + Claude Haiku 4.5 brain + Cartesia Sonic TTS) — it cannot run on Vercel. GB2G serves only short webhooks: `/api/hollis/inbound` (per-call dynamic variables = the multi-tenant mechanism), `/api/hollis/tool` (synchronous in-call tools), `/api/hollis/webhook` (lifecycle → fast-ack → Inngest). New `lib/hollis/*` module, migration `027_hollis.sql` (`hollis_lines` / `hollis_calls` / `hollis_kb`), Inngest `hollis/call.completed`, per-client `HollisManager`, admin `/agents/hollis` pages, manifest entry. Bookings/leads/messages are delivered to the business by **email (always) + optional CRM webhook**; **no live calendar in v1**. Two curated Cartesia voices (female/male), client-selectable.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), TypeScript, Supabase Postgres (service-role-only RLS), Inngest, Anthropic Claude (via Retell), Retell AI, Resend, Slack Web API, Node test runner.

**Spec:** `docs/superpowers/specs/2026-06-17-hollis-voice-agent-design.md`
**Research:** `docs/superpowers/research/2026-06-17-voice-phone-agent-research.md`

**Before starting:**
- Create a fresh `feat/hollis` branch off `main` (cherry-pick the spec/research commits if needed).
- **Confirm the next free migration number** with `ls supabase/migrations/` — this plan assumes `027` (current max is `026`). Filenames are authoritative; numbering has collided before.
- **Retell API shapes:** this plan writes a `lib/hollis/retell.ts` client and webhook-signature verification against Retell's documented API. **Verify exact endpoints, request/response shapes, the webhook signing header + algorithm, and the inbound-webhook response format against current docs at `docs.retellai.com` at build time** — they are the one external contract this plan can't pin down from inside the repo. Each affected task flags this.
- A Retell account + `RETELL_API_KEY` is needed only for the live smoke test (Task 21), not for unit-tested code.

---

## File structure

```
supabase/migrations/027_hollis.sql                              (new)
lib/logger.ts                                                   (modify — add "hollis")
lib/hollis/env.ts                                               (new)
lib/hollis/voices.ts                                            (new)
lib/hollis/voices.test.ts                                       (new)
lib/hollis/normalize.ts                                         (new)
lib/hollis/normalize.test.ts                                    (new)
lib/hollis/redact.ts                                            (new)
lib/hollis/redact.test.ts                                       (new)
lib/hollis/greeting.ts                                          (new)
lib/hollis/greeting.test.ts                                     (new)
lib/hollis/outcome.ts                                           (new)
lib/hollis/outcome.test.ts                                      (new)
lib/hollis/retell.ts                                            (new)
lib/hollis/webhook.ts                                           (new)
lib/hollis/webhook.test.ts                                      (new)
lib/hollis/delivery.ts                                          (new — email + CRM webhook + Slack)
lib/hollis/delivery.test.ts                                     (new)
lib/hollis/config.ts                                            (new)
lib/hollis/config.test.ts                                       (new)
lib/hollis/tools.ts                                             (new)
lib/hollis/tools.test.ts                                        (new)
lib/hollis/types.ts                                             (new — shared row/payload types)
app/api/hollis/inbound/route.ts                                 (new)
app/api/hollis/tool/route.ts                                    (new)
app/api/hollis/webhook/route.ts                                 (new)
lib/inngest/functions/hollis-call-completed.ts                  (new)
app/api/inngest/route.ts                                        (modify — register fn)
app/api/admin/clients/[clientId]/hollis/provision/route.ts      (new)
app/api/admin/clients/[clientId]/hollis/config/route.ts         (new)
app/api/admin/clients/[clientId]/hollis/lines/[lineId]/route.ts (new)
app/(admin)/clients/[id]/HollisManager.tsx                      (new)
app/(admin)/clients/[id]/page.tsx                               (modify — render HollisManager)
app/(admin)/agents/hollis/page.tsx                              (new)
app/(admin)/agents/hollis/[callId]/page.tsx                     (new)
app/(admin)/agents/hollis/CallDetail.tsx                        (new — client component)
app/(admin)/agents/agents-manifest.ts                           (modify — add hollis)
app/(admin)/agents/layout.tsx                                   (modify — fetchAgentStatuses branch)
```

Each `lib/hollis/*` file has one responsibility. API routes are thin; all logic lives in `lib/hollis/*` so it stays testable. **Every Supabase query scopes by `client_id`/`line_id`** (no DB-level tenant isolation — `supabaseAdmin` bypasses RLS).

---

## Test commands

- Type check: `npm run typecheck`
- Unit tests: `npm test`
- Single suite: `npm test -- --test-name-pattern='<pattern>'`
- Dev server: `npm run dev`

Run typecheck + tests **after every code-changing step** and before every commit. If either fails, fix before moving on.

---

## Task 1: Migration + logger union + shared types

**Files:**
- Create: `supabase/migrations/027_hollis.sql`
- Modify: `lib/logger.ts:4`
- Create: `lib/hollis/types.ts`

- [ ] **Step 1: Create the migration** (confirm `027` is free first)

```sql
-- ============================================================
-- 027_hollis.sql — Hollis (inbound AI phone receptionist)
-- ============================================================
-- Per-client. One hollis_lines row per client phone number. One hollis_calls
-- row per call (idempotent on retell_call_id). hollis_kb holds per-client FAQ.
-- The realtime audio loop is hosted by Retell; this schema holds config +
-- outcomes. Access funnels through supabaseAdmin; scope every query by client_id.

CREATE TABLE hollis_lines (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  phone_number       TEXT NOT NULL UNIQUE,        -- E.164
  retell_agent_id    TEXT,
  retell_number_id   TEXT,

  voice_profile      TEXT NOT NULL DEFAULT 'female'
                       CHECK (voice_profile IN ('female','male')),
  agent_name         TEXT NOT NULL DEFAULT 'Ava',
  voice_id           TEXT,
  greeting_override  TEXT,
  persona            JSONB NOT NULL DEFAULT '{}'::jsonb,
  hours              JSONB NOT NULL DEFAULT '{}'::jsonb,
  services           JSONB NOT NULL DEFAULT '[]'::jsonb,
  escalation_number  TEXT,
  booking_mode       TEXT NOT NULL DEFAULT 'email'
                       CHECK (booking_mode IN ('email','crm','both')),
  booking_email      TEXT,
  crm_config         JSONB NOT NULL DEFAULT '{}'::jsonb,
  recording_enabled  BOOLEAN NOT NULL DEFAULT TRUE,

  status             TEXT NOT NULL DEFAULT 'provisioning'
                       CHECK (status IN ('provisioning','active','paused','released')),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE hollis_calls (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id             UUID NOT NULL REFERENCES hollis_lines(id) ON DELETE CASCADE,
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  retell_call_id      TEXT NOT NULL UNIQUE,
  direction           TEXT NOT NULL DEFAULT 'inbound'
                        CHECK (direction IN ('inbound','outbound')),
  caller_number       TEXT,
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  duration_ms         INTEGER,
  end_reason          TEXT,

  transcript          JSONB,
  summary             TEXT,
  sentiment           TEXT,
  outcome             TEXT NOT NULL DEFAULT 'no_action'
                        CHECK (outcome IN (
                          'booked','booking_request','qualified_lead',
                          'message','transfer','no_action'
                        )),
  captured            JSONB NOT NULL DEFAULT '{}'::jsonb,

  disclosure_at        TIMESTAMPTZ,
  recording_consent_at TIMESTAMPTZ,
  recording_url        TEXT,

  ticket_id           UUID REFERENCES tickets(id) ON DELETE SET NULL,
  latency_ms_p50      INTEGER,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE hollis_kb (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hollis_lines_client    ON hollis_lines(client_id);
CREATE INDEX idx_hollis_calls_client    ON hollis_calls(client_id, created_at DESC);
CREATE INDEX idx_hollis_calls_line      ON hollis_calls(line_id, created_at DESC);
CREATE INDEX idx_hollis_calls_followup  ON hollis_calls(client_id, created_at DESC)
  WHERE outcome IN ('booking_request','message','transfer');
CREATE INDEX idx_hollis_kb_client       ON hollis_kb(client_id);

ALTER TABLE hollis_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE hollis_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE hollis_kb    ENABLE ROW LEVEL SECURITY;
CREATE POLICY hollis_lines_service_role_only ON hollis_lines FOR ALL USING (false);
CREATE POLICY hollis_calls_service_role_only ON hollis_calls FOR ALL USING (false);
CREATE POLICY hollis_kb_service_role_only    ON hollis_kb    FOR ALL USING (false);
```

- [ ] **Step 2: Add "hollis" to the logger category union**

`lib/logger.ts:4` — add `"hollis"`:

```ts
type Category = "herald" | "intake" | "steward" | "system" | "iris" | "wren" | "holt" | "nora" | "vera" | "hollis";
```

- [ ] **Step 3: Create shared types** `lib/hollis/types.ts`

```ts
export type VoiceProfile = "female" | "male";
export type BookingMode = "email" | "crm" | "both";
export type LineStatus = "provisioning" | "active" | "paused" | "released";
export type CallOutcome =
  | "booked" | "booking_request" | "qualified_lead"
  | "message" | "transfer" | "no_action";

export type HollisLine = {
  id: string;
  client_id: string;
  phone_number: string;
  retell_agent_id: string | null;
  retell_number_id: string | null;
  voice_profile: VoiceProfile;
  agent_name: string;
  voice_id: string | null;
  greeting_override: string | null;
  persona: Record<string, unknown>;
  hours: Record<string, unknown>;
  services: string[];
  escalation_number: string | null;
  booking_mode: BookingMode;
  booking_email: string | null;
  crm_config: Record<string, unknown>;
  recording_enabled: boolean;
  status: LineStatus;
};

export type CapturedFields = Record<string, string | number | boolean | null>;
```

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck
git add supabase/migrations/027_hollis.sql lib/logger.ts lib/hollis/types.ts
git commit -m "Hollis: migration 027 + logger category + shared types"
```

---

## Task 2: Curated voices

**Files:** Create `lib/hollis/voices.ts`, `lib/hollis/voices.test.ts`

Two curated voices (female/male) → Cartesia voice id + default spoken name. The **exact Cartesia voice IDs are filled after auditioning** (recommended: Katie female / Jameson male); leave them as env-overridable constants.

- [ ] **Step 1: Failing tests** `lib/hollis/voices.test.ts`

```ts
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
```

- [ ] **Step 2: Run, expect FAIL** — `npm test -- --test-name-pattern='resolveVoice|VOICE_PROFILES'`

- [ ] **Step 3: Implementation** `lib/hollis/voices.ts`

```ts
import type { VoiceProfile } from "./types";

// Two curated, deeply-tuned voices. Exact Cartesia voice ids are confirmed by
// auditioning at play.cartesia.ai/voices and can be overridden via env without
// a code change. Recommended: Katie (female), Jameson (male).
export const VOICE_PROFILES: Record<VoiceProfile, { voiceId: string; defaultName: string }> = {
  female: {
    voiceId: process.env.HOLLIS_VOICE_FEMALE_ID ?? "cartesia:katie",
    defaultName: "Ava",
  },
  male: {
    voiceId: process.env.HOLLIS_VOICE_MALE_ID ?? "cartesia:jameson",
    defaultName: "Marcus",
  },
};

export function resolveVoice(profile: VoiceProfile) {
  return VOICE_PROFILES[profile];
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Typecheck + commit**

```bash
npm run typecheck
git add lib/hollis/voices.ts lib/hollis/voices.test.ts
git commit -m "Hollis: two curated voice profiles"
```

---

## Task 3: Spoken-form normalization

**Files:** Create `lib/hollis/normalize.ts`, `lib/hollis/normalize.test.ts`

Converts tool-result strings into TTS-friendly spoken form (a top robotic tell if skipped). Applied to every tool result before it returns to Retell.

- [ ] **Step 1: Failing tests** `lib/hollis/normalize.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toSpokenForm } from "./normalize";

test("currency → words", () => {
  assert.equal(toSpokenForm("That's $42.50 total."), "That's forty-two dollars and fifty cents total.");
});

test("whole-dollar currency", () => {
  assert.equal(toSpokenForm("$300 deposit"), "three hundred dollars deposit");
});

test("phone number spoken in groups", () => {
  assert.match(toSpokenForm("Call (831) 239-8123"), /eight three one/);
});

test("time of day", () => {
  assert.equal(toSpokenForm("at 2:30pm"), "at two thirty PM");
});

test("leaves ordinary text untouched", () => {
  assert.equal(toSpokenForm("We shoot listings on Tuesdays."), "We shoot listings on Tuesdays.");
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implementation** `lib/hollis/normalize.ts` — implement `toSpokenForm(text)` with small, well-tested regex passes for currency (`$X` / `$X.YY`), phone numbers (group digits), and clock times (`H:MMam/pm`). Add a `numberToWords(n)` helper (0–999,999 is plenty for prices). Keep each transform pure and order-independent. Make the tests pass exactly.

- [ ] **Step 4: Run, expect PASS. Step 5: Typecheck + commit**

```bash
git add lib/hollis/normalize.ts lib/hollis/normalize.test.ts
git commit -m "Hollis: spoken-form normalization"
```

---

## Task 4: PII redaction

**Files:** Create `lib/hollis/redact.ts`, `lib/hollis/redact.test.ts`

Masks sensitive PII (card numbers, SSNs) in transcripts before storage/surfacing. v1 declines card capture, but a caller may still read one aloud.

- [ ] **Step 1: Failing tests** `lib/hollis/redact.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactPII } from "./redact";

test("masks a 16-digit card number", () => {
  assert.equal(redactPII("my card is 4111 1111 1111 1111"), "my card is [REDACTED_CARD]");
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
```

- [ ] **Step 2–3:** Run (FAIL), then implement `redactPII(text)`: a card regex (13–16 digits with optional spaces/dashes, Luhn-agnostic but length+grouping gated to avoid phone collisions) → `[REDACTED_CARD]`; SSN `\d{3}-\d{2}-\d{4}` → `[REDACTED_SSN]`. Tune so the phone-number test passes (phones are 10 digits / different grouping). Export a `redactTranscript(turns)` that maps over transcript turn text.

- [ ] **Step 4–5:** PASS, typecheck, commit `"Hollis: PII redaction"`.

---

## Task 5: Disclosed greeting

**Files:** Create `lib/hollis/greeting.ts`, `lib/hollis/greeting.test.ts`

Composes the compliant opener (AI disclosure + recording notice) from a line's config.

- [ ] **Step 1: Failing tests** `lib/hollis/greeting.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeGreeting } from "./greeting";

test("includes business name, agent name, and recording notice", () => {
  const g = composeGreeting({ businessName: "BrightLens Media", agentName: "Ava", recordingEnabled: true });
  assert.match(g, /BrightLens Media/);
  assert.match(g, /Ava/);
  assert.match(g, /AI assistant/i);
  assert.match(g, /recorded/i);
});

test("omits recording line when recording disabled", () => {
  const g = composeGreeting({ businessName: "BrightLens Media", agentName: "Ava", recordingEnabled: false });
  assert.doesNotMatch(g, /recorded/i);
  assert.match(g, /AI assistant/i);
});

test("greeting_override is used verbatim when provided (but still appends recording notice)", () => {
  const g = composeGreeting({ businessName: "X", agentName: "Ava", recordingEnabled: true, override: "Hey, thanks for calling X!" });
  assert.match(g, /Hey, thanks for calling X!/);
  assert.match(g, /recorded/i);
});
```

- [ ] **Step 2–3:** FAIL, then implement `composeGreeting({businessName, agentName, recordingEnabled, override?})` → default: `"Thanks for calling {business}, this is {agent}, their AI assistant${recordingEnabled ? ' — and just so you know, this call may be recorded' : ''}. How can I help?"`. When `override` is set, use it then append the recording clause if enabled. **Disclosure is non-negotiable** — even an override must keep "AI assistant"; assert/repair if missing.

- [ ] **Step 4–5:** PASS, typecheck, commit `"Hollis: disclosed greeting composer"`.

---

## Task 6: Outcome derivation

**Files:** Create `lib/hollis/outcome.ts`, `lib/hollis/outcome.test.ts`

Derives the terminal `outcome` from what happened on the call (which tools fired + Retell's analysis). Pure function over a normalized record.

- [ ] **Step 1: Failing tests** `lib/hollis/outcome.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveOutcome } from "./outcome";

test("transfer wins over everything", () => {
  assert.equal(deriveOutcome({ toolsUsed: ["take_message", "transfer_to_human"] }), "transfer");
});
test("booking request", () => {
  assert.equal(deriveOutcome({ toolsUsed: ["book_appointment"] }), "booking_request");
});
test("qualified lead", () => {
  assert.equal(deriveOutcome({ toolsUsed: ["qualify_lead"] }), "qualified_lead");
});
test("message only", () => {
  assert.equal(deriveOutcome({ toolsUsed: ["take_message"] }), "message");
});
test("faq-only call → no_action", () => {
  assert.equal(deriveOutcome({ toolsUsed: ["lookup_faq"] }), "no_action");
});
test("nothing → no_action", () => {
  assert.equal(deriveOutcome({ toolsUsed: [] }), "no_action");
});
```

- [ ] **Step 2–3:** FAIL, then implement `deriveOutcome({ toolsUsed })` with priority order: `transfer_to_human` → `transfer`; `book_appointment` → `booking_request`; `qualify_lead` → `qualified_lead`; `take_message` → `message`; else `no_action`. (`booked` is reserved for v2 live-calendar confirmation.)

- [ ] **Step 4–5:** PASS, typecheck, commit `"Hollis: outcome derivation"`.

---

## Task 7: Env + Retell client

**Files:** Create `lib/hollis/env.ts`, `lib/hollis/retell.ts`

> ⚠️ **Confirm against `docs.retellai.com`:** exact endpoint paths, auth header, request/response bodies, and the number/agent provisioning flow. The shapes below are the integration contract — adjust to the real API.

- [ ] **Step 1:** `lib/hollis/env.ts` (mirror `lib/nora/env.ts`):

```ts
export type HollisSecretsResult =
  | { ok: true; retellApiKey: string; retellWebhookSecret: string }
  | { ok: false; missing: ("RETELL_API_KEY" | "RETELL_WEBHOOK_SECRET")[] };

export function getHollisSecrets(): HollisSecretsResult {
  const key = process.env.RETELL_API_KEY?.trim();
  const wh = process.env.RETELL_WEBHOOK_SECRET?.trim();
  const missing: ("RETELL_API_KEY" | "RETELL_WEBHOOK_SECRET")[] = [];
  if (!key) missing.push("RETELL_API_KEY");
  if (!wh) missing.push("RETELL_WEBHOOK_SECRET");
  if (missing.length) return { ok: false, missing };
  return { ok: true, retellApiKey: key!, retellWebhookSecret: wh! };
}
```

- [ ] **Step 2:** `lib/hollis/retell.ts` — thin REST client. Functions: `createPhoneCallAgentBinding`, `buyNumber(areaCode)`, `bindNumberWebhooks(numberId, { inboundUrl })`, `getCall(callId)`, `transferCall(callId, toNumber)`. Use `fetch` with `Authorization: Bearer ${retellApiKey}`. Centralize the base URL in one const. No unit test (network); typecheck only. **Keep every Retell HTTP detail in this one file** so a future swap to Vapi/LiveKit touches one module.

- [ ] **Step 3:** Typecheck + commit `"Hollis: env secrets + Retell REST client"`.

---

## Task 8: Webhook signature verification

**Files:** Create `lib/hollis/webhook.ts`, `lib/hollis/webhook.test.ts`

> ⚠️ **Confirm against Retell docs:** the exact signing header name and algorithm. The test below assumes HMAC-SHA256 over the raw body with a hex signature header; adjust the impl + test to the real scheme.

- [ ] **Step 1: Failing tests** `lib/hollis/webhook.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyRetellSignature, parseLifecycle } from "./webhook";

const SECRET = "whsec_test";
const body = JSON.stringify({ event: "call_analyzed", call: { call_id: "c1" } });
const goodSig = createHmac("sha256", SECRET).update(body).digest("hex");

test("accepts a valid signature", () => {
  assert.equal(verifyRetellSignature(body, goodSig, SECRET), true);
});
test("rejects a tampered body", () => {
  assert.equal(verifyRetellSignature(body + "x", goodSig, SECRET), false);
});
test("rejects a bad signature", () => {
  assert.equal(verifyRetellSignature(body, "deadbeef", SECRET), false);
});
test("parseLifecycle extracts event + call id", () => {
  const p = parseLifecycle(JSON.parse(body));
  assert.equal(p.event, "call_analyzed");
  assert.equal(p.retellCallId, "c1");
});
```

- [ ] **Step 2–3:** FAIL, then implement `verifyRetellSignature(rawBody, signature, secret)` using `crypto.timingSafeEqual` over HMAC-SHA256 (mirror `lib/slack.ts`'s `verifySlackSignature` for the timing-safe pattern), and `parseLifecycle(payload)` → `{ event, retellCallId, fromNumber, toNumber, transcript, recordingUrl, durationMs, ... }` with defensive optional access.

- [ ] **Step 4–5:** PASS, typecheck, commit `"Hollis: Retell webhook signature verify + lifecycle parse"`.

---

## Task 9: Delivery (email + CRM webhook + Slack)

**Files:** Create `lib/hollis/delivery.ts`, `lib/hollis/delivery.test.ts`

Delivers a booking/lead/message to the business: **email always** (to `booking_email`, fallback `clients.email`), **CRM webhook** when `booking_mode IN ('crm','both')`, and an optional Slack ping. `build*` functions are pure + tested; `deliver*` wrappers dispatch.

- [ ] **Step 1: Failing tests** `lib/hollis/delivery.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeliveryEmail, buildCrmPayload } from "./delivery";

const rec = {
  kind: "booking_request" as const,
  businessName: "BrightLens Media",
  caller: { name: "Jordan Agent", phone: "831-239-8123", email: "j@kw.com" },
  fields: { service: "Listing photo + video", property: "12 Oak St", preferred_times: "Fri AM" },
  callId: "c1",
  callerNumber: "+18312398123",
};

test("email subject names the kind + business", () => {
  const e = buildDeliveryEmail(rec);
  assert.match(e.subject, /booking/i);
  assert.match(e.html, /BrightLens Media/);
  assert.match(e.html, /12 Oak St/);
  assert.match(e.text, /Jordan Agent/);
});

test("crm payload is a flat JSON object with kind + fields", () => {
  const p = buildCrmPayload(rec);
  assert.equal(p.kind, "booking_request");
  assert.equal(p.caller_name, "Jordan Agent");
  assert.equal(p.service, "Listing photo + video");
});
```

- [ ] **Step 2–3:** FAIL, then implement:
  - `buildDeliveryEmail(rec)` → `{ subject, html, text }` (escape HTML; render caller + captured fields as a readable summary).
  - `buildCrmPayload(rec)` → flat object (`kind`, `caller_name`, `caller_phone`, `caller_email`, `caller_number`, `call_id`, plus spread `fields`).
  - `deliverToBusiness(line, rec)` → always send email via `resend()`; if `booking_mode` includes CRM, `POST` `buildCrmPayload` to `crm_config.webhook_url` (sign with `HOLLIS_CRM_WEBHOOK_SECRET` if set); never throw to the caller — log failures. Optional Slack via `SLACK_ADMIN_BOT_TOKEN` if the business uses it.

- [ ] **Step 4–5:** PASS, typecheck, commit `"Hollis: delivery (email + CRM webhook + Slack)"`.

---

## Task 10: Config loader (dynamic variables)

**Files:** Create `lib/hollis/config.ts`, `lib/hollis/config.test.ts`

Loads a line + its FAQ and assembles the Retell `dynamic_variables` object injected per call. Split the **pure assembly** (tested) from the **DB read** (not tested).

- [ ] **Step 1: Failing tests** `lib/hollis/config.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleDynamicVariables } from "./config";

const line = {
  agent_name: "Ava", voice_profile: "female",
  hours: { mon_fri: "9-5" }, services: ["Photo", "Drone"],
  escalation_number: "+18310000000", booking_mode: "email",
  recording_enabled: true, persona: { tone: "warm" },
} as any;

test("assembles business-facing variables + greeting", () => {
  const dv = assembleDynamicVariables(line, "BrightLens Media", [{ question: "Turnaround?", answer: "48 hours" }]);
  assert.equal(dv.business_name, "BrightLens Media");
  assert.equal(dv.agent_name, "Ava");
  assert.match(dv.greeting, /AI assistant/i);
  assert.match(dv.faq, /Turnaround/);
  assert.match(dv.services, /Photo/);
});
```

- [ ] **Step 2–3:** FAIL, then implement `assembleDynamicVariables(line, businessName, kb)` → `{ business_name, agent_name, greeting (via composeGreeting), hours, services, faq, escalation_number, booking_mode }` (stringify lists/FAQ compactly for prompt injection). Add `loadLineByNumber(toNumber)` and `loadLineConfig(toNumber)` that read `hollis_lines` + `hollis_kb` via `supabaseAdmin` (scoped) and call `assembleDynamicVariables`.

- [ ] **Step 4–5:** PASS, typecheck, commit `"Hollis: config loader + dynamic variables"`.

---

## Task 11: Tools (schemas + dispatch)

**Files:** Create `lib/hollis/tools.ts`, `lib/hollis/tools.test.ts`

The 5 Claude tool schemas (`strict: true`) + a `dispatch(name, args, ctx)` executor returning a short, normalized, speakable string. FAQ reads `hollis_kb`; booking/lead/message persist `captured` on the in-flight call + queue delivery; transfer signals Retell.

- [ ] **Step 1: Failing tests** `lib/hollis/tools.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOL_SCHEMAS, dispatch } from "./tools";

test("exposes exactly five tools, all strict", () => {
  assert.equal(TOOL_SCHEMAS.length, 5);
  for (const t of TOOL_SCHEMAS) assert.equal(t.input_schema.type, "object");
});

test("take_message returns a spoken confirmation", async () => {
  const ctx = { line: { id: "l1", client_id: "c1", booking_mode: "email" } as any, callId: "x", record: async () => {} };
  const out = await dispatch("take_message", { name: "Pat", phone: "8312398123", message: "call back" }, ctx);
  assert.match(out, /pass that along/i);
});

test("unknown tool returns a safe fallback string", async () => {
  const ctx = { line: { id: "l1", client_id: "c1" } as any, callId: "x", record: async () => {} };
  const out = await dispatch("nope" as any, {}, ctx);
  assert.match(out, /take a message|didn.t catch/i);
});
```

- [ ] **Step 2–3:** FAIL, then implement `TOOL_SCHEMAS` (book_appointment, qualify_lead, take_message, lookup_faq, transfer_to_human — inputs per spec §Tool schemas) and `dispatch()`. Each tool: validate args, record the tool use + captured fields on the call context, return a normalized confirmation via `toSpokenForm`. `lookup_faq` queries `hollis_kb` (keyword `ilike` v1). Delivery side-effects are queued (not awaited) so the spoken turn stays fast. Unknown tool → graceful "let me take a message" string.

- [ ] **Step 4–5:** PASS, typecheck, commit `"Hollis: tool schemas + dispatch"`.

---

## Task 12: Inbound webhook route

**Files:** Create `app/api/hollis/inbound/route.ts`

> ⚠️ Confirm Retell's inbound-webhook **response shape** (how it accepts an agent override + dynamic variables). Adjust the JSON returned.

Looks up the line by the dialed number and returns the agent id + dynamic variables. Must be fast and fail-soft.

- [ ] **Step 1:** Implement:

```ts
import { NextResponse } from "next/server";
import { loadLineConfig } from "@/lib/hollis/config";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const toNumber = body?.to_number ?? body?.llm?.to_number; // confirm field per Retell docs
  const cfg = toNumber ? await loadLineConfig(toNumber) : null;

  if (!cfg || cfg.line.status !== "active") {
    // Fail-soft: let Retell use the agent's static fallback (voicemail/transfer).
    return NextResponse.json({ call_inbound: { dynamic_variables: { line_inactive: "true" } } });
  }
  return NextResponse.json({
    call_inbound: {
      agent_id: cfg.line.retell_agent_id ?? undefined,
      dynamic_variables: cfg.dynamicVariables,
    },
  });
}
```

- [ ] **Step 2:** Typecheck + commit `"Hollis: inbound webhook (per-call dynamic variables)"`.

---

## Task 13: Tool webhook route

**Files:** Create `app/api/hollis/tool/route.ts`

Synchronous in-call tool execution. Verify signature, resolve the in-flight line/call, dispatch, return the result string. Keep lightweight + warm (module-level `supabaseAdmin`); this sits inside the latency budget.

- [ ] **Step 1:** Implement: read raw body, `verifyRetellSignature`; parse `{ name, args, call: { call_id, to_number } }` (confirm shape); `loadLineByNumber` → build ctx with a `record()` that appends the tool use to an in-memory/Supabase call-scratch row; `await dispatch(name, args, ctx)`; return `{ result }`. On any error return a safe spoken fallback string (never 500 into dead air).

- [ ] **Step 2:** Typecheck + commit `"Hollis: tool webhook (synchronous in-call tools)"`.

---

## Task 14: Lifecycle webhook → Inngest

**Files:** Create `app/api/hollis/webhook/route.ts`

Fast-acks Retell lifecycle events; on `call_analyzed` fires the Inngest event.

- [ ] **Step 1:** Implement:

```ts
import { NextResponse } from "next/server";
import { getHollisSecrets } from "@/lib/hollis/env";
import { verifyRetellSignature, parseLifecycle } from "@/lib/hollis/webhook";
import { inngest } from "@/lib/inngest/client";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-retell-signature") ?? ""; // confirm header name
  const secrets = getHollisSecrets();
  if (!secrets.ok || !verifyRetellSignature(raw, sig, secrets.retellWebhookSecret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  const p = parseLifecycle(JSON.parse(raw));
  if (p.event === "call_analyzed") {
    await inngest.send({ name: "hollis/call.completed", data: { payload: p } });
  }
  return NextResponse.json({ ok: true }); // 200 fast
}
```

- [ ] **Step 2:** Typecheck + commit `"Hollis: lifecycle webhook → Inngest"`.

---

## Task 15: Inngest function (post-call)

**Files:** Create `lib/inngest/functions/hollis-call-completed.ts`; Modify `app/api/inngest/route.ts`

Durable post-call processing. Mirror `lib/inngest/functions/devagent-run.ts` for the `createFunction` + `step.run` + idempotency shape.

- [ ] **Step 1:** Implement `hollisCallCompleted = inngest.createFunction({ id: "hollis-call-completed", name: "Hollis: post-call", concurrency: [{ key: "event.data.payload.clientId", limit: 3 }], triggers: [{ event: "hollis/call.completed" }] }, async ({ event, step }) => { ... })` with steps:
  - `persist` — resolve line by `to_number`/scratch row → upsert `hollis_calls` on `retell_call_id` (treat PG `23505` as benign); store transcript, recording, duration, derived `outcome`, `captured`, `disclosure_at`/`recording_consent_at`.
  - `redact` — `redactTranscript` over the stored transcript, write back.
  - `route-outcome` — if outcome ∈ {booking_request, message, transfer}, insert a `tickets` row and set `ticket_id`.
  - `deliver` — `deliverToBusiness(line, rec)` (email always; CRM if configured; Slack optional).
  - `log` — `logEvent({ clientId, category: "hollis", message, metadata })`.

- [ ] **Step 2:** Register in `app/api/inngest/route.ts`:

```ts
import { hollisCallCompleted } from "@/lib/inngest/functions/hollis-call-completed";
// ...
functions: [stewardScheduled, devagentRun, hollisCallCompleted],
```

- [ ] **Step 3:** Typecheck + commit `"Hollis: post-call Inngest function + registration"`.

---

## Task 16: Admin API — config

**Files:** Create `app/api/admin/clients/[clientId]/hollis/config/route.ts`

`PUT` upserts persona/voice/hours/services/escalation/booking + FAQ. Guard with `requireAdmin()`. Mirror Reese's `/api/admin/clients/[clientId]/reese/config`.

- [ ] **Step 1:** Implement `PUT` — `requireAdmin()`; `await ctx.params` for `clientId`; validate enums (`voice_profile`, `booking_mode`); upsert the `hollis_lines` row for this client (set `voice_id` via `resolveVoice`); replace `hollis_kb` rows for the client from a `faq[]` field. Return the saved line.

- [ ] **Step 2:** Typecheck + commit `"Hollis: admin config route"`.

---

## Task 17: Admin API — provision + line control

**Files:** Create `app/api/admin/clients/[clientId]/hollis/provision/route.ts`, `app/api/admin/clients/[clientId]/hollis/lines/[lineId]/route.ts`

> ⚠️ Provision touches the real Retell API — gate behind `requireAdmin()` and a `getHollisSecrets().ok` check; confirm flow against docs.

- [ ] **Step 1:** `provision` `POST` — `requireAdmin()`; create/assign a Retell agent (use `HOLLIS_RETELL_AGENT_ID` template) + `buyNumber(areaCode?)` + `bindNumberWebhooks`; insert `hollis_lines` (`status='provisioning'`→`'active'`). Return the line. On Retell error, leave status `provisioning` and surface the message.

- [ ] **Step 2:** `lines/[lineId]` `PATCH` — `requireAdmin()`; `{ action: "pause" | "resume" | "release" }` → update `status` (scope by `clientId`). `release` also detaches/releases the Retell number.

- [ ] **Step 3:** Typecheck + commit `"Hollis: provision + line control routes"`.

---

## Task 18: Per-client Manager component

**Files:** Create `app/(admin)/clients/[id]/HollisManager.tsx`; Modify `app/(admin)/clients/[id]/page.tsx`

`"use client"` panel mirroring `ReeseManager.tsx`. Sections: **Line** (provision button / number / status pause-resume), **Voice** (female/male picker + spoken name), **Persona & hours**, **Services**, **Booking** (email + CRM webhook url + mode), **Escalation number**, **FAQ** (question/answer rows), **Recent calls** (this client; outcome + duration + link to detail). Save → `PUT /api/admin/clients/${clientId}/hollis/config`. Provision → `POST .../provision`. Use existing `admin-card` / `admin-input` / `admin-btn` classes (no new CSS).

- [ ] **Step 1:** Write `HollisManager.tsx` (model it closely on `ReeseManager.tsx`: `useState` config, `flash()` toasts, save/draft handlers, pending/history lists).
- [ ] **Step 2:** In `app/(admin)/clients/[id]/page.tsx`, server-load the client's `hollis_lines` + recent `hollis_calls` + `hollis_kb` and render `<HollisManager .../>` alongside the other managers.
- [ ] **Step 3:** `npm run dev`, open a client page, verify the panel renders, config saves, FAQ persists.
- [ ] **Step 4:** Typecheck + commit `"Hollis: per-client Manager + client page wiring"`.

---

## Task 19: Admin agent pages + manifest + sidebar

**Files:** Create `app/(admin)/agents/hollis/page.tsx`, `app/(admin)/agents/hollis/[callId]/page.tsx`, `app/(admin)/agents/hollis/CallDetail.tsx`; Modify `app/(admin)/agents/agents-manifest.ts`, `app/(admin)/agents/layout.tsx`

- [ ] **Step 1:** `agents/hollis/page.tsx` — server component, `force-dynamic`: cross-client call log with metrics (volume, outcome mix, p95 latency, "X need follow-up" count from the `idx_hollis_calls_followup` set). Filters by outcome/client.
- [ ] **Step 2:** `[callId]/page.tsx` + `CallDetail.tsx` — single-call detail: redacted transcript, recording player (`recording_url`), outcome, captured fields, linked ticket.
- [ ] **Step 3:** Add to `agents-manifest.ts` under the `client` group:

```ts
{ slug: "hollis", name: "Hollis", tagline: "AI phone receptionist", glyph: "☎", group: "client",
  description: "Answers each client's business phone in a chosen human voice, books appointments, qualifies leads, answers FAQs, and takes messages — delivered to the business by email and CRM. Inbound, recorded, AI-disclosed." },
```

- [ ] **Step 4:** Add a `fetchAgentStatuses()` branch in `agents/layout.tsx` for `hollis` (active lines → `live`/`idle`/`unconfigured`, + follow-up badge count). Fail-soft.
- [ ] **Step 5:** Typecheck + `npm run dev` check; commit `"Hollis: admin pages + manifest + sidebar status"`.

---

## Task 20: Full test + typecheck sweep

- [ ] **Step 1:** `npm test` — all `lib/hollis/*.test.ts` green (voices, normalize, redact, greeting, outcome, webhook, delivery, config, tools).
- [ ] **Step 2:** `npm run typecheck` — clean.
- [ ] **Step 3:** Commit any fixups: `"Hollis: green test + typecheck sweep"`.
- [ ] **Step 4:** Open the PR (`feat/hollis` → `main`), summarizing the spec + the operator tasks below.

---

## Task 21: Operator tasks (post-merge, manual — NOT code)

These run outside the PR; list them in the PR description.

- [ ] `supabase db push` to apply `027_hollis.sql` (confirm final number).
- [ ] Create the Retell account; set org **data-retention + no-train**; sign no-train/BAA terms (Retell + sub-processors Deepgram/Cartesia/Anthropic) — the actual CIPA control.
- [ ] Create the **template agent(s)**: Claude Haiku 4.5; the two curated Cartesia voices (set `HOLLIS_VOICE_FEMALE_ID` / `HOLLIS_VOICE_MALE_ID` after auditioning at play.cartesia.ai/voices); register the 5 custom functions → `/api/hollis/tool`; set inbound webhook → `/api/hollis/inbound`, lifecycle webhook → `/api/hollis/webhook`; configure latency-mask phrases, barge-in, neural endpointing. Record `HOLLIS_RETELL_AGENT_ID`.
- [ ] Set Vercel env: `RETELL_API_KEY`, `RETELL_WEBHOOK_SECRET`, `HOLLIS_RETELL_AGENT_ID`, `HOLLIS_VOICE_FEMALE_ID`, `HOLLIS_VOICE_MALE_ID`, optional `HOLLIS_CRM_WEBHOOK_SECRET`.
- [ ] **Pilot (real-estate media client):** provision a local number, set persona/hours/services/FAQ, set `booking_email`, wire the CRM webhook (confirm which CRM), pick the voice.
- [ ] **Smoke test:** call the number → run each of the 4 jobs → verify `hollis_calls` row, transcript redaction, ticket creation, business email (+CRM), and `client_logs` entry. Measure real voice-to-voice latency; tune persona/endpointing.
- [ ] Wire the eval harness (Coval/Cekura) with per-tool + interruption/latency scenarios as a regression gate before GA.

---

## Notes for the implementer

- **Honesty on Retell:** Tasks 7, 8, 12, 13, 14, 17 depend on Retell's live API/webhook shapes. Treat the code here as the integration contract and reconcile field names/signing against `docs.retellai.com` first; the `lib/hollis/*` pure modules (Tasks 2–6, 9–11) are fully testable without Retell and should be built first.
- **Latency budget:** the tool route (Task 13) is on the critical path — keep it warm, lightweight, `supabaseAdmin` singleton; defer all slow work to the Inngest function.
- **Tenant scoping:** every Supabase query filters by `client_id`/`line_id`. There is no DB-level isolation.
- **Build order:** Tasks 1–11 (schema + pure libs, TDD) → 12–15 (routes + Inngest) → 16–19 (admin/UI) → 20–21 (verify + operate).

---

## Build log & deltas (2026-06-18, branch `feat/hollis`)

Tasks 1–19 implemented + committed (17 commits). Status: all `lib/hollis/*` unit tests green (52); full suite **165/165 passing when run serially** (`node --import tsx --test --test-concurrency=1 'lib/**/*.test.ts'`); `tsc --noEmit` clean. Note: the default parallel `npm test` intermittently reports 1 failure on `lib/devagent/run.test.ts` with `Unable to deserialize cloned data` — a Node 25 test-runner IPC artifact (the file passes 3/3 in isolation and serially); not introduced by Hollis. Consider adding `--test-concurrency=1` to the `test` script.

Corrections made vs the plan, after confirming the live Retell API (docs.retellai.com):
- **Signature/auth:** Retell verifies webhooks with the **API key** (header `x-retell-signature`, format `v={ms},d={hmac(rawBody+ts, apiKey)}`, 5-min replay) — there is **no separate `RETELL_WEBHOOK_SECRET`**. `env.ts` now requires only `RETELL_API_KEY`. Drop `RETELL_WEBHOOK_SECRET` from the spec's env list.
- **Inbound webhook:** response uses `call_inbound.override_agent_id` + `agent_override.agent.voice_id` + `agent_override.retell_llm.begin_message` (greeting) + `dynamic_variables` + `metadata`. One template agent serves all tenants; per-call voice/greeting/variables are injected here. Reject = 200 without `override_agent_id`.
- **Provisioning:** `POST /create-phone-number` with `area_code` + `inbound_agents:[{agent_id}]` + `inbound_webhook_url`; numbers are keyed by their E.164 string (used as `retell_number_id`).
- **Route paths:** admin routes live under `app/api/admin/clients/[id]/hollis/...` (the repo's dynamic segment is `[id]`, not `[clientId]`).
- **Provision-first flow:** `hollis_lines.phone_number` is `NOT NULL`, so a line is created by **provision** (which buys the number); the **config** route updates the existing line. The Manager shows a "Provision a number" CTA until a line exists (mirrors Reese's connect-first UX).
- **`lib/supabase` is imported lazily** (`await import`) inside DB functions in `calls.ts`/`config.ts`/`tools.ts` — a top-level import throws in unit tests (no Supabase env), per the repo convention.
- **Folded `notify.ts` into `delivery.ts`** (email + CRM webhook + Slack in one module); added `lib/hollis/calls.ts` (record-tool-use / finalize) which the plan implied via `ctx.record` + the Inngest persist step.

Still **unverified — confirm at the Task 21 smoke test:** the exact response field a Retell custom function expects (we return `{ result }`), and whether warm transfer is purely agent-config or needs a tool-route signal.
```
