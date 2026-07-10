# Hollis — Elevated Productions Order-Desk Line — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an order-desk capability to a per-client Hollis voice line for Elevated Productions: read Spiro orders by voice to answer questions, and capture reschedule/new-order/cancel requests as verified, logged posts to Elevated's Slack.

**Architecture:** Retell runs the voice/LLM loop and forwards tool calls to `POST /api/hollis/tool`; all logic is our backend. New `lib/hollis/spiro.ts` reads `api.spiro.media` (Bearer, read-only — Spiro has no order-write API). New `lib/hollis/escalation.ts` posts to Elevated's Slack via their per-client bot token and persists a `hollis_escalations` row. Four new tools slot into the existing `dispatch()`; the base 5 receptionist tools stay.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (`supabaseAdmin`), Retell, Anthropic Claude Haiku (in Retell), Slack Web API (`lib/slack.ts`), Resend, Inngest, `node --test` via tsx.

## Global Constraints

- **Spiro is read-only.** No create/reschedule/cancel/update endpoints exist — mutations are capture-and-escalate only. Never attempt a Spiro write.
- **Auth:** `Authorization: Bearer <key>` against `https://api.spiro.media`. Key stored encrypted in `client_data_sources.secret_enc`, decrypted via `lib/analytics/crypto.ts` `decryptSecret` (key `ANALYTICS_SECRET_KEY`). Never in env or chat.
- **Spiro read contract:** envelope `{ data, meta }`; filters `filter[field][op]=value` (literal brackets, op `eq`); paging `page`/`pageSize` (≤200)/`sort`. `GET /api/v1/orders?filter[agentId][eq]=<id>` returns per-order `orderId, trackingCode, status, address.{streetAddress,fullAddress,city,stateOrProvince,postalCode}, client.{agentId,agentName,companyName}, primaryAppointment.{arrivalWindowStart,arrivalWindowEnd,photographer.name}`. `GET /api/v1/agents?filter[phoneNumber][eq]=<E164>` / `[emailAddress][eq]` returns `identity.{agentId,firstName,lastName}, contact.{phoneNumber,emailAddress}, company.{companyName}`. Do NOT call `/appointments/{id}/photographer` (404s; photographer is embedded).
- **Order statuses:** `pending, awaitingConfirmation, confirmed, rescheduled, cancelled, inProgress, appointmentCompleted, editing, delivered`.
- **Verification gate:** reveal order details / accept a change only after confirming property address or tracking code against the resolved agent's own orders. All DB access via `supabaseAdmin` filtered by `client_id` (no DB-level tenant isolation in this app).
- **Hollis never quotes fees.** `cancellationAmount`/`rescheduleAmount` go to staff in the Slack payload only, never spoken.
- **Slack:** Elevated's own workspace, one channel (`hollis_lines.slack_channel_id`), per-client bot token from `steward_platform_tokens` (`platform='slack'`, `token_data.access_token`). Rich Block Kit, no buttons (v1).
- **Logger:** `logEvent({ clientId, category: "hollis", message, metadata })` — category already present, do not widen.
- **DB libs use lazy `await import("@/lib/supabase")`** (`supabaseAdmin`). RLS on every table: `ENABLE` + `CREATE POLICY "service role only" … FOR ALL USING (false)`.
- **Test command (per file):** `node --import tsx --test lib/hollis/<file>.test.ts`. **Typecheck:** `npm run typecheck`. Test files import `{ test } from "node:test"` and `assert from "node:assert/strict"`.
- **Retell `{ result }` response field, transfer mechanism, and caller-number field are self-flagged unverified in current code** — confirm at the operator Retell smoke test, not in unit tests.

## File Structure

**Net-new:**
- `supabase/migrations/034_hollis_order_desk.sql` — `hollis_lines` columns + `hollis_escalations` table.
- `lib/hollis/phone.ts` (+ `.test.ts`) — E.164 caller-number normalization.
- `lib/hollis/spiro.ts` (+ `.test.ts`) — Spiro read client: agent/order resolution, order-card normalization, ctx loading.
- `lib/hollis/escalation.ts` (+ `.test.ts`) — Slack escalation payload, posting, persistence, fallback, per-call summary.

**Modified:**
- `lib/hollis/types.ts` — new types + extended `HollisLine`.
- `lib/hollis/tools.ts` (+ `.test.ts`) — order-tool handlers, `ORDER_TOOL_SCHEMAS`, `toolsForLine`, extended `ToolCtx`, dispatch wiring.
- `app/api/hollis/tool/route.ts` — enrich `ToolCtx` (caller number, order-desk line fields), gate on `order_ops_enabled`.
- `app/api/hollis/inbound/route.ts` — capture `from_number` → `metadata.caller_number`; return new line fields.
- `lib/hollis/config.ts` — select new `hollis_lines` columns.
- `lib/inngest/functions/hollis-call-completed.ts` — post the per-call summary.
- `app/api/admin/clients/[id]/hollis/config/route.ts` — accept `order_ops_enabled`, `spiro_source_id`, `slack_channel_id`.
- `app/(admin)/clients/[id]/HollisManager.tsx` — order-desk config section.

---

### Task 1: Migration 034 — order-desk schema

**Files:**
- Create: `supabase/migrations/034_hollis_order_desk.sql`

**Interfaces:**
- Produces: `hollis_lines.order_ops_enabled BOOLEAN`, `hollis_lines.spiro_source_id UUID`, `hollis_lines.slack_channel_id TEXT`; table `hollis_escalations`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- 034_hollis_order_desk.sql
-- Order-desk capability for a per-client Hollis line: Spiro source binding,
-- Slack channel, and an escalation ledger (reschedule / new order / cancel).
-- ============================================================================

ALTER TABLE hollis_lines
  ADD COLUMN IF NOT EXISTS order_ops_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS spiro_source_id UUID REFERENCES client_data_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS slack_channel_id TEXT;

