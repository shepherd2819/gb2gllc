# Hollis — AI Phone Receptionist (Voice Agent)

- **Date:** 2026-06-17
- **Status:** Draft, for review
- **Author:** John (john@gb2gllc.com), design partnered with Claude
- **Research backing:** [`docs/superpowers/research/2026-06-17-voice-phone-agent-research.md`](../research/2026-06-17-voice-phone-agent-research.md) (26-agent research workflow)

## Summary

Hollis is a **per-client, inbound AI phone receptionist** that answers a client business's phone, sounds like a real person, and handles the four front-desk jobs: **book appointments, qualify & capture leads, answer FAQs, and take messages / warm-transfer to a human.** It is the first GB2G agent that operates in real time over voice rather than drafting for approval.

- Each client business gets its own **dedicated phone number**. Calls to that number are answered by Hollis in <1s with a warm, disclosed greeting.
- The realtime voice loop (telephony + speech-to-text + text-to-speech + the audio WebSocket) is **hosted by Retell AI** — it *cannot* run on Vercel, which has no WebSocket server support. **Claude Haiku 4.5 is the brain** (Retell calls Claude natively as the agent's LLM). The spoken voice is one of **two curated, high-quality Cartesia Sonic voices — one female, one male — that each client chooses between** (we perfect two voices rather than offer a dozen mediocre ones).
- During a call, Hollis calls **GB2G-hosted tools** over short HTTPS webhooks (`/api/hollis/tool`) to capture a booking request, capture a lead, search the client's FAQ, take a message, or warm-transfer. **Bookings, leads, and messages are delivered to the client business by email (always) and pushed into their CRM when an integration is configured** — there is no live calendar in v1. GB2G owns every tool, every transcript, and every outcome — stored in Supabase.
- When a call ends, Retell posts a lifecycle webhook to `/api/hollis/webhook`; GB2G fast-acks and hands off to **Inngest** (`hollis/call.completed`) to persist the call, derive the outcome, open a ticket / notify the business, and `logEvent`.
- John configures and monitors Hollis per-client from a **`HollisManager`** panel on `/clients/[id]` (persona, hours, services, FAQ, escalation number, voice) and monitors all calls fleet-wide from an admin **`/agents/hollis`** page.

The product is **inbound-only for v1** (no outbound calling — avoids the entire TCPA outbound-consent and 10DLC burden) and targets **general small businesses** (no HIPAA/PCI tier in v1).

## Design notes (why this shape)

### Why buy the realtime loop (Retell) instead of building it
A human-sounding phone call is a sub-second, bidirectional audio loop: stream caller audio → speech-to-text with turn detection → LLM → text-to-speech → stream back, all while handling barge-in. Assembling and operating that (LiveKit/Pipecat on a persistent host) is a 3–6 month, $150–300K build plus an always-on ops surface **outside** Vercel. Below ~10K–50K minutes/month the per-minute savings don't come close to that cost. Retell hosts the loop, supports **Claude as the agent LLM natively**, bundles SOC2/HIPAA, exposes clean per-call webhooks and per-call dynamic variables for multi-tenancy, and ships in weeks. We keep the brain (Claude), the tools, and all data; we rent the hard real-time plumbing. See the research doc §4 for the full build-vs-buy matrix. **Vapi is the documented fallback** (BYOK Anthropic, `assistant-request` per-number routing); **LiveKit self-host is the at-scale migration target** (~10K–50K min/mo).

### Why the realtime loop cannot live in Vercel
Confirmed: Vercel Functions cannot act as a WebSocket server, and Fluid Compute does not change this; max stream durations (300s edge / up to 1800s node) are incompatible with an open-ended phone call. So **Retell holds the long-lived connection** and GB2G only ever serves short request/response webhooks — which Vercel does well. This is the load-bearing architectural decision and it's why Hollis looks different from every other agent in the fleet.

### Why cascaded (STT→LLM→TTS) with Claude, not native speech-to-speech
Native speech-to-speech models (OpenAI Realtime, Gemini Live) are lower-latency in theory but **lock out Claude** (Claude has no native voice — it is text-in/text-out, confirmed), produce no intermediate transcript (a compliance and debugging gap), and have weaker/less-auditable tool calling. On 8kHz phone audio most of their prosody advantage evaporates. A cascaded pipeline keeps Claude as the brand-controlled brain, gives us a text transcript at every boundary, and makes tool calls reliable. This matches every other agent's "Claude reasons over text" model.

### Why "sounds like a real person" is a systems problem, not a voice purchase
We will realistically land at **~600–900ms voice-to-voice** (humans answer in ~100–300ms — unreachable, and nobody hits it; industry median is 1.4–1.7s, so 600–900ms is already top-decile). Naturalness comes from **conversation design and latency masking**, not raw speed or a fancier voice: a near-instant filler fired the moment a tool call starts ("let me pull that up…"), sub-150ms barge-in handled as a 5-category policy, neural endpointing instead of a silence timer, 2–4 disfluencies per turn, and a spoken-form normalization layer between Claude and the TTS. The bulk of "human" is prompt + platform tuning we own. Research doc §2 is the full playbook and is the source of truth for the persona prompt.

### Why per-client (not admin-only)
Hollis answers *for the client's* business, on the client's number, in the client's voice, against the client's hours/services/FAQ. That is per-client configuration keyed on `client_id`, mirroring Maya (social) and Reese (LinkedIn): a config table + a `HollisManager` on the client page. Unlike Maya/Reese, John will also want fleet-wide call monitoring, so Hollis additionally gets a cross-client admin page (like Vera) and a manifest card under the **client** group.

### Why booking is delivery (email/CRM), not a live calendar
Real-estate-media businesses (the pilot) schedule shoots around crew, travel, and property access — availability isn't a clean open-calendar slot a bot should commit on the spot. So v1 does not book against a live calendar: Hollis collects the request (service, preferred date/time window, property address, agent/contact) and **delivers it to the business by email the moment the call ends (always), plus pushes it into their CRM when one is connected.** The business confirms. This works for every client on day one (email needs no integration), eliminates double-booking risk, and an in-call live-calendar/CRM write-back that confirms a slot (outcome `booked`) is a clean per-provider v2 upgrade.

### Why two curated voices, not a big library
We ship exactly **two voices — one female, one male** — and let each client pick. Perfecting two voices (prompt pacing, normalization, pronunciation, persona) yields consistently human-sounding calls; offering a dozen voices spreads tuning thin and lets clients pick something that sounds worse. Custom/cloned per-client voices are a v2 premium upsell.

### Why inbound-only and general-SMB for v1
Inbound AI answering is **not** covered by TCPA; any **outbound** AI calling triggers prior-express-written-consent rules, the FCC's 2024 "AI voice = artificial" ruling, and 4–6 weeks of 10DLC/STIR-SHAKEN lead time. Cutting outbound removes that entire surface. Skipping healthcare/payments removes the HIPAA-SKU (BAAs across every vendor) and PCI work. Both are clean v2+ additions.

### Out of scope for v1
- **Outbound calling** (reminders, follow-ups, callbacks). v2 — needs the consent + 10DLC work above.
- **HIPAA / PHI tenants** and **phone payments (PCI)** — separate SKUs later.
- **Per-tenant cloned brand voices** — v1 ships a small set of shared Cartesia voices; ElevenLabs instant-clone is a priced upsell (`premium_voice`) in v2.
- **Languages other than English** — English-only v1; Spanish is a config + STT-tier change later.
- **Live-calendar booking** (committing a slot in-call against Google/Cal.com) — v1 captures requests and delivers them by email/CRM; live calendar/CRM write-back is a per-provider v2 add.
- **Self-host (LiveKit) migration** — revisit at sustained ~10K–50K min/mo.
- **A visual call-flow builder** — persona/behavior is prompt + structured config, not a node editor.

---

## Behavior (the loops)

### 1. Inbound-call loop (Retell-hosted; the live conversation)
1. A caller dials the client's Hollis number. Retell receives the call and POSTs the **inbound webhook** → `POST /api/hollis/inbound`.
2. `/api/hollis/inbound` looks up `hollis_lines` by the dialed number (`to_number`), and if the line is `status='active'` returns the template **agent id** + a `dynamic_variables` object: `business_name`, `agent_name` (e.g. "Alex"), `hours`, `services`, `escalation_number`, `booking_mode`, and a compact `faq` blob. If the line is paused/missing, return a fallback that routes to voicemail or the escalation number. Must respond fast (<1s).
3. Retell answers with the disclosed greeting (see Conversation design): *"Thanks for calling {{business_name}}, this is {{agent_name}}, their AI assistant — and just so you know, this call may be recorded. How can I help?"* `disclosure_at` and `recording_consent_at` are stamped at call start.
4. The conversation runs inside Retell: Deepgram (STT + turn detection) → **Claude Haiku 4.5** (with our tool/function definitions) → **Cartesia Sonic** (TTS, μ-law/8kHz). Barge-in, endpointing, and fillers are tuned per the playbook.
5. When Claude decides to act, Retell invokes a **custom function** → `POST /api/hollis/tool` (loop 2). A latency-mask phrase is configured to play on tool-call start. The greeting and persona speak in the client's chosen voice (`voice_profile` female/male).

### 2. In-call tool loop (synchronous webhook; ≤ a few seconds)
`POST /api/hollis/tool` — Retell custom-function endpoint. Verifies the Retell signature, identifies the line via the call's metadata (`retell_call_id` → in-flight line/client), dispatches on `name`, returns a short result string Claude can speak. Tools (full schemas below): `book_appointment`, `qualify_lead`, `take_message`, `lookup_faq`, `transfer_to_human`. Reads (FAQ) hit Supabase directly; all delivery side-effects (email to the business, CRM push) are deferred to the post-call loop so they never block the spoken turn — the caller just hears a confirmation. Keep the handler lightweight, warm, and using a module-level `supabaseAdmin` singleton to stay inside the latency budget.

### 3. Post-call loop (webhook → Inngest; durable)
1. Retell POSTs lifecycle events → `POST /api/hollis/webhook`: `call_started`, `call_ended`, `call_analyzed`. Verify signature; **return 200 immediately.**
2. On `call_analyzed` (Retell's post-call payload with transcript, recording URL, duration, and its own summary/analysis), `inngest.send({ name: "hollis/call.completed", data: { retellCallId, lineId, clientId, payload } })`.
3. Inngest function `hollis/call.completed` (concurrency keyed on `clientId`):
   - `step.run("persist")` — upsert `hollis_calls` keyed on `retell_call_id` (idempotent; treat unique-violation as a benign retry), storing transcript, recording URL, duration, sentiment, and the derived `outcome`.
   - `step.run("redact")` — run PII redaction over the stored transcript (mask card/SSN patterns to `[REDACTED]`) before it is surfaced anywhere.
   - `step.run("route-outcome")` — if `outcome IN ('message','booking_request','transfer')`, create a `tickets` row (reusing the existing tickets surface) so it shows up in the client's queue; attach `hollis_call_id`.
   - `step.run("deliver")` — `lib/hollis/delivery.ts`: email the booking/lead/message to the business (always; to `booking_email`), and push to their CRM when `booking_mode IN ('crm','both')`. Slack the business too if they use it. CRM push is retried in-step and surfaced in admin if it still fails; email is the guaranteed channel.
   - `step.run("log")` — `logEvent({ clientId, category: "hollis", message, metadata })`.

### 4. Provisioning loop (admin-triggered, onboarding)
`POST /api/admin/clients/[clientId]/hollis/provision` (`requireAdmin()`):
1. Create/ensure a Retell agent for the template (or reuse the shared template agent id from env).
2. Buy/assign a phone number (Retell-managed Twilio number for v1) in the client's area code if possible.
3. Insert a `hollis_lines` row (`status='provisioning'` → `'active'`) with the number, `retell_agent_id`, default persona, hours, voice.
4. Bind the number's inbound webhook to `/api/hollis/inbound`. Return the new line to the UI.

### 5. Config loop (admin-triggered)
`PUT /api/admin/clients/[clientId]/hollis/config` (`requireAdmin()`) — upsert persona, `agent_name`, greeting overrides, `hours`, `services`, `escalation_number`, `booking_mode`, `voice_id`, `recording_enabled`, FAQ entries (`hollis_kb`). Mirrors `ReeseManager` → `/reese/config`. A **"Test call"** button triggers `POST /.../hollis/test-call` which (v1) just surfaces the number to dial; (v2) places an outbound test call to John.

---

## Components (new code)

```
lib/hollis/
  env.ts            — Retell/Cartesia/Deepgram keys + a getHollisSecrets() result type (mirrors lib/nora/env.ts)
  retell.ts         — thin Retell REST client: createAgent, buyNumber, bindNumber, getCall, transferCall
  config.ts         — load/normalize a line's dynamic variables from hollis_lines + hollis_kb (cacheable)
  tools.ts          — the 5 Claude tool/function schemas (strict) + a dispatch(name, args, ctx) executor
  delivery.ts       — booking/lead/message delivery: email the business (always) + optional CRM adapter (generic outbound webhook v1; named CRMs later)
  voices.ts         — the two curated voice profiles (female/male) → Cartesia voice ids + default persona names
  normalize.ts      — spoken-form normalization (numbers, dates, currency, phone) applied to tool result strings
  redact.ts         — PII redaction (card/SSN/email patterns) for transcripts before storage/surfacing
  outcome.ts        — derive outcome enum from a finished call (booked | booking_request | qualified_lead | message | transfer | no_action)
  notify.ts         — buildBusinessEmail / buildSlackBlocks + send wrappers (Resend + Slack) for post-call alerts
  webhook.ts        — verify Retell signature; parse lifecycle payloads
  greeting.ts       — compose the disclosed greeting + recording line from a line's config
  *.test.ts         — normalize, redact, outcome, tools dispatch, webhook signature, greeting (pure-fn units)

lib/inngest/functions/
  hollis-call-completed.ts   — the post-call durable function (register in app/api/inngest/route.ts)

app/api/hollis/
  inbound/route.ts   — Retell inbound webhook → agent id + per-client dynamic variables (fast)
  tool/route.ts      — Retell custom-function webhook → in-call tool execution (synchronous)
  webhook/route.ts   — Retell lifecycle webhook → fast-ack + inngest.send

app/api/admin/clients/[clientId]/hollis/
  provision/route.ts — POST: create agent + number + line
  config/route.ts    — PUT: upsert persona/hours/services/escalation/voice + FAQ
  lines/[lineId]/route.ts — PATCH: pause/resume/release a line

app/(admin)/clients/[id]/
  HollisManager.tsx  — "use client" config panel + recent calls for THIS client (mirrors ReeseManager.tsx)

app/(admin)/agents/hollis/
  page.tsx           — cross-client call log + metrics (volume, outcomes, p95 latency, "X need follow-up" badge)
  [callId]/page.tsx  — single-call detail: transcript, recording player, outcome, linked ticket

supabase/migrations/
  027_hollis.sql     — hollis_lines + hollis_calls + hollis_kb + indexes + service-role RLS
```

**Reused unchanged:** `lib/admin-auth.ts` (`requireAdmin`), `lib/supabase.ts` (`supabaseAdmin`), `lib/resend.ts`, `lib/slack.ts` + `lib/slack-builders.ts`, `lib/inngest/client.ts`, `lib/logger.ts`. Add `"hollis"` to the `Category` union in `lib/logger.ts`. Add `hollisCallCompleted` to the `functions:[]` array in `app/api/inngest/route.ts`. Add a Hollis entry to `app/(admin)/agents/agents-manifest.ts` under the `client` group.

**Why a small Retell client of our own (`retell.ts`):** keep all Retell calls in one typed module so a future swap to Vapi/LiveKit touches one file. All prompts, persona, hours, FAQ, and tool definitions live in **Supabase**, never only in the Retell dashboard, so migration stays cheap (mitigates vendor lock-in — Vapi raised prices ~55% in Dec 2025).

---

## Conversation design (the "sound human" config)

The system prompt and behavior config are assembled in `lib/hollis/config.ts` + `greeting.ts` from the line's settings and injected as Retell dynamic variables. Source of truth for the techniques is research doc §2. Key rules baked in:

- **Disclosed, warm opener (every call):** *"Thanks for calling {{business_name}}, this is {{agent_name}}, their AI assistant — and just so you know, this call may be recorded. How can I help?"* (covers AI-disclosure + recording consent in one breath). Stamp `disclosure_at`/`recording_consent_at`.
- **Voice:** the client's chosen curated voice (female or male). Each profile has a matching default persona name and a tuned pacing/normalization config — we tune two voices deeply rather than many shallowly.
- **Latency masking:** a configured filler plays on tool-call start ("Let me check that for you…", "One sec while I grab that…"). Highest-ROI naturalness lever.
- **Barge-in policy:** stop TTS within ~60ms on a true interruption; ignore backchannels ("mm-hmm", "yeah"); never cancel an in-flight booking write unless the new utterance contradicts it.
- **Endpointing:** use Retell/Deepgram neural turn detection (not a fixed silence timer); tuned ~300–600ms for phone audio.
- **Disfluencies:** 2–4 light fillers per turn; receptionist register ("um", "let me see"). Prompt self-check: if a turn is one clean polished sentence, add a natural filler.
- **Spoken-form normalization (`normalize.ts`):** `$42.50` → "forty-two fifty", `2:30pm` → "two thirty PM", phone digits spoken in groups — applied to every tool result string before it reaches TTS.
- **Turn budgets:** booking 5–7 turns, lead-qual 8–12 turns; don't interrogate.
- **Silence handling:** at ~12s say "Still there?"; end only after no response; never end on an interruption.
- **Persona honesty:** transparent-but-warm; never claim to be human if asked. Solution-focused, not over-empathetic.
- **Hard guardrails:** answer only from the client's configured services/FAQ; if unknown, take a message or transfer rather than inventing. Per-tenant FAQ/persona is treated as data and validated to resist prompt injection from caller speech.

---

## Tool schemas (Claude functions, all `strict: true`)

Executed by `lib/hollis/tools.ts` `dispatch()`. Each returns a short, speakable string (post-normalized).

| Tool | Inputs | Effect | Returns |
|---|---|---|---|
| `book_appointment` | `name`, `phone`, `email?`, `service`, `preferred_times`, `location?`, `notes?` | record a `booking_request`; deliver to business (email + CRM) post-call | "Got it — the team will confirm and reach out to lock that in" |
| `qualify_lead` | `name`, `phone`, `email?`, `intent`, `notes`, `budget?`, `timeline?` | persist a captured lead on the call row; deliver to business/CRM | acknowledgement |
| `take_message` | `name`, `phone`, `message` | persist message; deliver to business post-call | "Got it — I'll pass that along" |
| `lookup_faq` | `query` | search `hollis_kb` for the line (keyword v1; embeddings later) | best-match answer or "let me take a message" |
| `transfer_to_human` | `reason` | Retell call transfer to `escalation_number` (warm) | spoken handoff |

There is **no live calendar in v1.** `book_appointment` and `qualify_lead` capture structured details on the call, and **`lib/hollis/delivery.ts` delivers them to the business by email the moment the call ends (always), plus pushes them into the client's CRM when `booking_mode IN ('crm','both')`.** CRM delivery ships as a **generic outbound-webhook adapter** (works with Zapier/Make and most CRMs' inbound hooks); named first-class CRM adapters are added per-client as needed. Because email needs no integration, booking works for every client on day one; in-call slot confirmation (outcome `booked`) is a v2 upgrade.

---

## Data model — new migration `027_hollis.sql`

(Confirm next free number with `ls supabase/migrations/` at implementation time — current max is `026`; numbering has collided historically, filenames are authoritative.)

```sql
-- ============================================================
-- 027_hollis.sql — Hollis (inbound AI phone receptionist)
-- ============================================================
-- Per-client. One hollis_lines row per client phone number. One hollis_calls
-- row per call (idempotent on retell_call_id). hollis_kb holds per-client FAQ.
-- Realtime audio loop is hosted by Retell; this schema holds config + outcomes.

CREATE TABLE hollis_lines (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  phone_number       TEXT NOT NULL UNIQUE,        -- E.164
  retell_agent_id    TEXT,
  retell_number_id   TEXT,

  voice_profile      TEXT NOT NULL DEFAULT 'female'
                       CHECK (voice_profile IN ('female','male')),  -- two curated voices; client picks
  agent_name         TEXT NOT NULL DEFAULT 'Ava',           -- spoken name; default per voice profile, editable
  voice_id           TEXT,                                   -- resolved Cartesia voice id (from lib/hollis/voices.ts)
  greeting_override  TEXT,
  persona            JSONB NOT NULL DEFAULT '{}'::jsonb,   -- tone, do/don't, escalation rules
  hours              JSONB NOT NULL DEFAULT '{}'::jsonb,   -- weekly schedule + timezone
  services           JSONB NOT NULL DEFAULT '[]'::jsonb,   -- list of bookable/answerable services
  escalation_number  TEXT,                                  -- E.164 for warm transfer
  booking_mode       TEXT NOT NULL DEFAULT 'email'
                       CHECK (booking_mode IN ('email','crm','both')),
  booking_email      TEXT,                                  -- where booking/lead/message requests are delivered
  crm_config         JSONB NOT NULL DEFAULT '{}'::jsonb,    -- CRM adapter config (non-secret): kind + webhook url / ids
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

  retell_call_id      TEXT NOT NULL UNIQUE,        -- idempotency key
  direction           TEXT NOT NULL DEFAULT 'inbound'
                        CHECK (direction IN ('inbound','outbound')),
  caller_number       TEXT,                         -- E.164, needed for callbacks; PII
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  duration_ms         INTEGER,
  end_reason          TEXT,

  transcript          JSONB,                        -- redacted before surfacing
  summary             TEXT,
  sentiment           TEXT,
  outcome             TEXT NOT NULL DEFAULT 'no_action'
                        CHECK (outcome IN (
                          'booked','booking_request','qualified_lead',
                          'message','transfer','no_action'
                        )),
  captured            JSONB NOT NULL DEFAULT '{}'::jsonb,   -- lead/message/booking fields

  disclosure_at        TIMESTAMPTZ,                 -- AI disclosure spoken
  recording_consent_at TIMESTAMPTZ,                 -- recording notice spoken
  recording_url        TEXT,

  ticket_id           UUID REFERENCES tickets(id) ON DELETE SET NULL,
  latency_ms_p50      INTEGER,                      -- observed turn latency, for monitoring

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

All access funnels through `supabaseAdmin`; **every query scopes by `client_id`** (no DB-level tenant isolation — the fleet convention and the #1 cross-tenant bug risk).

---

## State machine (one call)

```
  inbound webhook → line active?  ──no──►  voicemail / route to escalation_number
        │ yes
        ▼
   greeting (disclosure + recording notice)  → stamp disclosure_at, recording_consent_at
        │
        ▼
   conversation (Claude + tools) ──► check_availability / book_appointment
        │                            qualify_lead / take_message
        │                            lookup_faq / transfer_to_human
        ▼
   call_ended  ──►  call_analyzed (Retell)  ──► /api/hollis/webhook (200 fast)
                                                      │
                                                      ▼  inngest: hollis/call.completed
                            persist (idempotent) → redact → derive outcome →
                            (if message/booking_request/transfer) open ticket →
                            notify business → logEvent
```

`hollis_calls.outcome` is the terminal classification. Re-delivery of the same `call_analyzed` is absorbed by the `retell_call_id` unique constraint.

---

## Failure modes + edge cases

| Case | Behavior |
|---|---|
| Inbound webhook can't find an active line | Return a safe fallback (voicemail prompt or transfer to `escalation_number`); never 500 the caller into dead air. |
| `/api/hollis/inbound` slow / errors | Retell uses the agent's static default config; log `warn`. Keep the handler trivial + warm. |
| Tool webhook times out (Vercel cold start eats budget) | Tool returns a graceful "let me take a message" path; keep route lightweight, `supabaseAdmin` singleton, consider Edge runtime. Booking writes are idempotent. |
| CRM push fails | Email delivery still goes out (always); CRM push is retried in the Inngest step and surfaced in admin if still failing. Caller is unaffected. |
| Booking email address missing on a line | Fall back to the client's primary email on `clients`; warn in admin to set `booking_email`. |
| Duplicate `call_analyzed` webhook | Upsert on `retell_call_id`; unique-violation treated as benign (matches devagent/nora idempotency). |
| Retell signature invalid on webhook | 401, drop. Verify with the configured signing secret in `webhook.ts`. |
| Caller asks "are you a real person?" | Persona answers honestly ("I'm {{business_name}}'s AI assistant"). Required for disclosure compliance. |
| Caller reads a credit card / SSN aloud | `redact.ts` masks it before the transcript is stored or shown; v1 has no PCI flow — Hollis should decline to take card numbers and offer transfer. |
| Recording disabled for a line | Skip `recording_url`; still stamp `disclosure_at`; don't speak the recording line. |
| Transfer fails (no escalation number) | Take a message instead; flag for urgent business notify. |
| Long call runs up cost | Cap Claude context (sliding window + injected state); per-line minute caps enforced; monitor `duration_ms`. |
| Two calls to the same line simultaneously | Each is its own Retell call + `hollis_calls` row; Inngest concurrency keyed on `clientId` serializes post-call processing, not the live calls. |
| Prompt injection via caller speech | Per-tenant persona/FAQ validated as data; Claude instructed to never reveal system prompt or other tenants; tools are `strict`-schema and server-authorized. |
| Client paused mid-day | Set `status='paused'`; inbound webhook routes to voicemail/escalation. |

---

## Compliance (US inbound, general SMB — v1)

Baked into behavior + config; full reasoning in research doc §7.

- [ ] **AI disclosure in the first spoken sentence, every call** (CA SB 243, UT, TX, IL). Stamped `disclosure_at`.
- [ ] **"This call may be recorded" before recording** — covers the **12 all-party-consent states**; applied universally when `recording_enabled`. Stamped `recording_consent_at`.
- [ ] **Vendor no-train clauses** — contractually bar Retell, Deepgram, Cartesia, and Anthropic from using call data for training/their own purposes. **This, not the recording disclosure, is the actual control against the biggest legal risk (California CIPA / the 2025 "capability test").**
- [ ] **STIR/SHAKEN** — confirm A-level attestation in writing per number block from the telephony provider.
- [ ] **PII redaction** (`redact.ts`) between transcript and storage; decline card/SSN capture in v1.
- [ ] **Per-call audit trail** — disclosure + recording-consent timestamps, direction, tenant, on the `hollis_calls` row; retain ~4 years.
- [ ] **Tenant agreement** — client reps it operates the business, consents to the disclosed/recorded AI receptionist, and indemnifies GB2G for TCPA/CIPA/BIPA from its config; DPA for the client's end customers.
- [ ] **Inbound-only enforced** — no outbound calling code path ships in v1 (keeps us out of TCPA outbound + 10DLC).

---

## Testing

Node test runner via `npm test`, `.test.ts` alongside source. Pure functions only (the live voice loop is validated by real test calls + an eval harness, not unit tests):

- `lib/hollis/normalize.test.ts` — currency/date/phone/time → spoken form.
- `lib/hollis/redact.test.ts` — card/SSN/email masking; doesn't over-redact normal speech.
- `lib/hollis/outcome.test.ts` — derive outcome from representative finished-call payloads.
- `lib/hollis/tools.test.ts` — `dispatch()` routes each tool, validates args, handles calendar-down fallback.
- `lib/hollis/webhook.test.ts` — Retell signature verify (valid/invalid/replayed); idempotent persist.
- `lib/hollis/greeting.test.ts` — composes disclosure + recording line from config.

**Live validation:** `npm run typecheck` + `npm test`, then **real test calls** to a provisioned number; a scripted-caller **eval harness** (Coval or Cekura — Cekura has a Claude Code MCP that fits the stack) with scenarios per tool + interruption/latency checks, wired as a pre-launch gate and a regression gate on prompt changes. Track observed voice-to-voice latency; alert if p95 > 800ms.

---

## Env vars (Vercel only — never in chat or DB)

`lib/hollis/env.ts` exposes `getHollisSecrets()` returning `{ ok, ... } | { ok:false, missing:[...] }` (mirrors `lib/nora/env.ts`).

- `RETELL_API_KEY` — Retell REST + agent/number management
- `RETELL_WEBHOOK_SECRET` — verify inbound/tool/lifecycle webhooks
- `HOLLIS_RETELL_AGENT_ID` — shared template agent id (multi-tenant via dynamic variables)
- `CARTESIA_API_KEY` — TTS (if BYO-keyed through Retell)
- `DEEPGRAM_API_KEY` — STT (if BYO-keyed through Retell)
- `ANTHROPIC_API_KEY` — already present; Claude as the Retell agent LLM (Haiku 4.5)
- `HOLLIS_CRM_WEBHOOK_SECRET` (optional) — sign outbound CRM webhook deliveries
- Reuses existing: `SUPABASE_URL` + service-role key, `RESEND_API_KEY` / `RESEND_FROM` (or `HOLLIS_RESEND_FROM`), `SLACK_ADMIN_BOT_TOKEN`, `NEXT_PUBLIC_ADMIN_URL`, `ADMIN_EMAIL`.

---

## Retell setup (one-time, manual / operator)

1. Create a Retell account; obtain `RETELL_API_KEY`. Set the org's data-retention + **no-train** settings; sign BAAs/no-train terms with Retell (and confirm its sub-processors Deepgram/Cartesia/Anthropic terms).
2. Create the **template agent(s)**: model = Claude Haiku 4.5, voices = the **two curated Cartesia Sonic voices** (female + male — see `lib/hollis/voices.ts`), define the 5 custom functions pointing at `https://<admin-domain>/api/hollis/tool`, set the lifecycle webhook to `/api/hollis/webhook` and inbound webhook to `/api/hollis/inbound`. Record `HOLLIS_RETELL_AGENT_ID` (per voice profile if Retell needs a distinct agent per voice).
3. Configure latency-mask phrases, barge-in, and neural endpointing on the agent.
4. Set `RETELL_WEBHOOK_SECRET` in Vercel; set the remaining env vars.
5. (Per client) Use the `HollisManager` **Provision** button to buy a number + create the line, or buy numbers in Retell and assign.

---

## Pilot: real-estate media client

The Phase 1 tenant is John's **real-estate media** client (photography / video / drone / 3D tours for property listings). This shapes the pilot's *config*, not the architecture:
- **Services (`services`):** listing photography, video tours, drone/aerial, 3D / Matterport, virtual staging, twilight shoots, rush turnaround.
- **Booking capture (`book_appointment`):** service(s), property address, preferred shoot date/time window, listing agent / brokerage + callback contact, square footage / access notes — delivered by email to the studio (and CRM if they use one — confirm which: e.g. Aryeo, HoneyBook, Dubsado, or a real-estate CRM).
- **Lead qualification (`qualify_lead`):** agent vs brokerage vs FSBO, listings per month, market / coverage area, package interest, timeline.
- **FAQ (`hollis_kb`):** pricing & packages, turnaround time, coverage radius, licensing / image-usage rights, reschedule / cancellation policy, weather rebooking.
- **Escalation:** warm-transfer to the owner/scheduler for complex or large jobs; otherwise take a message.
- **Voice:** the studio picks female or male; persona is professional-but-warm (they're talking to busy listing agents).

## Pricing (resale)

Positioned as a **premium managed service**, not a per-minute utility: **$1,500–$5,000/month** per client by call volume, number of lines, CRM integration depth, and voice customization. Wholesale all-in is ~$0.14/min (Retell + Claude Haiku + Cartesia + telephony), so even a heavy ~3,000–5,000 min/month client costs ~$420–$700 — **~70–90% gross margin** across the range. Anchor against the cost of a human receptionist and against a single missed call → lost listing in real estate (one closed deal dwarfs the monthly fee). Suggested shape:

| Tier | ~$/mo | Includes |
|---|---|---|
| Essential | $1,500 | 1 line, email delivery, both voices, business-hours coverage |
| Pro | ~$3,000 | + CRM integration, higher volume, after-hours coverage, priority support |
| Premium | $5,000 | multi-line, custom/cloned voice, deep CRM/workflow integration, white-glove tuning |

Per-line minute caps + overage protect margin; bundle with the rest of the GB2G fleet where it fits.

## Phasing

**Phase 0 — Spike / POC (1–2 weeks, throwaway-ish).** One hardcoded Retell number + template agent (Claude Haiku + Cartesia) → one `app/api/hollis/tool` route hitting a stub calendar → book + log one call. Measure real voice-to-voice latency and tune the persona/fillers/endpointing. **Goal: prove <1s feel and a clean booking.** No multi-tenancy, minimal DB.

**Phase 1 — Single-tenant pilot (2–4 weeks, the real PR).** Migration `027_hollis.sql`. Full `lib/hollis/` (config, voices, tools, delivery [email + generic CRM webhook], normalize, redact, outcome, notify, webhook, greeting) + `*.test.ts`. Both curated voices wired and auditioned. `app/api/hollis/{inbound,tool,webhook}`. Inngest `hollis/call.completed` (registered). `logEvent` "hollis" category. Compliance opener + recording consent + redaction. `HollisManager` on the client page + provision/config routes. Eval harness with regression gates. **Goal: one real GB2G client live on their own number, all 4 jobs working, >90% task success.**

**Phase 2 — Multi-tenant GA (3–6 weeks).** `provision.ts` automates per-client agent + number + line; the template agent(s) serve N tenants via dynamic variables. Admin `/agents/hollis` cross-client monitoring page + manifest card. RLS/scoping hardening, per-line minute caps, vendor no-train clauses finalized, **managed-service resale tiers ($1,500–$5,000/mo) + Stripe billing**, optional per-client custom/cloned voice. **Goal: smooth onboarding + billing; gross margin 85%+ at $1,500–$5,000/mo price points.**

**Phase 3 — Optimize / scale (ongoing).** A/B TTS on a traffic split; per-accent WER tracking; latency SLOs/alerts; evaluate the **LiveKit self-host migration** at sustained ~10K–50K min/mo.

Each phase follows GB2G's spec → written plan → reviewed PR workflow.

Operational tasks after the Phase 1 merge (operator-only):
- `supabase db push` to apply `027_hollis.sql` (confirm the final number — take the next free after the highest filename).
- Create the Retell account + template agent + webhooks (above); set all env vars in Vercel.
- (Per pilot client) provision a number + line; connect Cal.com if booking live.
- Sign vendor no-train terms; finalize the tenant agreement + DPA template.
- Smoke test: call the number, run each of the 4 jobs, verify `hollis_calls` row, transcript redaction, ticket creation, business notification, and `client_logs` entry.

---

## Owner decisions still open

1. **The two curated voices** — confirm the female + male Cartesia voices (recommended: Katie / Jameson) after auditioning in the [Cartesia voice library](https://play.cartesia.ai/voices), and their default spoken names.
2. **Pilot CRM** — does the real-estate media client use a CRM we should push to (Aryeo / HoneyBook / Dubsado / other), or email-only for the pilot?
3. **Telephony ownership** — defaulting to Retell-managed Twilio numbers for v1 (simplest); BYO Telnyx trunk is the at-scale option. Override if you prefer.
4. **Confirm the name "Hollis"** (vs another fleet-style first name).

_Resolved 2026-06-17: inbound-only; general-SMB (no HIPAA/PCI); all four jobs in scope; English-only; booking = email-to-business + optional CRM (no live calendar); two curated voices (female/male) client-selectable; pilot = real-estate media client; resale $1,500–$5,000/mo._

---

## Related

- [[hollis-voice-agent-direction]] — research conclusions + architecture summary (memory)
- `docs/superpowers/research/2026-06-17-voice-phone-agent-research.md` — full research report (latency, vendors, playbook, compliance, cost)
- [[gb2g-agent-build-conventions]] — agent anatomy, migration/RLS conventions, the gotchas
- `docs/superpowers/specs/2026-05-29-vera-contract-agent-design.md` — the spec format this mirrors
- `lib/inngest/functions/devagent-run.ts` — Inngest step-fn + idempotency reference
- `app/(admin)/clients/[id]/ReeseManager.tsx` — per-client Manager reference
