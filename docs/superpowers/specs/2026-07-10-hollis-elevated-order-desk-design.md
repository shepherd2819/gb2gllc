# Hollis — Elevated Productions Order-Desk Voice Line — Design Spec

**Date:** 2026-07-10
**Status:** Approved design, pending implementation plan
**Owner decision summary:** A per-client **Hollis phone line** for client **Elevated Productions** (real-estate media company on Spiro). Audience = Elevated's **customers** (real-estate agents/brokerages). Hollis **reads** their Spiro orders to answer questions live by voice, and turns every **change** (reschedule / new order / cancel) into a **verified, logged request in Elevated's own Slack** — because Spiro has no order-write API. Identity = auto-match caller phone → Spiro agent, then confirm one detail (property address or tracking code). Slack v1 = rich messages, no buttons; posts every escalation + a one-line per-call summary. On escalation, Hollis promises an email follow-up and a human executes the change in Spiro.

> This spec extends the existing Hollis agent (`lib/hollis/`, Retell + Claude Haiku + Cartesia — see `docs/superpowers/specs/2026-06-17-hollis-voice-agent-design.md`). It adds an **order-desk capability** to a per-client line; it does not create a new agent.

---

## 1. What we're building

A new capability set for a Hollis line provisioned to Elevated Productions:

- **Answer order questions by voice** — "when's my shoot / who's the photographer / what's the address / what's the status" — read directly from Spiro.
- **Capture-and-escalate changes** — reschedule, new order (full intake), cancellation — as structured Slack requests to Elevated's team, since Spiro exposes no write endpoints.
- **Standard receptionist fallbacks** — FAQ (knowledge base), take a message, live transfer to staff.

Everything the agent *does* runs in **our backend**; Retell only runs the voice/LLM loop and forwards tool calls to us (see §11).

---

## 2. Access & feasibility (verified 2026-07-10)

The whole design turns on one confirmed fact: **Spiro's public API is read-only for orders.**

- **Auth confirmed live:** `Authorization: Bearer <api-key>` against `https://api.spiro.media`. The key Elevated's software issued is a **Read-only** Spiro key (`get_spiro_connection_status.authorizationScope = "Read-only"`, `get_spiro_context.authorization.scope = "read"`). Live reads succeeded (5,758 orders, 3,388 agents in the account).
- **No order-write endpoints exist — for anyone.** Both Spiro's published OpenAPI (`/swagger/v1/swagger.json`) and the 40-tool Spiro MCP surface (all `get_`/`search_`/`summarize_`) confirm it. The *entire* public API's only writes are `POST /api/v1/agents` and `POST /api/v1/companies` — neither touches orders. There is **no** create / reschedule / cancel / delete for orders or appointments. This is a platform limitation, not a key-scope one; no key unlocks endpoints that don't exist.
- **Consequence:** direct order mutation is out of scope until Spiro offers a partner/write API (see §14). Until then, mutations are **capture-and-escalate**. This matches the fleet's "agents never auto-act — a human clicks Send" convention.

### Verified Spiro read contract (the shapes we build against)

Response envelope: `{ "data": <object|array>, "meta": <pagination|null> }`. Filtering: `filter[field][op]=value`, `op ∈ eq|neq|contains|startsWith|endsWith`. Paging: `page`, `pageSize` (max 200), `sort` (e.g. `-dateSubmitted`).