CREATE TABLE IF NOT EXISTS hollis_escalations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  line_id           UUID REFERENCES hollis_lines(id) ON DELETE CASCADE,
  call_id           UUID REFERENCES hollis_calls(id) ON DELETE SET NULL,
  type              TEXT NOT NULL CHECK (type IN ('reschedule','new_order','cancel')),
  spiro_order_id    TEXT,
  tracking_code     TEXT,
  retell_call_id    TEXT,
  verified          BOOLEAN NOT NULL DEFAULT FALSE,
  caller_number     TEXT,
  spiro_agent_id    TEXT,
  payload           JSONB NOT NULL DEFAULT '{}',
  slack_channel     TEXT,
  slack_ts          TEXT,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','failed')),
  delivery_fallback TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hollis_escalations_client_created_idx
  ON hollis_escalations (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hollis_escalations_call_idx
  ON hollis_escalations (call_id);

ALTER TABLE hollis_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON hollis_escalations FOR ALL USING (false);
```

- [ ] **Step 2: Verify it is the next free number and parses**

Run: `ls supabase/migrations/ | tail -3`
Expected: `034_hollis_order_desk.sql` is present and is the highest number (033 already exists).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/034_hollis_order_desk.sql
git commit -m "feat(hollis): migration 034 — order-desk columns + hollis_escalations"
```

---

### Task 2: Types

**Files:**
- Modify: `lib/hollis/types.ts`
- Test: `lib/hollis/types.test.ts` (create — a compile-only guard)

**Interfaces:**
- Produces: `OrderStatus`, `OrderCard`, `SpiroAgent`, `SpiroCtx`, `EscalationType`, `EscalationInput`; extended `HollisLine` with `order_ops_enabled`, `spiro_source_id`, `slack_channel_id`.

- [ ] **Step 1: Add the types**

Append to `lib/hollis/types.ts`:

```ts
export type OrderStatus =
  | "pending" | "awaitingConfirmation" | "confirmed" | "rescheduled"
  | "cancelled" | "inProgress" | "appointmentCompleted" | "editing" | "delivered";

export interface OrderCard {
  orderId: string;
  trackingCode: string;
  status: OrderStatus | string;
  addressText: string;
  arrivalWindowStart: string | null;
  arrivalWindowEnd: string | null;
  photographerName: string | null;
  agentId: string;
}

export interface SpiroAgent {
  agentId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
}

export interface SpiroCtx {
  baseUrl: string;
  apiKey: string;
  authScheme: "bearer" | "x-api-key";
}

export type EscalationType = "reschedule" | "new_order" | "cancel";

export interface EscalationInput {
  type: EscalationType;
  clientId: string;
  lineId: string;
  slackChannel: string | null;
  staffEmail: string | null;
  callId?: string | null;
  retellCallId?: string | null;
  callerNumber?: string | null;
  agentId?: string | null;
  order?: OrderCard | null;
  verified: boolean;
  fields: Record<string, unknown>;
  staffContext?: Record<string, unknown>;
}
```

Find the existing `HollisLine` interface and add three fields:

```ts
  order_ops_enabled?: boolean;
  spiro_source_id?: string | null;
  slack_channel_id?: string | null;
```

- [ ] **Step 2: Write a compile guard test**

```ts
// lib/hollis/types.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { OrderCard, EscalationInput, SpiroCtx } from "./types";

test("types compile and shape as expected", () => {
  const card: OrderCard = {
    orderId: "o1", trackingCode: "abc", status: "confirmed", addressText: "15 Oak Dr, Mount Pleasant, SC",
    arrivalWindowStart: null, arrivalWindowEnd: null, photographerName: null, agentId: "a1",
  };
  assert.equal(card.trackingCode, "abc");
  const ctx: SpiroCtx = { baseUrl: "https://api.spiro.media", apiKey: "k", authScheme: "bearer" };
  assert.equal(ctx.authScheme, "bearer");
});
```

- [ ] **Step 3: Run typecheck + test**

Run: `npm run typecheck && node --import tsx --test lib/hollis/types.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/hollis/types.ts lib/hollis/types.test.ts
git commit -m "feat(hollis): order-desk types + HollisLine columns"
```

---

### Task 3: `phone.ts` — normalizeCallerNumber

**Files:**
- Create: `lib/hollis/phone.ts`, `lib/hollis/phone.test.ts`

**Interfaces:**
- Produces: `normalizeCallerNumber(raw: string | null | undefined): string | null` → US E.164 (`+1XXXXXXXXXX`) or `null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/hollis/phone.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCallerNumber } from "./phone";

test("normalizes US numbers to E.164", () => {
  assert.equal(normalizeCallerNumber("+18435551234"), "+18435551234");
  assert.equal(normalizeCallerNumber("8435551234"), "+18435551234");
  assert.equal(normalizeCallerNumber("18435551234"), "+18435551234");
  assert.equal(normalizeCallerNumber("(843) 555-1234"), "+18435551234");
});

test("returns null for unusable input", () => {
  assert.equal(normalizeCallerNumber(""), null);
  assert.equal(normalizeCallerNumber(null), null);
  assert.equal(normalizeCallerNumber("12345"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test lib/hollis/phone.test.ts`
Expected: FAIL (`Cannot find module './phone'`).

- [ ] **Step 3: Implement**

```ts
// lib/hollis/phone.ts
/** Normalize a raw caller-id string to US E.164 (+1XXXXXXXXXX), or null. */
export function normalizeCallerNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed; // already E.164
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test lib/hollis/phone.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hollis/phone.ts lib/hollis/phone.test.ts
git commit -m "feat(hollis): normalizeCallerNumber (E.164)"
```

---

### Task 4: `spiro.ts` — pure normalizers (`toOrderCard`, `toAgent`)

**Files:**
- Create: `lib/hollis/spiro.ts`, `lib/hollis/spiro.test.ts`

**Interfaces:**
- Consumes: `OrderCard`, `SpiroAgent` (Task 2).
- Produces: `toOrderCard(raw: any): OrderCard`, `toAgent(raw: any): SpiroAgent`.

- [ ] **Step 1: Write the failing test** (uses the real verified shape)

```ts
// lib/hollis/spiro.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toOrderCard, toAgent } from "./spiro";

const rawOrder = {
  orderId: "o1", trackingCode: "r2m360pl1", status: "confirmed",
  address: { streetAddress: "15 Oak Dr", fullAddress: "15 Oak Dr, Mount Pleasant, SC 29466", city: "Mount Pleasant", stateOrProvince: "SC", postalCode: "29466" },
  client: { agentId: "a1", agentName: "Vanessa B", companyName: "Unassigned" },
  primaryAppointment: { appointmentId: "ap1", arrivalWindowStart: "2026-07-14T14:30:00-04:00", arrivalWindowEnd: "2026-07-14T14:30:00-04:00", photographer: { photographerId: "p1", name: "Taylor Thurber" } },
};

test("toOrderCard flattens the verified order shape", () => {
  const c = toOrderCard(rawOrder);
  assert.equal(c.trackingCode, "r2m360pl1");
  assert.equal(c.status, "confirmed");
  assert.equal(c.addressText, "15 Oak Dr, Mount Pleasant, SC");
  assert.equal(c.arrivalWindowStart, "2026-07-14T14:30:00-04:00");
  assert.equal(c.photographerName, "Taylor Thurber");
  assert.equal(c.agentId, "a1");
});

test("toAgent flattens nested identity/contact/company", () => {
  const a = toAgent({ identity: { agentId: "a1", firstName: "Vanessa", lastName: "Beem" }, contact: { emailAddress: "v@x.com", phoneNumber: "+18435551234" }, company: { companyName: "ACME" } });
  assert.equal(a.agentId, "a1");
  assert.equal(a.phone, "+18435551234");
  assert.equal(a.companyName, "ACME");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test lib/hollis/spiro.test.ts`
Expected: FAIL (`Cannot find module './spiro'`).

- [ ] **Step 3: Implement**

```ts
// lib/hollis/spiro.ts
import type { OrderCard, SpiroAgent, SpiroCtx } from "./types";

export function toOrderCard(o: any): OrderCard {
  const addr = o?.address ?? {};
  const addressText = [addr.streetAddress || addr.fullAddress, addr.city, addr.stateOrProvince].filter(Boolean).join(", ");
  const appt = o?.primaryAppointment ?? {};
  return {
    orderId: String(o?.orderId ?? ""),
    trackingCode: String(o?.trackingCode ?? ""),
    status: o?.status ?? "unknown",
    addressText,
    arrivalWindowStart: appt.arrivalWindowStart ?? null,
    arrivalWindowEnd: appt.arrivalWindowEnd ?? null,
    photographerName: appt?.photographer?.name ?? null,
    agentId: String(o?.client?.agentId ?? o?.agentId ?? ""),
  };
}

export function toAgent(a: any): SpiroAgent {
  return {
    agentId: String(a?.identity?.agentId ?? a?.agentId ?? ""),
    firstName: a?.identity?.firstName ?? a?.firstName ?? "",
    lastName: a?.identity?.lastName ?? a?.lastName ?? "",
    email: a?.contact?.emailAddress ?? a?.emailAddress ?? null,
    phone: a?.contact?.phoneNumber ?? a?.phoneNumber ?? null,
    companyName: a?.company?.companyName ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test lib/hollis/spiro.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hollis/spiro.ts lib/hollis/spiro.test.ts
git commit -m "feat(hollis): Spiro toOrderCard/toAgent normalizers"
```

---

### Task 5: `spiro.ts` — fetch + agent/order lookups

**Files:**
- Modify: `lib/hollis/spiro.ts`, `lib/hollis/spiro.test.ts`

**Interfaces:**
- Consumes: `toOrderCard`, `toAgent`, `SpiroCtx`.
- Produces:
  - `type SpiroResult<T> = { ok: true; value: T } | { ok: false; kind: "auth"|"transient"|"bad"; message: string }`
  - `spiroGet(ctx, path, fetchImpl?): Promise<SpiroResult<any>>`
  - `findAgentByPhone(ctx, e164, fetchImpl?): Promise<SpiroResult<SpiroAgent | null>>`
  - `findAgentByEmail(ctx, email, fetchImpl?): Promise<SpiroResult<SpiroAgent | null>>`
  - `listAgentOrders(ctx, agentId, opts?, fetchImpl?): Promise<SpiroResult<OrderCard[]>>`
  - `findAgentById(ctx, agentId, fetchImpl?): Promise<SpiroResult<SpiroAgent | null>>`
  - `findOrderByTracking(ctx, trackingCode, fetchImpl?): Promise<SpiroResult<{ order: OrderCard | null; agentId: string | null }>>`
  - `getOrderDetail(ctx, orderId, fetchImpl?): Promise<SpiroResult<{ cancellationAmount: number|null; rescheduleAmount: number|null }>>` (+ exported `OrderPricing`)

- [ ] **Step 1: Write the failing tests** (mocked fetch)

```ts
// append to lib/hollis/spiro.test.ts
import { spiroGet, findAgentByPhone, listAgentOrders, findOrderByTracking, getOrderDetail } from "./spiro";

const ctx = { baseUrl: "https://api.spiro.media", apiKey: "k", authScheme: "bearer" as const };
function fakeFetch(status: number, body: unknown) {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("spiroGet maps 401 to auth error", async () => {
  const r = await spiroGet(ctx, "/api/v1/orders", fakeFetch(401, {}) as unknown as typeof fetch);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, "auth");
});

test("findAgentByPhone returns first agent or null", async () => {
  const hit = await findAgentByPhone(ctx, "+18435551234", fakeFetch(200, { data: [{ identity: { agentId: "a1", firstName: "V", lastName: "B" }, contact: { phoneNumber: "+18435551234", emailAddress: "v@x.com" } }] }) as unknown as typeof fetch);
  assert.equal(hit.ok, true);
  if (hit.ok) assert.equal(hit.value?.agentId, "a1");
  const miss = await findAgentByPhone(ctx, "+10000000000", fakeFetch(200, { data: [] }) as unknown as typeof fetch);
  if (miss.ok) assert.equal(miss.value, null);
});

test("listAgentOrders maps orders to cards", async () => {
  const r = await listAgentOrders(ctx, "a1", { limit: 5 }, fakeFetch(200, { data: [{ orderId: "o1", trackingCode: "t1", status: "confirmed", address: { streetAddress: "1 A St", city: "X", stateOrProvince: "SC" }, client: { agentId: "a1" }, primaryAppointment: {} }] }) as unknown as typeof fetch);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value[0].trackingCode, "t1");
});

test("findOrderByTracking resolves an order + agentId globally (no prior agent match)", async () => {
  const r = await findOrderByTracking(ctx, "r2m360pl1", fakeFetch(200, { data: [{ orderId: "o1", trackingCode: "r2m360pl1", status: "confirmed", address: { streetAddress: "1 A St", city: "X", stateOrProvince: "SC" }, client: { agentId: "a9" }, primaryAppointment: {} }] }) as unknown as typeof fetch);
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.value.order?.orderId, "o1"); assert.equal(r.value.agentId, "a9"); }
});

test("getOrderDetail extracts staff-only fee fields", async () => {
  const r = await getOrderDetail(ctx, "o1", fakeFetch(200, { data: { pricing: { cancellationAmount: 50, rescheduleAmount: 0 } } }) as unknown as typeof fetch);
  if (r.ok) { assert.equal(r.value.cancellationAmount, 50); assert.equal(r.value.rescheduleAmount, 0); }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test lib/hollis/spiro.test.ts`
Expected: FAIL (exports not defined).

- [ ] **Step 3: Implement** (append to `lib/hollis/spiro.ts`)

```ts
export type SpiroResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "auth" | "transient" | "bad"; message: string };

type FetchImpl = typeof fetch;

function authHeaders(ctx: SpiroCtx): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (ctx.authScheme === "x-api-key") h["x-api-key"] = ctx.apiKey;
  else h["Authorization"] = `Bearer ${ctx.apiKey}`;
  return h;
}

export async function spiroGet(ctx: SpiroCtx, path: string, fetchImpl: FetchImpl = fetch): Promise<SpiroResult<any>> {
  let res: Response;
  try {
    res = await fetchImpl(ctx.baseUrl.replace(/\/$/, "") + path, { headers: authHeaders(ctx), signal: AbortSignal.timeout(8000) });
  } catch (e) {
    return { ok: false, kind: "transient", message: (e as Error).message };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, kind: "auth", message: `Spiro ${res.status}` };
  if (res.status >= 500) return { ok: false, kind: "transient", message: `Spiro ${res.status}` };
  let json: any;
  try { json = JSON.parse(await res.text()); } catch { return { ok: false, kind: "bad", message: "non-JSON response" }; }
  if (!res.ok) return { ok: false, kind: "bad", message: `Spiro ${res.status}` };
  return { ok: true, value: json };
}

export async function findAgentByPhone(ctx: SpiroCtx, e164: string, fetchImpl: FetchImpl = fetch): Promise<SpiroResult<SpiroAgent | null>> {
  const r = await spiroGet(ctx, `/api/v1/agents?filter[phoneNumber][eq]=${encodeURIComponent(e164)}&pageSize=1`, fetchImpl);
  if (!r.ok) return r;
  const a = r.value?.data?.[0];
  return { ok: true, value: a ? toAgent(a) : null };
}

export async function findAgentByEmail(ctx: SpiroCtx, email: string, fetchImpl: FetchImpl = fetch): Promise<SpiroResult<SpiroAgent | null>> {
  const r = await spiroGet(ctx, `/api/v1/agents?filter[emailAddress][eq]=${encodeURIComponent(email)}&pageSize=1`, fetchImpl);
  if (!r.ok) return r;
  const a = r.value?.data?.[0];
  return { ok: true, value: a ? toAgent(a) : null };
}

export async function listAgentOrders(ctx: SpiroCtx, agentId: string, opts: { limit?: number } = {}, fetchImpl: FetchImpl = fetch): Promise<SpiroResult<OrderCard[]>> {
  const path = `/api/v1/orders?filter[agentId][eq]=${encodeURIComponent(agentId)}&pageSize=${opts.limit ?? 10}&sort=-dateSubmitted`;
  const r = await spiroGet(ctx, path, fetchImpl);
  if (!r.ok) return r;
  const arr = Array.isArray(r.value?.data) ? r.value.data : [];
  return { ok: true, value: arr.map(toOrderCard) };
}

export async function findAgentById(ctx: SpiroCtx, agentId: string, fetchImpl: FetchImpl = fetch): Promise<SpiroResult<SpiroAgent | null>> {
  const r = await spiroGet(ctx, `/api/v1/agents/${encodeURIComponent(agentId)}`, fetchImpl);
  if (!r.ok) return r;
  const a = r.value?.data ?? r.value;
  return { ok: true, value: a?.identity || a?.agentId ? toAgent(a) : null };
}

// Global order lookup by tracking code — works WITHOUT a prior agent match (spec §3.2, no-phone-match path).
export async function findOrderByTracking(ctx: SpiroCtx, trackingCode: string, fetchImpl: FetchImpl = fetch): Promise<SpiroResult<{ order: OrderCard | null; agentId: string | null }>> {
  const r = await spiroGet(ctx, `/api/v1/orders?filter[trackingCode][eq]=${encodeURIComponent(trackingCode)}&pageSize=1`, fetchImpl);
  if (!r.ok) return r;
  const raw = r.value?.data?.[0] ?? null;
  const order = raw ? toOrderCard(raw) : null;
  return { ok: true, value: { order, agentId: order?.agentId || null } };
}

export interface OrderPricing { cancellationAmount: number | null; rescheduleAmount: number | null; }
// Order detail carries the staff-only fee fields (spec §9 — never spoken to caller).
export async function getOrderDetail(ctx: SpiroCtx, orderId: string, fetchImpl: FetchImpl = fetch): Promise<SpiroResult<OrderPricing>> {
  const r = await spiroGet(ctx, `/api/v1/orders/${encodeURIComponent(orderId)}`, fetchImpl);
  if (!r.ok) return r;
  const p = (r.value?.data ?? r.value)?.pricing ?? {};
  return { ok: true, value: { cancellationAmount: p.cancellationAmount ?? null, rescheduleAmount: p.rescheduleAmount ?? null } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test lib/hollis/spiro.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hollis/spiro.ts lib/hollis/spiro.test.ts
git commit -m "feat(hollis): Spiro fetch + agent/order lookups + detail/tracking"
```

---

### Task 6: `spiro.ts` — resolveOrder (verification matcher)

**Files:**
- Modify: `lib/hollis/spiro.ts`, `lib/hollis/spiro.test.ts`

**Interfaces:**
- Consumes: `listAgentOrders`.
- Produces: `resolveOrder(ctx, { agentId, trackingCode?, addressText? }, fetchImpl?): Promise<SpiroResult<{ match: OrderCard | null; candidates: OrderCard[] }>>` — `match` non-null only when a single order matches the provided tracking code or address (the verification detail).

- [ ] **Step 1: Write the failing tests**

```ts
// append to lib/hollis/spiro.test.ts
import { resolveOrder } from "./spiro";

const twoOrders = { data: [
  { orderId: "o1", trackingCode: "aaa111", status: "confirmed", address: { streetAddress: "15 Oak Dr", city: "Mount Pleasant", stateOrProvince: "SC" }, client: { agentId: "a1" }, primaryAppointment: {} },
  { orderId: "o2", trackingCode: "bbb222", status: "editing", address: { streetAddress: "9 Palm Ct", city: "Charleston", stateOrProvince: "SC" }, client: { agentId: "a1" }, primaryAppointment: {} },
]};

test("resolveOrder matches by tracking code", async () => {
  const r = await resolveOrder(ctx, { agentId: "a1", trackingCode: "BBB222" }, fakeFetch(200, twoOrders) as unknown as typeof fetch);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.match?.orderId, "o2");
});

test("resolveOrder matches by address text", async () => {
  const r = await resolveOrder(ctx, { agentId: "a1", addressText: "15 oak drive" }, fakeFetch(200, twoOrders) as unknown as typeof fetch);
  if (r.ok) assert.equal(r.value.match?.orderId, "o1");
});

test("resolveOrder returns no match when detail is absent", async () => {
  const r = await resolveOrder(ctx, { agentId: "a1" }, fakeFetch(200, twoOrders) as unknown as typeof fetch);
  if (r.ok) { assert.equal(r.value.match, null); assert.equal(r.value.candidates.length, 2); }
});

test("resolveOrder ignores empty candidate addresses (no false match)", async () => {
  const withEmpty = { data: [
    { orderId: "o3", trackingCode: "ccc333", status: "confirmed", address: {}, client: { agentId: "a1" }, primaryAppointment: {} },
    { orderId: "o1", trackingCode: "aaa111", status: "confirmed", address: { streetAddress: "15 Oak Dr", city: "Mount Pleasant", stateOrProvince: "SC" }, client: { agentId: "a1" }, primaryAppointment: {} },
  ]};
  const r = await resolveOrder(ctx, { agentId: "a1", addressText: "15 Oak Dr" }, fakeFetch(200, withEmpty) as unknown as typeof fetch);
  if (r.ok) assert.equal(r.value.match?.orderId, "o1");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test lib/hollis/spiro.test.ts`
Expected: FAIL (`resolveOrder` not exported).

- [ ] **Step 3: Implement** (append to `lib/hollis/spiro.ts`)

```ts
function normAddr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function houseNumber(s: string): string | null {
  const m = s.trim().match(/^\s*(\d+)/);
  return m ? m[1] : null;
}

export async function resolveOrder(
  ctx: SpiroCtx,
  params: { agentId: string; trackingCode?: string; addressText?: string },
  fetchImpl: FetchImpl = fetch,
): Promise<SpiroResult<{ match: OrderCard | null; candidates: OrderCard[] }>> {
  const listed = await listAgentOrders(ctx, params.agentId, { limit: 25 }, fetchImpl);
  if (!listed.ok) return listed;
  const orders = listed.value;
  if (params.trackingCode) {
    const t = params.trackingCode.trim().toLowerCase();
    const m = orders.find((o) => o.trackingCode.toLowerCase() === t);
    return { ok: true, value: { match: m ?? null, candidates: orders } };
  }
  if (params.addressText) {
    const q = normAddr(params.addressText);
    const qNum = houseNumber(params.addressText);
    const matches = q ? orders.filter((o) => {
      const a = normAddr(o.addressText);
      if (!a) return false;                                 // never let an empty candidate address match
      const aNum = houseNumber(o.addressText);
      if (qNum && aNum && qNum !== aNum) return false;      // house number must agree when both are present
      return a.includes(q) || q.includes(a);
    }) : [];
    if (matches.length === 1) return { ok: true, value: { match: matches[0], candidates: orders } };
    return { ok: true, value: { match: null, candidates: matches.length ? matches : orders } };
  }
  return { ok: true, value: { match: null, candidates: orders } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test lib/hollis/spiro.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hollis/spiro.ts lib/hollis/spiro.test.ts
git commit -m "feat(hollis): resolveOrder verification matcher"
```

---

### Task 7: `spiro.ts` — SpiroCtx loading (pure builder + DB wrapper)

**Files:**
- Modify: `lib/hollis/spiro.ts`, `lib/hollis/spiro.test.ts`

**Interfaces:**
- Produces:
  - `buildSpiroCtx(config: any, secretPlaintext: string): SpiroCtx` (pure)
  - `loadSpiroCtx(clientId: string, spiroSourceId: string | null): Promise<SpiroCtx | null>` (lazy-supabase + `decryptSecret`; not unit-tested)

- [ ] **Step 1: Write the failing test for the pure builder**

```ts
// append to lib/hollis/spiro.test.ts
import { buildSpiroCtx } from "./spiro";

test("buildSpiroCtx defaults base url + bearer, honors x-api-key", () => {
  assert.deepEqual(buildSpiroCtx({}, "secret"), { baseUrl: "https://api.spiro.media", apiKey: "secret", authScheme: "bearer" });
  assert.equal(buildSpiroCtx({ authScheme: "x-api-key", baseUrl: "https://api.spiro.media/" }, "s").authScheme, "x-api-key");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test lib/hollis/spiro.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** (append to `lib/hollis/spiro.ts`)

```ts
export function buildSpiroCtx(config: any, secretPlaintext: string): SpiroCtx {
  const cfg = config ?? {};
  return {
    baseUrl: (cfg.baseUrl ?? "https://api.spiro.media").replace(/\/$/, ""),
    apiKey: secretPlaintext,
    authScheme: cfg.authScheme === "x-api-key" ? "x-api-key" : "bearer",
  };
}

export async function loadSpiroCtx(clientId: string, spiroSourceId: string | null): Promise<SpiroCtx | null> {
  if (!spiroSourceId) return null;
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin
    .from("client_data_sources")
    .select("config, secret_enc")
    .eq("id", spiroSourceId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!data?.secret_enc) return null;
  const { decryptSecret } = await import("@/lib/analytics/crypto");
  return buildSpiroCtx(data.config, decryptSecret(data.secret_enc));
}
```

- [ ] **Step 4: Run to verify it passes + typecheck**

Run: `node --import tsx --test lib/hollis/spiro.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hollis/spiro.ts lib/hollis/spiro.test.ts
git commit -m "feat(hollis): buildSpiroCtx + loadSpiroCtx (encrypted client_data_sources)"
```

---

### Task 8: `escalation.ts` — buildEscalationBlocks (pure)

**Files:**
- Create: `lib/hollis/escalation.ts`, `lib/hollis/escalation.test.ts`

**Interfaces:**
- Consumes: `EscalationInput` (Task 2), `SlackBlock` from `@/lib/slack`.
- Produces: `buildEscalationBlocks(input: EscalationInput): SlackBlock[]`, `escalationText(input): string` (Slack notification fallback text).

- [ ] **Step 1: Write the failing test**

```ts
// lib/hollis/escalation.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEscalationBlocks, escalationText } from "./escalation";
import type { EscalationInput } from "./types";

const base: EscalationInput = {
  type: "reschedule", clientId: "c1", lineId: "l1", slackChannel: "C1", staffEmail: "ops@ep.com",
  callerNumber: "+18435551234", agentId: "a1", retellCallId: "call_abc", verified: true,
  order: { orderId: "o1", trackingCode: "r2m360pl1", status: "confirmed", addressText: "15 Oak Dr, Mount Pleasant, SC", arrivalWindowStart: "2026-07-14T14:30:00-04:00", arrivalWindowEnd: "2026-07-14T14:30:00-04:00", photographerName: "Taylor Thurber", agentId: "a1" },
  fields: { desired_window: "Wednesday morning", reason: "seller conflict" },
  staffContext: { rescheduleAmount: 0 },
};

test("blocks include type header, order ref, and captured fields", () => {
  const blocks = buildEscalationBlocks(base);
  const json = JSON.stringify(blocks);
  assert.match(json, /Reschedule/i);
  assert.match(json, /r2m360pl1/);
  assert.match(json, /desired_window|Wednesday morning/i);
  assert.match(json, /call_abc/); // retell call id rendered for traceability
  assert.ok(blocks.length >= 2);
});

test("escalationText is a concise one-liner", () => {
  assert.match(escalationText(base), /Reschedule/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test lib/hollis/escalation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// lib/hollis/escalation.ts
import type { SlackBlock } from "@/lib/slack";
import type { EscalationInput, EscalationType } from "./types";

const LABEL: Record<EscalationType, string> = {
  reschedule: "🔁 Reschedule request",
  new_order: "🆕 New order request",
  cancel: "❌ Cancellation request",
};

export function escalationText(input: EscalationInput): string {
  const ref = input.order?.trackingCode ? ` (${input.order.trackingCode})` : "";
  return `${LABEL[input.type]}${ref} via Hollis`;
}

export function buildEscalationBlocks(input: EscalationInput): SlackBlock[] {
  const lines: string[] = [];
  if (input.callerNumber) lines.push(`*Caller:* ${input.callerNumber}`);
  lines.push(`*Verified:* ${input.verified ? "yes" : "NO — unverified"}`);
  if (input.order) {
    lines.push(`*Order:* ${input.order.trackingCode} — ${input.order.status}`);
    lines.push(`*Property:* ${input.order.addressText}`);
    if (input.order.arrivalWindowStart) lines.push(`*Current window:* ${input.order.arrivalWindowStart}`);
    if (input.order.photographerName) lines.push(`*Photographer:* ${input.order.photographerName}`);
  }
  for (const [k, v] of Object.entries(input.fields)) lines.push(`*${k}:* ${String(v)}`);
  for (const [k, v] of Object.entries(input.staffContext ?? {})) lines.push(`_${k}: ${String(v)} (staff context)_`);

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: LABEL[input.type] } as any },
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } as any },
  ];
  const ctxBits: string[] = [];
  if (input.order?.orderId) ctxBits.push(`<https://admin.spiro.media/orders/${input.order.orderId}|Open in Spiro admin>`);
  if (input.retellCallId) ctxBits.push(`call \`${input.retellCallId}\``);
  if (ctxBits.length) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: ctxBits.join("  ·  ") }] } as any);
  return blocks;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test lib/hollis/escalation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hollis/escalation.ts lib/hollis/escalation.test.ts
git commit -m "feat(hollis): buildEscalationBlocks Slack payload"
```

---

### Task 9: `escalation.ts` — postEscalation (persist + post + fallback)

**Files:**
- Modify: `lib/hollis/escalation.ts`, `lib/hollis/escalation.test.ts`

**Interfaces:**
- Consumes: `buildEscalationBlocks`, `escalationText`, `postSlackMessage` from `@/lib/slack`.
- Produces:
  - `type EscalationDeps = { insertRow, updateRow, getSlackToken, postSlack, sendStaffEmail }` (all injectable; defaults use real infra)
  - `postEscalation(input: EscalationInput, deps?: Partial<EscalationDeps>): Promise<{ ok: boolean; slackTs?: string; fallback?: "email" }>`

- [ ] **Step 1: Write the failing tests** (all deps faked)

```ts
// append to lib/hollis/escalation.test.ts
import { postEscalation } from "./escalation";

function deps(over = {}) {
  const calls: any = { inserted: null, updated: null, slack: null, email: null };
  return { calls, deps: {
    insertRow: async (row: any) => { calls.inserted = row; return "esc1"; },
    updateRow: async (id: string, patch: any) => { calls.updated = { id, patch }; },
    getSlackToken: async () => "xoxb-test",
    postSlack: async (o: any) => { calls.slack = o; return { ok: true, ts: "1700.1" }; },
    sendStaffEmail: async (o: any) => { calls.email = o; },
    ...over,
  } };
}