- **Agents** — `GET /api/v1/agents?filter[phoneNumber][eq]=<E164>` (also `[emailAddress][eq]`). Live round-trip confirmed: exact phone filter returns the single matching agent. Fields (nested): `identity.{agentId,firstName,lastName,status}`, `contact.{emailAddress,phoneNumber}` (phone is E.164, `+1…`), `company.{companyId,companyName}`.
- **Orders (list/search)** — `GET /api/v1/orders?filter[agentId][eq]=<id>` returns, **per order and in a single call**: `orderId`, `trackingCode`, `status`, `dateSubmitted`, `address.{fullAddress,streetAddress,unitNumber,city,stateOrProvince,postalCode}`, `mediaTitle`, `client.{agentId,agentName,companyName}`, and an embedded `primaryAppointment.{appointmentId, arrivalWindowStart, arrivalWindowEnd, photographer.{photographerId,name}}`. **The entire chosen read scope — status, schedule, address, photographer, arrival window — comes from this one call.** Filters: `trackingCode, mediaTitle, city, stateShort, zipCode, agentId, companyId, isVacant, status, dateSubmitted, totalSalePrice`.
- **Order detail** — `GET /api/v1/orders/{orderId}` → `identity, lifecycle (isCancelled,isRush,isReshoot…), bundle (package name + includedServices), addOns, property.{address,specs}, agent.{firstName,lastName,emailAddress,phoneNumber}, pricing.{…,cancellationAmount,rescheduleAmount}`. Used for new-order/cancel context and the agent's email (for the follow-up promise). **Fee fields go to staff only (§9).**
- **Appointment history** (optional) — `GET /api/v1/appointments?filter[orderId][eq]=<id>` → `events.{arrivalWindowStart/End, confirmedAt, rescheduledAt, cancelledAt, completedAt}`, `status`, embedded `photographer`.
- **Order statuses:** `pending, awaitingConfirmation, confirmed, rescheduled, cancelled, inProgress, appointmentCompleted, editing, delivered`. **Appointment statuses:** `pending, scheduled, confirmed, rescheduled, cancelled, inProgress, completed`.
- **Do not call** `GET /api/v1/appointments/{id}/photographer` — it 404s in this account; the photographer name is already embedded above. (Discrepancy vs. the OpenAPI listing — noted.)

---

## 3. Call flow

1. **Greeting + AI disclosure + recording notice** — existing Hollis greeting/consent path (`lib/hollis/greeting.ts`, disclosure/consent already implemented). Optional personalization: the inbound webhook pre-matches the caller number → agent and passes `caller_agent_name` as a dynamic variable ("Hi Vanessa…").
2. **Identify caller.** Prefer the inbound caller number (normalized to E.164) → agent match. **No phone match** → the LLM asks for **name/email or tracking code** and we look those up (`filter[emailAddress][eq]` / `filter[trackingCode][eq]`).
3. **Verify — one detail.** Before revealing order details or accepting a change, confirm the **property address or tracking code** on the specific order. The provided detail *is* the verification, checked against the resolved agent's orders (prevents caller A reaching caller B's order — the #1 tenant risk).
4. **Serve reads directly** via `lookup_order` (§4) — status, scheduled arrival window, address, photographer.
5. **Mutations → `request_*`** (§4) capture the change and **escalate to Slack** (§6). Hollis tells the caller: *"I've sent that to our team — they'll confirm by email shortly."*
6. **Fallbacks** — `lookup_faq`, `take_message`, or `transfer_to_human` (live warm transfer to Elevated's staff for urgent cases).

---

## 4. Tools (added to `lib/hollis/tools.ts` — `TOOL_SCHEMAS` + `dispatch()`)

The Retell agent **declares** these as custom functions pointing at `POST /api/hollis/tool`; the backend **implements** them in `dispatch()`. All return the Retell `{ result }` string.

| Tool | Type | Args (LLM-supplied) | Backend behavior |
|---|---|---|---|
| `lookup_order` | Read | `tracking_code?`, `property_address?`, `agent_name?`, `agent_email?` | Resolve agent (caller number, else name/email). Resolve order (tracking code, else address match among that agent's orders). **Verify** the order belongs to the resolved agent. Return a spoken order card (status, arrival window, address, photographer). Ambiguity → disambiguate by address/date; no match → ask to re-confirm (limited retries). |
| `request_reschedule` | Escalate | `order_ref` (tracking/id from prior lookup), `desired_window` (free text or date/time), `reason?` | Re-verify order↔caller. Build payload, **post to Slack**, persist `hollis_escalations`. Return "sent to team, confirm by email." |
| `request_new_order` | Escalate | **Full intake:** `property_address`, `package_or_services`, `preferred_datetime`, `access_notes?`, plus resolved agent | No existing order to verify against; identity = resolved agent (or captured contact if unknown). Post structured intake to Slack + persist. |
| `request_cancellation` | Escalate | `order_ref`, `reason?` | Re-verify order↔caller. Post to Slack (payload includes `cancellationAmount` as **staff-only** context) + persist. |
| `lookup_faq` | Read | `question` | **Kept** — existing KB `ilike` over `hollis_kb` scoped by `client_id`. |
| `take_message` | Capture | message fields | **Kept** — existing; captured to `hollis_calls.captured`, delivered post-call. |
| `transfer_to_human` | Live | `reason?` | **Kept**, but must perform a real Retell warm transfer to `hollis_lines.escalation_number` (today it only speaks a line — transfer mechanism flagged unverified in current code; confirm at Retell smoke test). |

Generic `book_appointment` / `qualify_lead` are **not** enabled on this line; `request_new_order` replaces them.

**Stateless verification design:** because tool calls are stateless, `lookup_order` takes the confirm detail (address/tracking) *in the same call* as identity — the LLM gathers it from the caller first. `request_*` re-verify the order↔agent link server-side rather than trusting a prior turn.

---

## 5. Spiro read layer — `lib/hollis/spiro.ts` (net-new)

- **Auth:** `Authorization: Bearer <key>`. The key is stored **encrypted per-client**, reusing the analytics **`client_data_sources`** row (`kind='rest'`, `provider='spiro'`, `secret_enc`) — a single source of truth for Elevated's Spiro key, shared with the analytics build. Decrypt via `lib/analytics/crypto.ts` `decryptSecret` keyed by `ANALYTICS_SECRET_KEY`. The line points at its source via `hollis_lines.spiro_source_id` (§7). *(Light coupling to `lib/analytics`; if we want to decouple, lift `crypto.ts` → `lib/crypto.ts`. The analytics adapter's `spiroGet`/`authHeaders` in `lib/analytics/providers/spiro.ts` use unverified paths (`/orders/search`) — do **not** reuse the paths; a small dedicated client with the corrected `/api/v1/…` paths from §2 is cleaner.)*
- **Functions (pure, testable with mocked `fetch`):**
  - `normalizeCallerNumber(raw): string` — to Spiro E.164 (`+1XXXXXXXXXX`). (Confirm Retell's caller-number field/format at build.)
  - `findAgentByPhone(ctx, e164)` / `findAgentByEmail(ctx, email)` → agent or null.
  - `listAgentOrders(ctx, agentId, { status?, limit })` → normalized order cards.
  - `findOrder(ctx, { agentId, trackingCode?, addressText? })` → the matched order or an ambiguity/none result.
  - `toOrderCard(order)` → `{ trackingCode, status, arrivalWindow, address, photographerName, agentId }` (spoken-form friendly; never includes billing).
- **Errors:** map Spiro 401/403 → auth, ≥500/timeout → transient; return a `Result` union (repo convention), never throw across the tool boundary. Callers translate to graceful spoken fallbacks (§10). 8s fetch timeout (inside Retell's ~10s tool budget).

---

## 6. Escalation & logging → Elevated's Slack — `lib/hollis/escalation.ts` (net-new)

- **Destination:** Elevated's **own** Slack, one channel. Auth via the **per-client bot token** in `steward_platform_tokens` (`client_id`, `platform='slack'`, `token_data.access_token`) — the model `lib/maya.ts` `postMayaEscalation` already uses. Channel id from `hollis_lines.slack_channel_id`.
- **Posting:** reuse `lib/slack.ts` `postSlackMessage({ botToken, channel, blocks })` + Block Kit builders (`lib/slack-builders.ts`). **Rich message, no buttons (v1).**
- **Escalation message (posted in-call, synchronous):** caller (name/phone), verified order (`trackingCode` + address), change type + all captured fields, timestamp, `retell_call_id`, and a deep link to the order in Spiro's admin portal (`https://admin.spiro.media/orders/…`). For cancellations, `cancellationAmount` is included as **staff-only** context.
- **Per-call summary (posted post-call):** from the lifecycle webhook → Inngest `hollis/call.completed`: who called, what they asked, outcome. **Individual `lookup_order` reads are logged to the DB only** (`logEvent` category `"hollis"` + `hollis_escalations`/`hollis_calls`), never spammed to Slack.
- **Never lost:** persist the `hollis_escalations` row first; if the Slack post fails, set `status='failed'`, fire a fallback **staff email** via Resend (`lib/resend.ts`), and still return the caller a graceful "sent to our team." Store `slack_ts` on success.
- **Caller follow-up:** none automated in v1 — Hollis promises email, a human handles it. (Auto-confirm is a future upgrade gated on interactive buttons — §14.)

---

## 7. Data model — migration `034_hollis_order_desk.sql` (net-new)

Next free number is **034** (`033_analytics_command_center.sql` exists — verified via `ls supabase/migrations/`; filenames are authoritative). Boxed-comment header + RLS `ENABLE` + `CREATE POLICY "service role only" … FOR ALL USING (false)` per convention; all access via `supabaseAdmin` filtered by `client_id`.

### `ALTER TABLE hollis_lines ADD COLUMN …`
| column | type | notes |
|---|---|---|
| `order_ops_enabled` | `BOOLEAN NOT NULL DEFAULT FALSE` | gates the order tools for this line |
| `spiro_source_id` | `UUID REFERENCES client_data_sources(id) ON DELETE SET NULL` | which encrypted Spiro REST source this line reads |
| `slack_channel_id` | `TEXT` | Elevated's channel for escalations + summaries |

*(`escalation_number` already exists on `hollis_lines` and is reused for `transfer_to_human`; no new column needed.)*

### New table `hollis_escalations`
| column | type | notes |
|---|---|---|
| `id` | `UUID PK DEFAULT gen_random_uuid()` | |
| `client_id` | `UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE` | |
| `line_id` | `UUID REFERENCES hollis_lines(id) ON DELETE CASCADE` | |
| `call_id` | `UUID REFERENCES hollis_calls(id) ON DELETE SET NULL` | links to the call |
| `type` | `TEXT CHECK IN ('reschedule','new_order','cancel')` | |
| `spiro_order_id` | `TEXT` | null for new_order |
| `tracking_code` | `TEXT` | |
| `verified` | `BOOLEAN NOT NULL DEFAULT FALSE` | passed the confirm-detail gate |
| `caller_number` | `TEXT` | |
| `spiro_agent_id` | `TEXT` | resolved agent |
| `payload` | `JSONB NOT NULL DEFAULT '{}'` | captured fields (redacted per §9) |
| `slack_channel` | `TEXT` | |
| `slack_ts` | `TEXT` | message ts on success |
| `status` | `TEXT CHECK IN ('open','resolved','failed') DEFAULT 'open'` | `resolved` reserved for the future button upgrade |
| `delivery_fallback` | `TEXT` | null \| `'email'` |
| `created_at` / `updated_at` | `TIMESTAMPTZ DEFAULT NOW()` | |

Indexes: `(client_id, created_at DESC)`, `(call_id)`.

---

## 8. Config & admin

- **`HollisManager.tsx`** (`app/(admin)/clients/[id]/`) gains: an **Order desk** section — `order_ops_enabled` toggle, a **Spiro source** picker (lists the client's `client_data_sources` of `provider='spiro'`; the key is entered write-only via the existing analytics source form, never in chat), the **Slack channel** id, and confirmation the **transfer number** (`escalation_number`) is set. Reuse the existing destructive-FAQ-`PUT` care in `app/api/admin/clients/[id]/hollis/config/route.ts`.
- **Slack connect:** Elevated installs the existing GB2G Slack app (OAuth → `steward_platform_tokens`). Reuse `lib/slack.ts` install/callback.
- **Spiro key provisioning:** add a `rest`/`spiro` `client_data_sources` row for Elevated (they now have a REST key; the analytics build had only MCP/OAuth). Ideally a **read-scoped** key, not a master key (least privilege).

---

## 9. Compliance & safety

- **No Spiro writes** — platform-enforced; mutations are capture-only.
- **Verification gate** before any order data or change — prevents cross-agent data exposure (manual `client_id` + agent↔order re-check; no DB-level tenant isolation in this app).
- **Hollis never quotes fees or makes binding commitments.** `cancellationAmount`/`rescheduleAmount` are surfaced to **staff** in the Slack payload only, never spoken.
- **Read minimization** — status/schedule/address/photographer only. **Excluded:** media download links, invoices/payment, internal notes/tasks, photographer personal contact.
- **PII:** existing `lib/hollis/redact.ts` on transcript/persistence; the escalation `payload` stores only what staff need to act.
- **AI disclosure + recording consent** — existing greeting/consent, kept (SC one-party; `recording_enabled` configurable).

---

## 10. Error handling & edge cases

| Case | Behavior |
|---|---|
| Spiro 5xx / timeout | Apologize, offer message or transfer, `logEvent` error; never leak raw errors. |
| No agent match, no identifying detail | Don't reveal anything; offer to take a message or transfer. |
| Agent matches but detail doesn't | "I couldn't find an order matching that address/code" — limited retries, then decline + transfer. |
| Multiple orders for the caller | Disambiguate by address / date / tracking code before answering. |
| Slack post fails | Persist escalation `status='failed'`, `delivery_fallback='email'`, staff email via Resend; caller still hears "sent to our team." |
| Caller-number format mismatch (Retell vs Spiro E.164) | `normalizeCallerNumber` handles it; if still unmatched, fall to name/email/tracking. |

---

## 11. How it splits across Retell and our backend

- **Retell** runs the voice loop (telephony, STT, Cartesia TTS, Claude Haiku) and holds the agent config + **tool declarations** (name + params + the `/api/hollis/tool` webhook URL). It has **no** access to Spiro or Slack.
- **Our backend** implements everything the agent *does*: `POST /api/hollis/tool` → `dispatch()` (Spiro reads, Slack posts); `POST /api/hollis/inbound` → per-client config/voice/greeting + `metadata:{line_id,client_id}` (+ optional pre-matched `caller_agent_name`); `POST /api/hollis/webhook` → persist call, redact, post per-call summary via Inngest `hollis/call.completed`.
- Provisioning the Retell agent/number is automated by the existing `provision` admin route (`lib/hollis/retell.ts`) — minimal hand-setup in the Retell dashboard.

---

## 12. Reused vs. net-new

- **Reused:** Retell inbound/tool/webhook routes + `verifyRetellSignature`; `hollis_lines`/`hollis_calls`; `greeting`/`normalize`/`redact`/`outcome`/`config`/`calls` libs; `lib/slack.ts` posting + Block Kit + per-client tokens (`steward_platform_tokens`); `lib/resend.ts`; `lib/analytics/crypto.ts` + `client_data_sources`; `logEvent` category `"hollis"` (already present — no widening); `lookup_faq`/`take_message`/`transfer_to_human`.
- **Net-new:** `lib/hollis/spiro.ts` (read client), the 4 order tools in `tools.ts`, `lib/hollis/escalation.ts` (payload + Slack post + persist + fallback), migration `034`, `HollisManager` order-desk section, the per-call summary step in the lifecycle Inngest fn, and `normalizeCallerNumber`.

---

## 13. Testing

- **Pure unit tests** (node --test via tsx, existing Hollis pattern) with mocked `fetch`: `spiro.ts` (agent/order resolution, order-card normalization, error mapping), `escalation.ts` (payload build, fallback path), `normalizeCallerNumber`, and the verification matcher (agent↔order, ambiguity, mismatch).
- **Tool dispatch tests** with a mock `ToolCtx` for each new tool (verified vs. unverified paths, escalation persistence).
- **No live Retell needed** for libs. A Retell smoke test at operator setup confirms the `{ result }` field, transfer mechanism, and the caller-number field (all self-flagged unverified in current code).

---

## 14. Out of scope / future

- **Direct Spiro writes** (real reschedule/create/cancel) — blocked on Spiro offering a partner/write API. When it exists, swap each `request_*` tool from *escalate* to *execute*; the Slack logging, verification, and UI stay identical.
- **Interactive Slack** — Done/Reject buttons (net-new `block_actions` endpoint) + **auto-confirm caller email** on resolution. The `hollis_escalations.status` field and per-escalation row already anticipate this.
- **SMS / web-chat** channels (voice only in v1).
- **Availability checking** before proposing a reschedule (capture-only in v1).

---

## Open config-level items to confirm at review (not architectural)

1. Coverage/hours — 24/7 vs after-hours/overflow — and phone-number provisioning for the line.
2. Voice profile + agent name for Elevated's line.
3. Elevated's Slack channel id + who installs the app.
4. Elevated's staff transfer number (`escalation_number`).
5. Confirm the "Hollis never quotes fees" policy.
6. Confirm reusing `client_data_sources` for the Spiro key (vs. a dedicated slot) and whether a **read-scoped** Spiro key is available.