test("posts to Slack and marks the row open with ts", async () => {
  const { calls, deps: d } = deps();
  const r = await postEscalation(base, d);
  assert.equal(r.ok, true);
  assert.equal(r.slackTs, "1700.1");
  assert.equal(calls.inserted.type, "reschedule");
  assert.equal(calls.slack.channel, "C1");
  assert.equal(calls.email, null);
});

test("falls back to staff email when Slack fails", async () => {
  const { calls, deps: d } = deps({ postSlack: async () => { throw new Error("slack down"); } });
  const r = await postEscalation(base, d);
  assert.equal(r.ok, false);
  assert.equal(r.fallback, "email");
  assert.equal(calls.email.to, "ops@ep.com");
  assert.equal(calls.updated.patch.status, "failed");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test lib/hollis/escalation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** (append to `lib/hollis/escalation.ts`)

```ts
import { postSlackMessage } from "@/lib/slack";

export type EscalationDeps = {
  insertRow: (row: Record<string, unknown>) => Promise<string>;
  updateRow: (id: string, patch: Record<string, unknown>) => Promise<void>;
  getSlackToken: (clientId: string) => Promise<string | null>;
  postSlack: (o: { botToken: string; channel: string; text: string; blocks: SlackBlock[] }) => Promise<{ ok: boolean; ts?: string }>;
  sendStaffEmail: (o: { to: string; subject: string; text: string }) => Promise<void>;
};

async function defaultInsertRow(row: Record<string, unknown>): Promise<string> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin.from("hollis_escalations").insert(row).select("id").single();
  return data!.id as string;
}
async function defaultUpdateRow(id: string, patch: Record<string, unknown>): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  await supabaseAdmin.from("hollis_escalations").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}
async function defaultGetSlackToken(clientId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin.from("steward_platform_tokens").select("token_data").eq("client_id", clientId).eq("platform", "slack").maybeSingle();
  return (data?.token_data as any)?.access_token ?? null;
}
async function defaultPostSlack(o: { botToken: string; channel: string; text: string; blocks: SlackBlock[] }) {
  const res = await postSlackMessage(o);
  return { ok: !!(res as any)?.ok, ts: (res as any)?.ts as string | undefined };
}
async function defaultSendStaffEmail(o: { to: string; subject: string; text: string }): Promise<void> {
  const { resend, DEFAULT_FROM } = await import("@/lib/resend");
  await resend().emails.send({ from: DEFAULT_FROM, to: o.to, subject: o.subject, text: o.text });
}

export async function postEscalation(
  input: EscalationInput,
  overrides: Partial<EscalationDeps> = {},
): Promise<{ ok: boolean; slackTs?: string; fallback?: "email" }> {
  const d: EscalationDeps = {
    insertRow: defaultInsertRow, updateRow: defaultUpdateRow, getSlackToken: defaultGetSlackToken,
    postSlack: defaultPostSlack, sendStaffEmail: defaultSendStaffEmail, ...overrides,
  };

  const escId = await d.insertRow({
    client_id: input.clientId, line_id: input.lineId, call_id: input.callId ?? null, retell_call_id: input.retellCallId ?? null,
    type: input.type, spiro_order_id: input.order?.orderId ?? null, tracking_code: input.order?.trackingCode ?? null,
    verified: input.verified, caller_number: input.callerNumber ?? null, spiro_agent_id: input.agentId ?? null,
    payload: input.fields, slack_channel: input.slackChannel, status: "open",
  });

  const token = input.slackChannel ? await d.getSlackToken(input.clientId) : null;
  if (token && input.slackChannel) {
    try {
      const res = await d.postSlack({ botToken: token, channel: input.slackChannel, text: escalationText(input), blocks: buildEscalationBlocks(input) });
      if (res.ok) { await d.updateRow(escId, { slack_ts: res.ts ?? null }); return { ok: true, slackTs: res.ts }; }
      throw new Error("slack not ok");
    } catch {
      /* fall through to email */
    }
  }

  await d.updateRow(escId, { status: "failed", delivery_fallback: "email" });
  if (input.staffEmail) {
    await d.sendStaffEmail({ to: input.staffEmail, subject: escalationText(input), text: JSON.stringify(input.fields, null, 2) });
  }
  return { ok: false, fallback: "email" };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test lib/hollis/escalation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hollis/escalation.ts lib/hollis/escalation.test.ts
git commit -m "feat(hollis): postEscalation persist+Slack+email fallback"
```

---

### Task 10: `escalation.ts` — postCallSummary

**Files:**
- Modify: `lib/hollis/escalation.ts`, `lib/hollis/escalation.test.ts`

**Interfaces:**
- Produces: `buildSummaryText(summary: { caller?: string; outcome: string; asks: string[] }): string` (pure) and `postCallSummary(args: { clientId: string; channel: string | null; summary: {...} }, overrides?): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// append to lib/hollis/escalation.test.ts
import { buildSummaryText } from "./escalation";

test("summary text is one concise line", () => {
  const t = buildSummaryText({ caller: "+18435551234", outcome: "booking_request", asks: ["reschedule o1"] });
  assert.match(t, /\+18435551234/);
  assert.match(t, /reschedule o1/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test lib/hollis/escalation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** (append)

```ts
export function buildSummaryText(summary: { caller?: string; outcome: string; asks: string[] }): string {
  const who = summary.caller ? `📞 ${summary.caller}` : "📞 caller";
  const asks = summary.asks.length ? summary.asks.join("; ") : "no action";
  return `${who} — ${summary.outcome} — ${asks}`;
}

export async function postCallSummary(
  args: { clientId: string; channel: string | null; summary: { caller?: string; outcome: string; asks: string[] } },
  overrides: Partial<Pick<EscalationDeps, "getSlackToken" | "postSlack">> = {},
): Promise<void> {
  if (!args.channel) return;
  const getSlackToken = overrides.getSlackToken ?? defaultGetSlackToken;
  const postSlack = overrides.postSlack ?? defaultPostSlack;
  const token = await getSlackToken(args.clientId);
  if (!token) return;
  const text = buildSummaryText(args.summary);
  await postSlack({ botToken: token, channel: args.channel, text, blocks: [{ type: "section", text: { type: "mrkdwn", text } as any }] });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test lib/hollis/escalation.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hollis/escalation.ts lib/hollis/escalation.test.ts
git commit -m "feat(hollis): postCallSummary"
```

---

### Task 11: `tools.ts` — handleLookupOrder

**Files:**
- Modify: `lib/hollis/tools.ts`, `lib/hollis/tools.test.ts`

**Interfaces:**
- Consumes: `normalizeCallerNumber` (T3); `loadSpiroCtx`/`findAgentByPhone`/`findAgentByEmail`/`findAgentById`/`findOrderByTracking`/`getOrderDetail`/`resolveOrder` (T4–7); `postEscalation` (T9); `logEvent` from `@/lib/logger`.
- Produces:
  - Extended `ToolCtx` — add `callerNumber?: string | null;` and extend `line` with `agent_name?, order_ops_enabled?, spiro_source_id?, slack_channel_id?, booking_email?`.
  - `type OrderToolDeps` — injectable deps: `loadSpiroCtx, findAgentByPhone, findAgentByEmail, findAgentById, findOrderByTracking, getOrderDetail, resolveOrder, postEscalation`.
  - Module-private `resolveAgentAndOrder(...)` returning `{ error?, agent?, order?, candidates?, spiro? }` (reused by Task 12).
  - `handleLookupOrder(args: { tracking_code?: string; property_address?: string; agent_email?: string }, ctx: ToolCtx, deps?: Partial<OrderToolDeps>): Promise<string>` — returns the spoken `result`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to lib/hollis/tools.test.ts
import { handleLookupOrder } from "./tools";

const orderCard = { orderId: "o1", trackingCode: "r2m360pl1", status: "confirmed", addressText: "15 Oak Dr, Mount Pleasant, SC", arrivalWindowStart: "2026-07-14T14:30:00-04:00", arrivalWindowEnd: null, photographerName: "Taylor Thurber", agentId: "a1" };
const fakeAgent = { agentId: "a1", firstName: "V", lastName: "B", email: "v@x.com", phone: "+18435551234", companyName: null };
function orderDeps(over = {}) {
  return {
    loadSpiroCtx: async () => ({ baseUrl: "https://api.spiro.media", apiKey: "k", authScheme: "bearer" as const }),
    findAgentByPhone: async () => ({ ok: true as const, value: fakeAgent }),
    findAgentByEmail: async () => ({ ok: true as const, value: null }),
    findAgentById: async () => ({ ok: true as const, value: fakeAgent }),
    findOrderByTracking: async () => ({ ok: true as const, value: { order: orderCard, agentId: "a1" } }),
    getOrderDetail: async () => ({ ok: true as const, value: { cancellationAmount: 0, rescheduleAmount: 0 } }),
    resolveOrder: async () => ({ ok: true as const, value: { match: orderCard, candidates: [orderCard] } }),
    postEscalation: async () => ({ ok: true }),
    ...over,
  };
}

test("lookup_order returns a spoken card when verified by tracking code", async () => {
  const ctx = fakeCtx({ callerNumber: "+18435551234", line: { id: "l1", client_id: "c1", order_ops_enabled: true, spiro_source_id: "s1" } as any });
  const out = await handleLookupOrder({ tracking_code: "r2m360pl1" }, ctx, orderDeps());
  assert.match(out, /confirmed/i);
  assert.match(out, /Taylor Thurber/);
});

test("lookup_order asks to verify when no matching detail", async () => {
  const ctx = fakeCtx({ callerNumber: "+18435551234", line: { id: "l1", client_id: "c1", order_ops_enabled: true, spiro_source_id: "s1" } as any });
  const out = await handleLookupOrder({}, ctx, orderDeps({ resolveOrder: async () => ({ ok: true as const, value: { match: null, candidates: [orderCard] } }) }));
  assert.match(out, /address or.*tracking|confirm/i);
});

test("lookup_order handles Spiro auth failure gracefully", async () => {
  const ctx = fakeCtx({ callerNumber: "+18435551234", line: { id: "l1", client_id: "c1", order_ops_enabled: true, spiro_source_id: "s1" } as any });
  const out = await handleLookupOrder({ tracking_code: "x" }, ctx, orderDeps({ findOrderByTracking: async () => ({ ok: false as const, kind: "auth", message: "401" }) }));
  assert.match(out, /trouble|team|later/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test lib/hollis/tools.test.ts`
Expected: FAIL (`handleLookupOrder` not exported; ctx fields unknown).

- [ ] **Step 3: Implement**

First, extend `ToolCtx` in `lib/hollis/tools.ts` (find the `export interface ToolCtx`/`export type ToolCtx`):

```ts
  // add to ToolCtx.line:
  //   agent_name?: string | null;
  //   booking_email?: string | null;
  //   order_ops_enabled?: boolean;
  //   spiro_source_id?: string | null;
  //   slack_channel_id?: string | null;
  // add to ToolCtx root:
  //   callerNumber?: string | null;
```

Then add imports + handler:

```ts
import { normalizeCallerNumber } from "./phone";
import {
  loadSpiroCtx as realLoadSpiroCtx, findAgentByPhone as realFindByPhone, findAgentByEmail as realFindByEmail,
  findAgentById as realFindById, findOrderByTracking as realFindByTracking, getOrderDetail as realGetOrderDetail,
  resolveOrder as realResolveOrder,
} from "./spiro";
import { postEscalation as realPostEscalation } from "./escalation";
import { logEvent } from "@/lib/logger";
import type { OrderCard, SpiroAgent, SpiroCtx } from "./types";

export type OrderToolDeps = {
  loadSpiroCtx: typeof realLoadSpiroCtx;
  findAgentByPhone: typeof realFindByPhone;
  findAgentByEmail: typeof realFindByEmail;
  findAgentById: typeof realFindById;
  findOrderByTracking: typeof realFindByTracking;
  getOrderDetail: typeof realGetOrderDetail;
  resolveOrder: typeof realResolveOrder;
  postEscalation: typeof realPostEscalation;
};
const REAL_DEPS: OrderToolDeps = {
  loadSpiroCtx: realLoadSpiroCtx, findAgentByPhone: realFindByPhone, findAgentByEmail: realFindByEmail,
  findAgentById: realFindById, findOrderByTracking: realFindByTracking, getOrderDetail: realGetOrderDetail,
  resolveOrder: realResolveOrder, postEscalation: realPostEscalation,
};

const CANT_HELP = "I'm having trouble reaching our order system right now — let me take a message and have the team follow up with you.";
const ASK_VERIFY = "To pull up your order I just need to confirm the property address or the order tracking code — which do you have handy?";

async function logSpiro(ctx: ToolCtx, res: { kind: string; message: string }): Promise<void> {
  await logEvent({ clientId: ctx.line.client_id, category: "hollis", level: "error", message: `spiro ${res.kind}: ${res.message}` });
}

type ResolveResult = { error?: string; agent?: SpiroAgent | null; order?: OrderCard | null; candidates?: OrderCard[]; spiro?: SpiroCtx };

async function resolveAgentAndOrder(
  args: { tracking_code?: string; property_address?: string; agent_email?: string },
  ctx: ToolCtx, d: OrderToolDeps,
): Promise<ResolveResult> {
  const spiro = await d.loadSpiroCtx(ctx.line.client_id, ctx.line.spiro_source_id ?? null);
  if (!spiro) return { error: CANT_HELP };

  // Tracking-code first — resolves globally, even when the caller's phone doesn't match an agent (spec §3.2).
  if (args.tracking_code) {
    const byTrack = await d.findOrderByTracking(spiro, args.tracking_code);
    if (!byTrack.ok) { await logSpiro(ctx, byTrack); return { error: CANT_HELP, spiro }; }
    if (byTrack.value.order) {
      let agent: SpiroAgent | null = null;
      if (byTrack.value.agentId) { const ar = await d.findAgentById(spiro, byTrack.value.agentId); if (ar.ok) agent = ar.value; }
      return { agent, order: byTrack.value.order, spiro };
    }
  }

  // Otherwise resolve the agent (phone → email), then match their order by address.
  const e164 = normalizeCallerNumber(ctx.callerNumber);
  let agent: SpiroAgent | null = null;
  if (e164) { const r = await d.findAgentByPhone(spiro, e164); if (!r.ok) { await logSpiro(ctx, r); return { error: CANT_HELP, spiro }; } agent = r.value; }
  if (!agent && args.agent_email) { const r = await d.findAgentByEmail(spiro, args.agent_email); if (!r.ok) { await logSpiro(ctx, r); return { error: CANT_HELP, spiro }; } agent = r.value; }
  if (!agent) return { error: "I couldn't find your account from this number — can you give me the email on the order, or the tracking code?", spiro };

  const resolved = await d.resolveOrder(spiro, { agentId: agent.agentId, addressText: args.property_address });
  if (!resolved.ok) { await logSpiro(ctx, resolved); return { error: CANT_HELP, spiro }; }
  return { agent, order: resolved.value.match, candidates: resolved.value.candidates, spiro };
}

function speakOrder(o: OrderCard): string {
  const when = o.arrivalWindowStart ? ` scheduled for ${o.arrivalWindowStart}` : "";
  const who = o.photographerName ? ` with ${o.photographerName}` : "";
  return `Your order for ${o.addressText} is ${o.status}${when}${who}.`;
}

export async function handleLookupOrder(
  args: { tracking_code?: string; property_address?: string; agent_email?: string },
  ctx: ToolCtx, overrides: Partial<OrderToolDeps> = {},
): Promise<string> {
  const d = { ...REAL_DEPS, ...overrides };
  const { error, order, candidates } = await resolveAgentAndOrder(args, ctx, d);
  if (error) return error;
  if (!order) {
    if (candidates && candidates.length > 1) {
      const list = candidates.slice(0, 3).map((c) => c.addressText).filter(Boolean).join("; ");
      return `I see a few orders on your account${list ? ` — ${list}` : ""}. Which property is it, or what's the tracking code?`;
    }
    return ASK_VERIFY;
  }
  await ctx.record({ tool: "lookup_order", fields: { trackingCode: order.trackingCode, status: order.status } });
  return speakOrder(order);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test lib/hollis/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hollis/tools.ts lib/hollis/tools.test.ts
git commit -m "feat(hollis): handleLookupOrder + OrderToolDeps + ToolCtx extension"
```

---

### Task 12: `tools.ts` — request handlers (reschedule / new order / cancel)

**Files:**
- Modify: `lib/hollis/tools.ts`, `lib/hollis/tools.test.ts`

**Interfaces:**
- Consumes: `resolveAgentAndOrder` (Task 11), `postEscalation`.
- Produces:
  - `handleRescheduleRequest(args: { tracking_code?: string; property_address?: string; agent_email?: string; desired_window: string; reason?: string }, ctx, deps?): Promise<string>`
  - `handleCancellationRequest(args: { tracking_code?: string; property_address?: string; agent_email?: string; reason?: string }, ctx, deps?): Promise<string>`
  - `handleNewOrderRequest(args: { property_address: string; package_or_services: string; preferred_datetime: string; access_notes?: string; agent_email?: string }, ctx, deps?): Promise<string>`

- [ ] **Step 1: Write the failing tests**

```ts
// append to lib/hollis/tools.test.ts
import { handleRescheduleRequest, handleCancellationRequest, handleNewOrderRequest } from "./tools";

const SENT = /sent (this|that|it).*(team|over)|our team.*email|confirm by email/i;

test("reschedule escalates a verified order and promises email", async () => {
  const ctx = fakeCtx({ callerNumber: "+18435551234", line: { id: "l1", client_id: "c1", order_ops_enabled: true, spiro_source_id: "s1", slack_channel_id: "C1", booking_email: "ops@ep.com" } as any });
  let posted: any = null;
  const out = await handleRescheduleRequest({ tracking_code: "r2m360pl1", desired_window: "Wed AM" }, ctx, orderDeps({ postEscalation: async (i: any) => { posted = i; return { ok: true }; } }));
  assert.equal(posted.type, "reschedule");
  assert.equal(posted.verified, true);
  assert.match(out, SENT);
});

test("reschedule refuses when the order can't be verified", async () => {
  const ctx = fakeCtx({ callerNumber: "+18435551234", line: { id: "l1", client_id: "c1", order_ops_enabled: true, spiro_source_id: "s1" } as any });
  const out = await handleRescheduleRequest({ desired_window: "Wed AM" }, ctx, orderDeps({ resolveOrder: async () => ({ ok: true as const, value: { match: null, candidates: [] } }) }));
  assert.match(out, /confirm|address or.*tracking/i);
});

test("new order escalates without needing an existing order", async () => {
  const ctx = fakeCtx({ callerNumber: "+18435551234", line: { id: "l1", client_id: "c1", order_ops_enabled: true, spiro_source_id: "s1", slack_channel_id: "C1", booking_email: "ops@ep.com" } as any });
  let posted: any = null;
  const out = await handleNewOrderRequest({ property_address: "9 Palm Ct", package_or_services: "Deluxe + Drone", preferred_datetime: "next Tuesday AM" }, ctx, orderDeps({ postEscalation: async (i: any) => { posted = i; return { ok: true }; } }));
  assert.equal(posted.type, "new_order");
  assert.match(out, SENT);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test lib/hollis/tools.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** (append to `lib/hollis/tools.ts`)

```ts
import type { EscalationInput } from "./types";

const SENT_MSG = "Perfect — I've sent that to our team and they'll confirm by email shortly. Anything else?";
const SENT_LOGGED = "I've logged that for our team and they'll follow up with you. Anything else?";
const NEED_VERIFY = "Before I can put that request in, I need to confirm the property address or the order tracking code — which do you have?";

function agentContact(agent?: SpiroAgent | null): Record<string, unknown> {
  if (!agent) return {};
  const name = `${agent.firstName ?? ""} ${agent.lastName ?? ""}`.trim();
  return { caller_name: name, caller_email: agent.email ?? "" };
}

function baseEscalation(ctx: ToolCtx, agentId: string | null, order: OrderCard | null, type: EscalationInput["type"], fields: Record<string, unknown>, staffContext?: Record<string, unknown>): EscalationInput {
  return {
    type, clientId: ctx.line.client_id, lineId: ctx.line.id,
    slackChannel: ctx.line.slack_channel_id ?? null, staffEmail: ctx.line.booking_email ?? null,
    callId: null, retellCallId: ctx.callId || null, callerNumber: ctx.callerNumber ?? null,
    agentId, order, verified: !!order, fields, staffContext,
  };
}

// The row is always persisted first (Task 9), so soften — never over-promise — when delivery fell back.
async function deliver(d: OrderToolDeps, input: EscalationInput): Promise<string> {
  const res = await d.postEscalation(input);
  return res.ok ? SENT_MSG : SENT_LOGGED;
}

export async function handleRescheduleRequest(
  args: { tracking_code?: string; property_address?: string; agent_email?: string; desired_window: string; reason?: string },
  ctx: ToolCtx, overrides: Partial<OrderToolDeps> = {},
): Promise<string> {
  const d = { ...REAL_DEPS, ...overrides };
  const { error, agent, order, spiro } = await resolveAgentAndOrder(args, ctx, d);
  if (error) return error;
  if (!order) return NEED_VERIFY;
  let staffContext: Record<string, unknown> | undefined;
  if (spiro) { const det = await d.getOrderDetail(spiro, order.orderId); if (det.ok) staffContext = { rescheduleAmount: det.value.rescheduleAmount }; }
  await ctx.record({ tool: "request_reschedule", fields: { trackingCode: order.trackingCode, desired_window: args.desired_window } });
  return deliver(d, baseEscalation(ctx, agent?.agentId ?? null, order, "reschedule",
    { desired_window: args.desired_window, reason: args.reason ?? "", ...agentContact(agent) }, staffContext));
}

export async function handleCancellationRequest(
  args: { tracking_code?: string; property_address?: string; agent_email?: string; reason?: string },
  ctx: ToolCtx, overrides: Partial<OrderToolDeps> = {},
): Promise<string> {
  const d = { ...REAL_DEPS, ...overrides };
  const { error, agent, order, spiro } = await resolveAgentAndOrder(args, ctx, d);
  if (error) return error;
  if (!order) return NEED_VERIFY;
  let staffContext: Record<string, unknown> | undefined;
  if (spiro) { const det = await d.getOrderDetail(spiro, order.orderId); if (det.ok) staffContext = { cancellationAmount: det.value.cancellationAmount }; }
  await ctx.record({ tool: "request_cancellation", fields: { trackingCode: order.trackingCode } });
  return deliver(d, baseEscalation(ctx, agent?.agentId ?? null, order, "cancel",
    { reason: args.reason ?? "", ...agentContact(agent) }, staffContext));
}

export async function handleNewOrderRequest(
  args: { property_address: string; package_or_services: string; preferred_datetime: string; access_notes?: string; agent_email?: string },
  ctx: ToolCtx, overrides: Partial<OrderToolDeps> = {},
): Promise<string> {
  const d = { ...REAL_DEPS, ...overrides };
  const spiro = await d.loadSpiroCtx(ctx.line.client_id, ctx.line.spiro_source_id ?? null);
  let agent: SpiroAgent | null = null;
  if (spiro) {
    const e164 = normalizeCallerNumber(ctx.callerNumber);
    if (e164) { const r = await d.findAgentByPhone(spiro, e164); if (r.ok) agent = r.value; }
    if (!agent && args.agent_email) { const r = await d.findAgentByEmail(spiro, args.agent_email); if (r.ok) agent = r.value; }
  }
  await ctx.record({ tool: "request_new_order", fields: { property_address: args.property_address } });
  return deliver(d, baseEscalation(ctx, agent?.agentId ?? null, null, "new_order", {
    property_address: args.property_address, package_or_services: args.package_or_services,
    preferred_datetime: args.preferred_datetime, access_notes: args.access_notes ?? "",
    contact_number: ctx.callerNumber ?? "", contact_email: args.agent_email ?? "", ...agentContact(agent),
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test lib/hollis/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hollis/tools.ts lib/hollis/tools.test.ts
git commit -m "feat(hollis): reschedule/new-order/cancel request handlers"
```

---

### Task 13: `tools.ts` — ORDER_TOOL_SCHEMAS, toolsForLine, dispatch wiring

**Files:**
- Modify: `lib/hollis/tools.ts`, `lib/hollis/tools.test.ts`

**Interfaces:**
- Consumes: `handleLookupOrder`, `handleRescheduleRequest`, `handleCancellationRequest`, `handleNewOrderRequest`; existing `TOOL_SCHEMAS`, `dispatch`.
- Produces:
  - `ORDER_TOOL_SCHEMAS` (4 Anthropic tool schemas).
  - `toolsForLine(line: { order_ops_enabled?: boolean })` — disabled → base 5; enabled → base minus `book_appointment`/`qualify_lead` + 4 order tools (= 7). Return type inferred, not annotated.
  - `dispatch` routes the 4 new tool names (gated on `ctx.line.order_ops_enabled`).

- [ ] **Step 1: Write the failing tests**

```ts
// append to lib/hollis/tools.test.ts
import { ORDER_TOOL_SCHEMAS, toolsForLine } from "./tools";

test("base TOOL_SCHEMAS is still exactly five (non-breaking)", () => {
  assert.equal(TOOL_SCHEMAS.length, 5);
});

test("ORDER_TOOL_SCHEMAS has the four order tools, object-schema", () => {
  const names = ORDER_TOOL_SCHEMAS.map((t) => t.name).sort();
  assert.deepEqual(names, ["lookup_order", "request_cancellation", "request_new_order", "request_reschedule"]);
  for (const t of ORDER_TOOL_SCHEMAS) { assert.equal(t.input_schema.type, "object"); assert.equal(t.input_schema.additionalProperties, false); }
});

test("toolsForLine: disabled = base 5; enabled drops booking/lead + adds order tools (7)", () => {
  assert.equal(toolsForLine({ order_ops_enabled: false }).length, 5);
  const enabled = toolsForLine({ order_ops_enabled: true });
  const names = enabled.map((t) => t.name).sort();
  assert.equal(enabled.length, 7);
  assert.ok(!names.includes("book_appointment") && !names.includes("qualify_lead"), "booking/lead dropped on order line");
  assert.ok(["lookup_order", "take_message", "lookup_faq", "transfer_to_human"].every((n) => names.includes(n)));
});

test("dispatch refuses order tools when order_ops disabled", async () => {
  const ctx = fakeCtx({ line: { id: "l1", client_id: "c1", order_ops_enabled: false } as any });
  const out = await dispatch("lookup_order", { tracking_code: "x" }, ctx);
  assert.match(out, /take a message|not able|team/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test lib/hollis/tools.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the schemas (append near `TOOL_SCHEMAS`):

```ts
export const ORDER_TOOL_SCHEMAS = [
  {
    name: "lookup_order",
    description: "Look up the caller's photography order in Spiro to answer status/schedule/photographer questions. Requires the caller to confirm a property address or order tracking code.",
    input_schema: { type: "object", additionalProperties: false, properties: {
      tracking_code: { type: "string", description: "Order tracking code if the caller has it." },
      property_address: { type: "string", description: "Property address on the order, to verify + locate it." },
      agent_email: { type: "string", description: "Email on the account, used only if the caller's phone doesn't match." },
    }, required: [] },
  },
  {
    name: "request_reschedule",
    description: "Submit a request to reschedule an existing, verified order to a new time. Does not change Spiro directly.",
    input_schema: { type: "object", additionalProperties: false, properties: {
      tracking_code: { type: "string" }, property_address: { type: "string" }, agent_email: { type: "string" },
      desired_window: { type: "string", description: "Caller's requested new date/time or window." },
      reason: { type: "string" },
    }, required: ["desired_window"] },
  },
  {
    name: "request_cancellation",
    description: "Submit a request to cancel an existing, verified order. Does not cancel in Spiro directly.",
    input_schema: { type: "object", additionalProperties: false, properties: {
      tracking_code: { type: "string" }, property_address: { type: "string" }, agent_email: { type: "string" }, reason: { type: "string" },
    }, required: [] },
  },
  {
    name: "request_new_order",
    description: "Capture a full request for a NEW shoot order for staff to create. Does not create in Spiro directly.",
    input_schema: { type: "object", additionalProperties: false, properties: {
      property_address: { type: "string" }, package_or_services: { type: "string" },
      preferred_datetime: { type: "string" }, access_notes: { type: "string" }, agent_email: { type: "string" },
    }, required: ["property_address", "package_or_services", "preferred_datetime"] },
  },
] as const;

// On an order-desk line the generic booking/lead tools are REPLACED by the order tools (spec §4).
const ORDER_LINE_DROP = new Set(["book_appointment", "qualify_lead"]);
export function toolsForLine(line: { order_ops_enabled?: boolean }) {
  if (!line.order_ops_enabled) return [...TOOL_SCHEMAS];
  const base = TOOL_SCHEMAS.filter((t) => !ORDER_LINE_DROP.has(t.name));
  return [...base, ...ORDER_TOOL_SCHEMAS]; // do NOT annotate the return type — let TS infer the union (ORDER_TOOL_SCHEMAS is `as const`)
}
```

Then add cases to the `dispatch` switch (before `default:`):

```ts
    case "lookup_order":
    case "request_reschedule":
    case "request_cancellation":
    case "request_new_order": {
      if (!ctx.line.order_ops_enabled) return "Let me take a message and have the team follow up with you.";
      if (name === "lookup_order") return handleLookupOrder(args as any, ctx);
      if (name === "request_reschedule") return handleRescheduleRequest(args as any, ctx);
      if (name === "request_cancellation") return handleCancellationRequest(args as any, ctx);
      return handleNewOrderRequest(args as any, ctx);
    }
```

- [ ] **Step 4: Run to verify it passes + typecheck**

Run: `node --import tsx --test lib/hollis/tools.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hollis/tools.ts lib/hollis/tools.test.ts
git commit -m "feat(hollis): ORDER_TOOL_SCHEMAS + toolsForLine + dispatch routing"
```

---

### Task 14: Tool route — enrich ctx + gate

**Files:**
- Modify: `app/api/hollis/tool/route.ts`

**Interfaces:**
- Consumes: extended `ToolCtx`. Reads `call.metadata.caller_number` (set by inbound in Task 15) and the line's new columns.

- [ ] **Step 1: Widen the request `call` type**

In `app/api/hollis/tool/route.ts`, update the parsed `call` type to include the caller number + metadata:

```ts
    call: { call_id?: string; to_number?: string; from_number?: string; metadata?: { line_id?: string; client_id?: string; caller_number?: string } };
```

- [ ] **Step 2: Resolve the FULL line row on BOTH paths (this is the critical fix)**

The current route SYNTHESIZES a minimal `line = { id, client_id, escalation_number }` on the metadata fast-path (no DB read). Because inbound always sets `metadata.line_id`, that fast-path is the production path — so `order_ops_enabled`/`spiro_source_id`/`slack_channel_id` would be `undefined` and the Task 13 gate would disable every order tool. Replace the entire two-branch line resolution (route.ts ~38-52) with one resolution that always loads the full row (typed `HollisLine` from Task 2):

```ts
  const { supabaseAdmin } = await import("@/lib/supabase");
  let lineId = call.metadata?.line_id ?? null;
  if (!lineId && call.to_number) {
    const { data: byNum } = await supabaseAdmin.from("hollis_lines").select("id").eq("phone_number", call.to_number).maybeSingle();
    lineId = (byNum?.id as string | undefined) ?? null;
  }
  const { data: line } = lineId
    ? await supabaseAdmin.from("hollis_lines").select(hollisLineColumns()).eq("id", lineId).maybeSingle<HollisLine>()
    : { data: null };
  if (!line) {
    return NextResponse.json({ result: "Let me take a message and have the team follow up with you." });
  }
```

Add these imports at the top if not already present: `import { hollisLineColumns } from "@/lib/hollis/config";` and `import type { HollisLine } from "@/lib/hollis/types";`.

- [ ] **Step 3: Enrich the ToolCtx**

Replace the `const ctx: ToolCtx = { ... }` block with (all reads are now valid — `line` is a full `HollisLine`):

```ts
  const ctx: ToolCtx = {
    line: {
      id: line.id, client_id: line.client_id,
      booking_mode: line.booking_mode, booking_email: line.booking_email,
      escalation_number: line.escalation_number, agent_name: line.agent_name,
      order_ops_enabled: line.order_ops_enabled ?? false,
      spiro_source_id: line.spiro_source_id ?? null,
      slack_channel_id: line.slack_channel_id ?? null,
    },
    callId: call.call_id ?? "",
    callerNumber: call.metadata?.caller_number ?? call.from_number ?? null,
    record: async (entry) => {
      if (call.call_id) {
        await recordToolUse({ lineId: line.id, clientId: line.client_id, retellCallId: call.call_id, tool: entry.tool, fields: entry.fields });
      }
    },
  };
```

- [ ] **Step 4: Verify typecheck + lib suite**

Run: `npm run typecheck && node --import tsx --test 'lib/hollis/**/*.test.ts'`
Expected: PASS (route has no unit test; lib suite green confirms the ctx contract).

- [ ] **Step 5: Commit**

```bash
git add app/api/hollis/tool/route.ts
git commit -m "feat(hollis): tool route passes caller number + order-desk line fields"
```

---

### Task 15: Inbound route + config loader — caller number & new columns

**Files:**
- Modify: `app/api/hollis/inbound/route.ts`, `lib/hollis/config.ts`

**Interfaces:**
- Produces: inbound returns `metadata.caller_number` (from `call_inbound.from_number`); `loadLineConfig` selects and returns `order_ops_enabled, spiro_source_id, slack_channel_id, agent_name`.

- [ ] **Step 1: Add a config-loader test (columns present)**

If `lib/hollis/config.test.ts` exists, add; otherwise create it. Test the pure part — the `dynamicVariables`/metadata assembly should carry `caller_number` when a from-number is supplied. If `config.ts` exposes a pure assembler, test it; otherwise assert the select includes the columns via a thin exported helper `hollisLineColumns()`:

```ts
// lib/hollis/config.test.ts (add)
import { test } from "node:test";
import assert from "node:assert/strict";
import { hollisLineColumns } from "./config";

test("line column list includes the order-desk columns", () => {
  const cols = hollisLineColumns();
  for (const c of ["order_ops_enabled", "spiro_source_id", "slack_channel_id", "agent_name"]) assert.ok(cols.includes(c), `missing ${c}`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test lib/hollis/config.test.ts`
Expected: FAIL (`hollisLineColumns` not exported).

- [ ] **Step 3: Implement**

In `lib/hollis/config.ts`, add a `hollisLineColumns()` helper (consumed by the tool route's targeted line fetch in Task 14):

```ts
export function hollisLineColumns(): string {
  return "id, client_id, phone_number, retell_agent_id, voice_profile, agent_name, voice_id, greeting_override, persona, hours, services, escalation_number, booking_mode, booking_email, recording_enabled, status, order_ops_enabled, spiro_source_id, slack_channel_id";
}
```

**NOTE:** `loadLineConfig` delegates to `loadLineByNumber`, which already uses `.select("*")` — so migration 034's columns load automatically for inbound + the Inngest fn. Do NOT rewire `loadLineConfig`; `hollisLineColumns()` exists only for the tool route's explicit fetch.

In `app/api/hollis/inbound/route.ts`, extend the parsed body type and the returned metadata:

```ts
  const body = (await req.json().catch(() => ({}))) as { call_inbound?: { to_number?: string; from_number?: string } };
  const toNumber = body.call_inbound?.to_number;
  const fromNumber = body.call_inbound?.from_number;
  // ... where metadata is built:
  //   metadata: { line_id: cfg.line.id, client_id: cfg.line.client_id, caller_number: fromNumber ?? "" },
```

- [ ] **Step 4: Run to verify it passes + typecheck**

Run: `node --import tsx --test lib/hollis/config.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/hollis/inbound/route.ts lib/hollis/config.ts lib/hollis/config.test.ts
git commit -m "feat(hollis): inbound passes caller_number; config loads order-desk columns"
```

---

### Task 16: Per-call summary in the lifecycle Inngest function

**Files:**
- Modify: `lib/inngest/functions/hollis-call-completed.ts`

**Interfaces:**
- Consumes: `postCallSummary` (Task 10); the loaded `ctx.line` (`order_ops_enabled`, `slack_channel_id`, `client_id`), the `captured`/`outcome` from the existing `finalize` step, and `parsed.fromNumber`.

- [ ] **Step 1: Wire the summary post**

In `lib/inngest/functions/hollis-call-completed.ts`, after the call is finalized (outcome computed, line loaded), add a step that posts the per-call summary when the line has order ops + a Slack channel:

```ts
import { postCallSummary } from "@/lib/hollis/escalation";

// The lifecycle fn already loads `ctx = { line, businessName, fallbackEmail }` (from the
// `load-line` step; may be null) and destructures `{ outcome, captured }` from the `finalize`
// step; the caller number is `parsed.fromNumber`. Reuse those — do NOT re-load or shadow them.
if (ctx?.line?.order_ops_enabled && ctx.line.slack_channel_id) {
  const asks: string[] = [];
  const cap = (captured ?? {}) as Record<string, unknown>;
  for (const key of ["request_reschedule", "request_cancellation", "request_new_order", "lookup_order"]) {
    if (cap[key]) asks.push(key.replace("request_", "").replace(/_/g, " "));
  }
  await step.run("post-call-summary", async () => {
    await postCallSummary({
      clientId: ctx.line.client_id,
      channel: ctx.line.slack_channel_id ?? null,
      summary: { caller: parsed?.fromNumber ?? undefined, outcome: outcome ?? "no_action", asks },
    });
  });
}
```

(No new load is needed — `ctx.line` comes from `loadLineByNumber`'s `select("*")`, so migration 034's columns are already present; `captured`/`outcome` come from the existing `finalize` step. Confirm the exact local names in the file and adjust if they differ.)

- [ ] **Step 2: Verify typecheck + full lib suite**

Run: `npm run typecheck && node --import tsx --test 'lib/**/*.test.ts'`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/inngest/functions/hollis-call-completed.ts
git commit -m "feat(hollis): post per-call summary to Slack on call.completed"
```

---

### Task 17: Admin config route — accept order-desk fields

**Files:**
- Modify: `app/api/admin/clients/[id]/hollis/config/route.ts`

**Interfaces:**
- Consumes: existing `PUT` handler + mutable-field whitelist.
- Produces: `order_ops_enabled`, `spiro_source_id`, `slack_channel_id` are accepted and persisted; `agent_name` already accepted.

- [ ] **Step 1: Extend the whitelist**

The real `PUT` handler builds a `row` object **imperatively** with `if ("field" in body) row.field = sanitizeText(...)` guards (`config/route.ts:29-50`) — NOT an object literal. Match that exact pattern; add after the existing guards:

```ts
    if (typeof body.order_ops_enabled === "boolean") row.order_ops_enabled = body.order_ops_enabled;
    if ("spiro_source_id" in body) row.spiro_source_id = sanitizeText(body.spiro_source_id);
    if ("slack_channel_id" in body) row.slack_channel_id = sanitizeText(body.slack_channel_id);
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/clients/[id]/hollis/config/route.ts
git commit -m "feat(hollis): admin config accepts order-desk fields"
```

---

### Task 18: HollisManager UI — order-desk section

**Files:**
- Modify: `app/(admin)/clients/[id]/HollisManager.tsx`

**Interfaces:**
- Consumes: the client's `client_data_sources` (Spiro sources) and the extended config `PUT`.
- Produces: an "Order desk" section — `order_ops_enabled` toggle, Spiro-source `<select>`, Slack channel input; posts them via the existing config save.

- [ ] **Step 1: Add local state**

First extend the component's local `Line` type (HollisManager.tsx:4-22) with the three fields:

```tsx
  order_ops_enabled?: boolean;
  spiro_source_id?: string | null;
  slack_channel_id?: string | null;
```

Then add state, initializing from `initialLine?.` (the file's prop is `initialLine`, not `line`):

```tsx
const [orderOpsEnabled, setOrderOpsEnabled] = useState<boolean>(initialLine?.order_ops_enabled ?? false);
const [spiroSourceId, setSpiroSourceId] = useState<string>(initialLine?.spiro_source_id ?? "");
const [slackChannelId, setSlackChannelId] = useState<string>(initialLine?.slack_channel_id ?? "");
```

- [ ] **Step 2: Render the section** (place near the escalation/booking fields)

```tsx
<fieldset className="mt-4 border-t pt-4">
  <legend className="text-sm font-medium">Order desk (Spiro + Slack)</legend>
  <label className="flex items-center gap-2 mt-2 text-sm">
    <input type="checkbox" checked={orderOpsEnabled} onChange={(e) => setOrderOpsEnabled(e.target.checked)} />
    Enable order lookup + change requests
  </label>
  <label className="block mt-2 text-sm">Spiro source
    <select className="mt-1 block w-full border rounded p-1" value={spiroSourceId} onChange={(e) => setSpiroSourceId(e.target.value)}>
      <option value="">— none —</option>
      {(spiroSources ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  </label>
  <label className="block mt-2 text-sm">Slack channel ID
    <input className="mt-1 block w-full border rounded p-1" value={slackChannelId} onChange={(e) => setSlackChannelId(e.target.value)} placeholder="C0123456789" />
  </label>
  <p className="mt-2 text-xs text-gray-500">
    Live-transfer number: {initialLine?.escalation_number ? `set (${initialLine.escalation_number})` : "⚠ not set — set the escalation number above"}
  </p>
</fieldset>
```

`spiroSources` is passed from the page. Add `spiroSources?: { id: string; label: string }[]` to the component props, and in `app/(admin)/clients/[id]/page.tsx` load them alongside the Hollis line:

```ts
const { data: spiroSources } = await supabaseAdmin
  .from("client_data_sources")
  .select("id, label")
  .eq("client_id", id)
  .eq("provider", "spiro");
```

Pass `spiroSources={spiroSources ?? []}` into `<HollisManager />`.

- [ ] **Step 3: Include the fields in the save payload**

Where the component builds the `PUT` body for config save, add:

```tsx
  order_ops_enabled: orderOpsEnabled,
  spiro_source_id: spiroSourceId || null,
  slack_channel_id: slackChannelId || null,
```

- [ ] **Step 4: Verify typecheck + build**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/clients/[id]/HollisManager.tsx" "app/(admin)/clients/[id]/page.tsx"
git commit -m "feat(hollis): HollisManager order-desk config section"
```

---

## Final verification

- [ ] Run the full suite: `node --import tsx --test 'lib/**/*.test.ts'` → all green.
- [ ] `npm run typecheck` → clean.
- [ ] Confirm `TOOL_SCHEMAS.length === 5` still holds (base unchanged) and `toolsForLine({order_ops_enabled:true}).length === 9`.

## Operator setup (post-merge, not code)

1. Apply migration 034 to prod (Supabase MCP).
2. Add a `rest`/`spiro` `client_data_sources` row for Elevated with an (ideally read-scoped) Spiro key via the admin write-only field.
3. Install the Slack app to Elevated's workspace (token → `steward_platform_tokens`); note the channel id.
4. Provision the new Retell number + agent for Elevated via the `provision` route; set `agent_name = Elizabeth`, `order_ops_enabled = true`, `spiro_source_id`, `slack_channel_id`, `escalation_number` (staff transfer), `hours = 24/7`, `recording_enabled` per policy.
5. Declare the 9 tools (`toolsForLine`) on the Retell agent pointing at `/api/hollis/tool`; set the inbound + post-call webhooks.
6. Retell smoke test: confirm the `{ result }` field, transfer mechanism, and that `from_number` arrives — all self-flagged unverified in code.

## Self-Review + adversarial-review corrections

Reviewed by a 4-critic workflow (spec-coverage, type-consistency, codebase-accuracy, TDD/correctness) on 2026-07-10. **Verified correct against the real code:** `postSlackMessage({botToken,channel,text,blocks})` → `{ok,ts}` (does not throw on `ok:false`); `ToolCtx` is a `type`; `recordToolUse(...)`; `lib/analytics/crypto.decryptSecret`; `lib/resend` `resend()`/`DEFAULT_FROM`; `client_data_sources` (`config`,`secret_enc`); Maya's `steward_platform_tokens.token_data.access_token`.

**Corrections applied from the review:**
- **[critical] Task 14** — the tool route's metadata fast-path now loads the FULL `hollis_lines` row (it was synthesizing a minimal object → the order tools would have been gated OFF on every real call). Local `line` typed `HollisLine`.
- **Task 13** — `toolsForLine` drops `book_appointment`/`qualify_lead` on an order line (spec §4) → 7 tools, not 9.
- **Tasks 5/11/12** — added `getOrderDetail` (staff-only cancel/reschedule fee context, §9), `findOrderByTracking` (no-phone-match tracking path, §3.2), `findAgentById` (caller name/email for staff); `logEvent` on Spiro errors; multi-order disambiguation in `lookup_order`.
- **Tasks 1/8/9** — `hollis_escalations.retell_call_id` column, rendered in the Slack message, and persisted (traceability, §6).
- **Task 6** — address matcher guards empty candidate addresses + requires house-number agreement (kills the `includes("")` false-match).
- **Task 16** — corrected to the real Inngest locals (`ctx.line`, `captured`, `outcome`, `parsed.fromNumber`).
- **Task 17** — admin route uses the file's imperative `if ("x" in body) row.x = sanitizeText(...)` pattern.
- **Task 18** — extends the component's local `Line` type; inits from `initialLine?.`; concrete `client_data_sources` page query; surfaces the transfer number.

**Intentional / deferred (not gaps):**
- **`agent_name` lookup arg dropped** — Spiro exposes no name filter; identity is phone → email/tracking → address.
- **`caller_agent_name` greeting personalization** — optional per §3.1; deferred.
- **`transfer_to_human` real warm-transfer** — Retell config; verified at the operator smoke test (Retell `{result}` field / transfer mechanism / `from_number` are all self-flagged unverified in current code).
- **`hollis_escalations.call_id` (UUID FK)** — left nullable; call linkage is via `retell_call_id`. Resolve the UUID later only if a SQL join is needed.
