# Elevated HubSpot Order Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily backend job that reads Elevated Productions' Spiro orders and attributes each one to its matching existing HubSpot contact (by email), landing on HubSpot's existing "Orders" custom object.

**Architecture:** A new `lib/hubspot-sync/` module (pure Spiro-order fetch + pure contact-match + HubSpot REST client + orchestration) driven by a new Inngest function (`hubspot-order-sync.ts`, cron + manual-trigger event), modeled directly on the existing `analytics-sync.ts`. Config/credentials reuse the existing `client_data_sources` table (`provider='hubspot'`); a new `hubspot_order_syncs` table gives per-order idempotency and match/unmatched auditing.

**Tech Stack:** Next.js App Router, Supabase (`supabaseAdmin`), Inngest, native `fetch`, `node --test` + `tsx` for unit tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-15-elevated-hubspot-order-sync-design.md` — read it first for the full rationale; this plan implements it with one deliberate correction (see below).
- **Correction vs. the approved spec:** the spec says the HubSpot source row's existing `last_sync_at`/`last_sync_error` columns double as this job's checkpoint. Building the plan surfaced a real bug in that: `client_data_sources` is swept **nightly by the unrelated `analytics-sync.ts` cron for every active row regardless of provider** (`listActiveSources()` has no provider filter). Once we register a `hubspot` adapter (required so that sweep doesn't flag a permanent false error — see Task 4), its `markSyncResult()` call would overwrite `last_sync_at` every night independent of whether *this* job ran, silently shrinking the incremental window and risking missed orders after any outage. **Fix:** this job's checkpoint (`last_order_sync_at` / `last_order_sync_error`) and pairing config (`spiro_source_id`, `hubspot_object_type`, `hubspot_id_property`, `cutoff_date`) all live inside the HubSpot source row's `config` JSONB instead, via the existing `updateSourceConfig()` helper. The shared `status`/`last_sync_at` columns are still reused for the existing Pause/Resume/Test UI (harmless), just never read as this job's checkpoint.
- No backfill: the Spiro query itself never asks for `dateSubmitted` before the configured cutoff.
- No contact auto-creation, no notification on unmatched orders — skip + log locally only (`hubspot_order_syncs.match_status='unmatched'`).
- Auth to HubSpot: Private App token only (no OAuth).
- Test convention: `node --test` via `tsx`, glob `lib/**/*.test.ts` (`npm test`). Mock `fetch` via an injected `fetchImpl` parameter (see `lib/hollis/spiro.ts` / `lib/analytics/providers/spiro.test.ts` for the exact pattern) — never a real network call in a unit test.
- `requireAdmin()` (`lib/admin-auth.ts`) gates every new admin route exactly like every existing `app/api/admin/**` route.
- Every new Supabase table gets RLS `ENABLE` + `CREATE POLICY "service role only" ... FOR ALL USING (false)` (all access via `supabaseAdmin`, filtered by `client_id` in application code) — matches every migration since `020_client_logs_composite_index.sql`.

---

### Task 1: Migration 035 — `hubspot_order_syncs` table

**Files:**
- Create: `supabase/migrations/035_hubspot_order_sync.sql`

**Interfaces:**
- Produces: table `hubspot_order_syncs(id, client_id, source_id, spiro_order_id, spiro_status, hubspot_object_id, hubspot_contact_id, match_status, synced_at, error)`, unique on `(source_id, spiro_order_id)`. Later tasks (`lib/hubspot-sync/store.ts`) read/write this table by exact column name.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- 035_hubspot_order_sync.sql
-- Per-order ledger for the Elevated Productions Spiro → HubSpot order
-- attribution sync (docs/superpowers/specs/2026-07-15-elevated-hubspot-order-sync-design.md).
-- No client_data_sources schema change: a provider='hubspot' row's own
-- config JSONB carries the sync's checkpoint + pairing (see that row's
-- config.last_order_sync_at / config.spiro_source_id), NOT the shared
-- last_sync_at column — that column is swept nightly by the unrelated
-- analytics-sync cron for every active source regardless of provider.
-- ============================================================================

CREATE TABLE IF NOT EXISTS hubspot_order_syncs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_id          UUID NOT NULL REFERENCES client_data_sources(id) ON DELETE CASCADE,
  spiro_order_id     TEXT NOT NULL,
  spiro_status       TEXT,
  hubspot_object_id  TEXT,
  hubspot_contact_id TEXT,
  match_status       TEXT NOT NULL CHECK (match_status IN ('matched','unmatched')),
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error              TEXT,
  UNIQUE (source_id, spiro_order_id)
);

CREATE INDEX IF NOT EXISTS hubspot_order_syncs_client_synced_idx
  ON hubspot_order_syncs (client_id, synced_at DESC);

ALTER TABLE hubspot_order_syncs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON hubspot_order_syncs FOR ALL USING (false);
```

- [ ] **Step 2: Apply it locally and confirm it's well-formed**

Run: `npx supabase db push` (or however this repo's Supabase project is linked — check for a `SUPABASE_PROJECT_REF`/`supabase link` already configured; if none, apply via the Supabase SQL editor and confirm no errors).
Expected: table `hubspot_order_syncs` exists with the columns above; re-running the file is a no-op (`IF NOT EXISTS` / idempotent `CREATE POLICY` — if the policy already exists this will error on re-run, which matches every other migration in this repo, i.e. migrations are run once, forward-only).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/035_hubspot_order_sync.sql
git commit -m "feat(hubspot-sync): add hubspot_order_syncs ledger table"
```

---

### Task 2: `lib/hubspot-sync/types.ts` — shared types

**Files:**
- Create: `lib/hubspot-sync/types.ts`

**Interfaces:**
- Consumes: nothing (leaf module, same convention as `lib/analytics/types.ts`).
- Produces: `HubspotCtx`, `SpiroOrderSummary`, `HubspotContact`, `MatchOutcome`, `HubspotResult<T>` — every other file in `lib/hubspot-sync/` imports these exact names.

- [ ] **Step 1: Write the file**

```typescript
// lib/hubspot-sync/types.ts
// Shared contract for the Elevated Spiro → HubSpot order-attribution sync.
// Leaf module — no repo imports — so anything may depend on it.

export type HubspotResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "auth" | "transient" | "bad"; message: string };

export interface HubspotCtx {
  baseUrl: string; // always https://api.hubapi.com — kept as a field for testability
  token: string;
  objectType: string; // introspected internal name of the "Orders" custom object
  idProperty: string; // e.g. "spiro_order_id" — the upsert key property
  associationTypeId: number; // introspected association type id for order→contact
}

// Normalized subset of a raw Spiro /api/v1/orders row — the fields this sync
// writes onto HubSpot's Orders object. Superset of lib/hollis/spiro.ts's
// OrderCard (adds dateSubmitted + mediaTitle; drops arrival-window splitting
// in favor of a single appointmentDate string).
export interface SpiroOrderSummary {
  orderId: string;
  trackingCode: string;
  status: string;
  dateSubmitted: string | null;
  addressText: string;
  mediaTitle: string | null;
  photographerName: string | null;
  appointmentDate: string | null;
  agentId: string;
}

export interface HubspotContact {
  id: string;
  email: string | null;
}

export type MatchOutcome =
  | { kind: "matched"; contact: HubspotContact }
  | { kind: "unmatched"; reason: "no_email" | "no_contact" | "ambiguous" };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from this file (it has no repo imports, so this only checks its own syntax).

- [ ] **Step 3: Commit**

```bash
git add lib/hubspot-sync/types.ts
git commit -m "feat(hubspot-sync): add shared types"
```

---

### Task 3: `lib/hubspot-sync/match.ts` — pure contact-match logic

**Files:**
- Create: `lib/hubspot-sync/match.ts`, `lib/hubspot-sync/match.test.ts`

**Interfaces:**
- Consumes: `HubspotContact`, `MatchOutcome` from `./types`.
- Produces: `matchContact(email: string | null, results: HubspotContact[]): MatchOutcome` — `lib/hubspot-sync/orchestrate.ts` (Task 8) calls this after every HubSpot contact search.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/hubspot-sync/match.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test lib/hubspot-sync/match.test.ts`
Expected: FAIL — `Cannot find module './match'`.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// lib/hubspot-sync/match.ts
// Pure contact-matching decision — no network, no I/O. An ambiguous match
// (>1 HubSpot contact sharing the same email) is treated as unmatched rather
// than guessed: an ambiguous attribution is worse than a skipped one.
import type { HubspotContact, MatchOutcome } from "./types";

export function matchContact(email: string | null, results: HubspotContact[]): MatchOutcome {
  if (!email) return { kind: "unmatched", reason: "no_email" };
  if (results.length === 0) return { kind: "unmatched", reason: "no_contact" };
  if (results.length > 1) return { kind: "unmatched", reason: "ambiguous" };
  return { kind: "matched", contact: results[0] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test lib/hubspot-sync/match.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/hubspot-sync/match.ts lib/hubspot-sync/match.test.ts
git commit -m "feat(hubspot-sync): add pure contact-match logic"
```

---

### Task 4: `lib/analytics/providers/hubspot.ts` — no-op warehouse adapter + provider registration

This task exists ONLY so the nightly `analytics-sync.ts` cron (which sweeps every active `client_data_sources` row regardless of provider — `listActiveSources()` has no provider filter) treats a `provider='hubspot'` row as a healthy no-op instead of flagging a permanent "no adapter for provider" error every night. The real order-sync logic is entirely separate (Tasks 6-9). This adapter's `sync()` always declines with `kind: "unsupported"`.

**Files:**
- Create: `lib/analytics/providers/hubspot.ts`, `lib/analytics/providers/hubspot.test.ts`
- Modify: `lib/analytics/adapters.ts`
- Modify: `lib/analytics/admin-validation.ts`

**Interfaces:**
- Consumes: `ChatTool, ConnectionInfo, MetricRow, ProviderAdapter, Result, SourceCtx, SyncWindow` from `@/lib/analytics/types` (all pre-existing).
- Produces: `hubspotAdapter: ProviderAdapter` (registered as `REGISTRY.hubspot`), `"hubspot"` added to `KNOWN_PROVIDERS`.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/analytics/providers/hubspot.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hubspotAdapter } from "./hubspot";
import type { DataSourceRow, SourceCtx } from "@/lib/analytics/types";

function fakeCtx(): SourceCtx {
  const source: DataSourceRow = {
    id: "src-1",
    client_id: "client-1",
    kind: "rest",
    provider: "hubspot",
    label: "HubSpot",
    config: {},
    secret_enc: null,
    chat_tool_allowlist: [],
    status: "active",
    last_sync_at: null,
    last_sync_error: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  return { source, secret: "test-token" };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function withStubbedFetch<T>(
  impl: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = global.fetch;
  global.fetch = impl as typeof fetch;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
}

test("sync() always declines as unsupported — order sync is a separate job", async () => {
  const r = await hubspotAdapter.sync(fakeCtx(), { from: "2026-01-01", to: "2026-01-31", backfill: false });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, "unsupported");
});

test("chatTools() returns none", async () => {
  assert.deepEqual(await hubspotAdapter.chatTools(fakeCtx()), []);
});

test("testConnection() over a 401 maps to auth", async () => {
  const r = await withStubbedFetch(async () => jsonResponse(401, {}), () => hubspotAdapter.testConnection(fakeCtx()));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, "auth");
});

test("testConnection() over a 200 succeeds", async () => {
  const r = await withStubbedFetch(async () => jsonResponse(200, { results: [] }), () => hubspotAdapter.testConnection(fakeCtx()));
  assert.equal(r.ok, true);
});

test("testConnection() with no secret returns a config error, no network call", async () => {
  const ctx: SourceCtx = { ...fakeCtx(), secret: null };
  const r = await hubspotAdapter.testConnection(ctx);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, "config");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test lib/analytics/providers/hubspot.test.ts`
Expected: FAIL — `Cannot find module './hubspot'`.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// lib/analytics/providers/hubspot.ts
//
// Registered ONLY so the nightly analytics-sync cron (which sweeps every
// active client_data_sources row regardless of provider) treats a
// provider='hubspot' row as a healthy no-op instead of a permanent "no
// adapter" error. The real order-attribution sync is a separate, dedicated
// job — lib/hubspot-sync/orchestrate.ts, driven by
// lib/inngest/functions/hubspot-order-sync.ts — NOT this adapter's sync().
// testConnection() still makes a real HubSpot call so the existing "Test"
// button in AnalyticsManager works for a hubspot source.

import type {
  ChatTool,
  ConnectionInfo,
  MetricRow,
  ProviderAdapter,
  Result,
  SourceCtx,
  SyncWindow,
} from "@/lib/analytics/types";

const HUBSPOT_BASE_URL = "https://api.hubapi.com";

function mapHubspotStatus(status: number): "auth" | "network" | "error" {
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "network";
  return "error";
}

function authHeaders(ctx: SourceCtx): Result<{ headers: Record<string, string> }> {
  if (!ctx.secret) {
    return { ok: false, kind: "config", reason: "HubSpot source has no Private App token configured" };
  }
  return { ok: true, headers: { Authorization: `Bearer ${ctx.secret}`, Accept: "application/json" } };
}

async function hubspotGet(ctx: SourceCtx, path: string): Promise<Result<{ json: unknown }>> {
  const auth = authHeaders(ctx);
  if (!auth.ok) return auth;
  let text: string;
  let status: number;
  let ok: boolean;
  try {
    const res = await fetch(`${HUBSPOT_BASE_URL}${path}`, { headers: auth.headers, cache: "no-store" });
    status = res.status;
    ok = res.ok;
    text = await res.text();
  } catch (e) {
    return { ok: false, kind: "network", reason: `Network error reaching HubSpot: ${(e as Error).message}` };
  }
  if (!ok) {
    return { ok: false, kind: mapHubspotStatus(status), reason: `HubSpot ${path} ${status}: ${text.slice(0, 200)}` };
  }
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, kind: "error", reason: `HubSpot ${path} returned non-JSON (status ${status})` };
  }
}

export const hubspotAdapter: ProviderAdapter = {
  provider: "hubspot",

  async testConnection(ctx: SourceCtx): Promise<Result<{ info: ConnectionInfo }>> {
    const r = await hubspotGet(ctx, "/crm/v3/objects/contacts?limit=1");
    if (!r.ok) return r;
    return { ok: true, info: { detail: "HubSpot token OK — contacts read access confirmed" } };
  },

  async sync(_ctx: SourceCtx, _window: SyncWindow): Promise<Result<{ rows: MetricRow[] }>> {
    return {
      ok: false,
      kind: "unsupported",
      reason: "HubSpot order-attribution sync runs on its own daily job, not the analytics warehouse sync",
    };
  },

  async chatTools(_ctx: SourceCtx): Promise<ChatTool[]> {
    return [];
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test lib/analytics/providers/hubspot.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Register the adapter and the provider whitelist**

In `lib/analytics/adapters.ts`, add the import and registry entry:

```typescript
import { hubspotAdapter } from "@/lib/analytics/providers/hubspot";
```

```typescript
const REGISTRY: Record<string, ProviderAdapter> = {
  spiro: spiroAdapter,
  spiro_mcp: spiroMcpAdapter,
  generic_mcp: genericMcpAdapter,
  hubspot: hubspotAdapter,
};
```

In `lib/analytics/admin-validation.ts`, add `"hubspot"` to the whitelist:

```typescript
export const KNOWN_PROVIDERS = ["spiro", "spiro_mcp", "generic_mcp", "hubspot"] as const;
```

- [ ] **Step 6: Run the full analytics test suite to confirm nothing else broke**

Run: `node --import tsx --test 'lib/analytics/**/*.test.ts'`
Expected: PASS — all existing analytics tests plus the 5 new ones.

- [ ] **Step 7: Commit**

```bash
git add lib/analytics/providers/hubspot.ts lib/analytics/providers/hubspot.test.ts lib/analytics/adapters.ts lib/analytics/admin-validation.ts
git commit -m "feat(hubspot-sync): register hubspot as a no-op analytics provider"
```

---

### Task 5: `lib/hubspot-sync/hubspot-client.ts` — HubSpot REST client

**Files:**
- Create: `lib/hubspot-sync/hubspot-client.ts`, `lib/hubspot-sync/hubspot-client.test.ts`

**Interfaces:**
- Consumes: `HubspotContact, HubspotCtx, HubspotResult` from `./types` (Task 2).
- Produces: `searchContactByEmail(ctx, email, fetchImpl?)`, `upsertOrder(ctx, orderIdValue, properties, fetchImpl?)`, `createAssociation(ctx, orderObjectId, contactId, fetchImpl?)`, `listObjectSchemas(baseUrl, token, fetchImpl?)`, `introspectAssociationTypeId(baseUrl, token, fromObjectType, toObjectType, fetchImpl?)` — `orchestrate.ts` (Task 8) calls the first three every run; the introspection pair is used one-off at operator setup time by Task 10's admin route (`listObjectSchemas` lists every custom object so the admin can PICK "Orders" from a dropdown rather than the system having to guess its internal name up front — HubSpot's schema-by-name endpoint needs a name we don't have yet).

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/hubspot-sync/hubspot-client.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  searchContactByEmail,
  upsertOrder,
  createAssociation,
  listObjectSchemas,
  introspectAssociationTypeId,
} from "./hubspot-client";
import type { HubspotCtx } from "./types";

const ctx: HubspotCtx = {
  baseUrl: "https://api.hubapi.test",
  token: "test-token",
  objectType: "2-12345",
  idProperty: "spiro_order_id",
  associationTypeId: 99,
};

function fakeFetch(status: number, body: unknown) {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("searchContactByEmail returns matches", async () => {
  const r = await searchContactByEmail(
    ctx,
    "v@x.com",
    fakeFetch(200, { results: [{ id: "c1", properties: { email: "v@x.com" } }] }) as unknown as typeof fetch,
  );
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.value.length, 1); assert.equal(r.value[0].id, "c1"); }
});

test("searchContactByEmail returns an empty array on no matches", async () => {
  const r = await searchContactByEmail(ctx, "nobody@x.com", fakeFetch(200, { results: [] }) as unknown as typeof fetch);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.length, 0);
});

test("searchContactByEmail maps a 401 to auth", async () => {
  const r = await searchContactByEmail(ctx, "v@x.com", fakeFetch(401, {}) as unknown as typeof fetch);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, "auth");
});

test("upsertOrder PATCHes by idProperty when the record already exists", async () => {
  let method = "";
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    method = init?.method ?? "";
    return new Response(JSON.stringify({ id: "obj-1" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const r = await upsertOrder(ctx, "order-123", { status: "confirmed" }, fetchImpl);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.id, "obj-1");
  assert.equal(method, "PATCH");
});

test("upsertOrder falls back to POST create when the PATCH 404s (record doesn't exist yet)", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    calls.push(init?.method ?? "");
    if (init?.method === "PATCH") return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    return new Response(JSON.stringify({ id: "obj-2" }), { status: 201, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const r = await upsertOrder(ctx, "order-456", { status: "pending" }, fetchImpl);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.id, "obj-2");
  assert.deepEqual(calls, ["PATCH", "POST"]);
});

test("createAssociation PUTs the association type id", async () => {
  let body: unknown = null;
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const r = await createAssociation(ctx, "obj-1", "c1", fetchImpl);
  assert.equal(r.ok, true);
  assert.equal((body as { associationTypeId: number }[])[0].associationTypeId, 99);
});

test("listObjectSchemas returns every custom object with its properties, so the admin can pick 'Orders' from a list", async () => {
  const r = await listObjectSchemas(
    "https://api.hubapi.test",
    "test-token",
    fakeFetch(200, {
      results: [
        { objectTypeId: "2-12345", name: "orders", labels: { singular: "Order", plural: "Orders" }, properties: [{ name: "spiro_order_id" }, { name: "status" }] },
        { objectTypeId: "2-99999", name: "shoots", labels: { singular: "Shoot", plural: "Shoots" }, properties: [] },
      ],
    }) as unknown as typeof fetch,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.length, 2);
    assert.equal(r.value[0].objectTypeId, "2-12345");
    assert.equal(r.value[0].labelSingular, "Order");
    assert.deepEqual(r.value[0].properties, ["spiro_order_id", "status"]);
  }
});

test("introspectAssociationTypeId returns the first labeled association type", async () => {
  const r = await introspectAssociationTypeId(
    "https://api.hubapi.test",
    "test-token",
    "2-12345",
    "contacts",
    fakeFetch(200, { results: [{ typeId: 99, label: "Associated Orders" }] }) as unknown as typeof fetch,
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 99);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test lib/hubspot-sync/hubspot-client.test.ts`
Expected: FAIL — `Cannot find module './hubspot-client'`.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// lib/hubspot-sync/hubspot-client.ts
// All HubSpot HTTP lives in this one file (repo convention — see
// lib/analytics/providers/spiro.ts's header comment). Auth: per-client
// Private App token, sent as `Authorization: Bearer <token>` against
// https://api.hubapi.com. Never throws across the module boundary — every
// function returns HubspotResult<T>.
import type { HubspotContact, HubspotCtx, HubspotResult } from "./types";

type FetchImpl = typeof fetch;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hubspotFetch(
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit = {},
  fetchImpl: FetchImpl = fetch,
): Promise<HubspotResult<any>> {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    return { ok: false, kind: "transient", message: (e as Error).message };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, kind: "auth", message: `HubSpot ${res.status}` };
  if (res.status >= 500) return { ok: false, kind: "transient", message: `HubSpot ${res.status}` };
  const text = await res.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, kind: "bad", message: "non-JSON response" };
    }
  }
  if (!res.ok) return { ok: false, kind: "bad", message: `HubSpot ${res.status}: ${text.slice(0, 200)}` };
  return { ok: true, value: json };
}

export async function searchContactByEmail(
  ctx: HubspotCtx,
  email: string,
  fetchImpl: FetchImpl = fetch,
): Promise<HubspotResult<HubspotContact[]>> {
  const r = await hubspotFetch(
    ctx.baseUrl,
    ctx.token,
    "/crm/v3/objects/contacts/search",
    {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
        properties: ["email"],
        limit: 10,
      }),
    },
    fetchImpl,
  );
  if (!r.ok) return r;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = Array.isArray(r.value?.results) ? (r.value.results as any[]) : [];
  return { ok: true, value: results.map((c) => ({ id: String(c.id), email: c.properties?.email ?? null })) };
}

// Upserts by ctx.idProperty (a unique property on the Orders object holding
// the Spiro order id). HubSpot 404s a PATCH-by-idProperty when no record
// with that key exists yet — that's the create branch, not an error.
export async function upsertOrder(
  ctx: HubspotCtx,
  orderIdValue: string,
  properties: Record<string, string>,
  fetchImpl: FetchImpl = fetch,
): Promise<HubspotResult<{ id: string }>> {
  const patchPath = `/crm/v3/objects/${encodeURIComponent(ctx.objectType)}/${encodeURIComponent(orderIdValue)}?idProperty=${encodeURIComponent(ctx.idProperty)}`;
  const patched = await hubspotFetch(ctx.baseUrl, ctx.token, patchPath, { method: "PATCH", body: JSON.stringify({ properties }) }, fetchImpl);
  if (patched.ok) return { ok: true, value: { id: String(patched.value.id) } };
  if (patched.kind !== "bad") return patched;

  const created = await hubspotFetch(
    ctx.baseUrl,
    ctx.token,
    `/crm/v3/objects/${encodeURIComponent(ctx.objectType)}`,
    { method: "POST", body: JSON.stringify({ properties: { ...properties, [ctx.idProperty]: orderIdValue } }) },
    fetchImpl,
  );
  if (!created.ok) return created;
  return { ok: true, value: { id: String(created.value.id) } };
}

export async function createAssociation(
  ctx: HubspotCtx,
  orderObjectId: string,
  contactId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<HubspotResult<true>> {
  const r = await hubspotFetch(
    ctx.baseUrl,
    ctx.token,
    `/crm/v4/objects/${encodeURIComponent(ctx.objectType)}/${encodeURIComponent(orderObjectId)}/associations/contacts/${encodeURIComponent(contactId)}`,
    { method: "PUT", body: JSON.stringify([{ associationCategory: "USER_DEFINED", associationTypeId: ctx.associationTypeId }]) },
    fetchImpl,
  );
  if (!r.ok) return r;
  return { ok: true, value: true };
}

export interface ObjectSchemaInfo {
  objectTypeId: string;
  name: string;
  labelSingular: string;
  properties: string[];
}

// Lists every custom object schema in the portal (operator setup — Task 10's
// admin route) so the admin can PICK "Orders" from a dropdown, rather than
// the system guessing its internal name/id up front — HubSpot's
// schema-by-name endpoint needs a name we don't have until the admin tells us.
export async function listObjectSchemas(
  baseUrl: string,
  token: string,
  fetchImpl: FetchImpl = fetch,
): Promise<HubspotResult<ObjectSchemaInfo[]>> {
  const r = await hubspotFetch(baseUrl, token, "/crm/v3/schemas", {}, fetchImpl);
  if (!r.ok) return r;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = Array.isArray(r.value?.results) ? (r.value.results as any[]) : [];
  return {
    ok: true,
    value: results.map((s) => ({
      objectTypeId: String(s.objectTypeId ?? s.name),
      name: String(s.name ?? ""),
      labelSingular: String(s.labels?.singular ?? s.name ?? ""),
      properties: Array.isArray(s.properties) ? s.properties.map((p: { name: string }) => String(p.name)) : [],
    })),
  };
}

// One-off introspection to find the association type id backing the
// existing "Associated Orders" panel — never guess or use HubSpot's generic
// default association when a specific labeled one already exists.
export async function introspectAssociationTypeId(
  baseUrl: string,
  token: string,
  fromObjectType: string,
  toObjectType: string,
  fetchImpl: FetchImpl = fetch,
): Promise<HubspotResult<number>> {
  const r = await hubspotFetch(
    baseUrl,
    token,
    `/crm/v4/associations/${encodeURIComponent(fromObjectType)}/${encodeURIComponent(toObjectType)}/labels`,
    {},
    fetchImpl,
  );
  if (!r.ok) return r;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = Array.isArray(r.value?.results) ? (r.value.results as any[]) : [];
  const withLabel = results.find((l) => typeof l.label === "string" && l.label.length > 0) ?? results[0];
  if (!withLabel) return { ok: false, kind: "bad", message: `No association label found from ${fromObjectType} to ${toObjectType}` };
  return { ok: true, value: Number(withLabel.typeId) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test lib/hubspot-sync/hubspot-client.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/hubspot-sync/hubspot-client.ts lib/hubspot-sync/hubspot-client.test.ts
git commit -m "feat(hubspot-sync): add HubSpot REST client"
```

---

### Task 6: `lib/hubspot-sync/spiro-orders.ts` — client-wide order fetch + agent email cache

**Files:**
- Create: `lib/hubspot-sync/spiro-orders.ts`, `lib/hubspot-sync/spiro-orders.test.ts`

**Interfaces:**
- Consumes: `spiroGet, findAgentById` + `SpiroCtx, SpiroResult` from `@/lib/hollis/spiro` / `@/lib/hollis/types` (pre-existing); `SpiroOrderSummary` from `./types` (Task 2).
- Produces: `toOrderSummary(raw)`, `fetchOrdersSince(ctx, sinceDate, fetchImpl?)`, `createAgentEmailCache(ctx, fetchImpl?)` (returns `{ getEmail(agentId): Promise<SpiroResult<string|null>> }`) — `lib/hubspot-sync/orchestrate.ts` (Task 8) calls all three.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/hubspot-sync/spiro-orders.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toOrderSummary, fetchOrdersSince, createAgentEmailCache } from "./spiro-orders";
import type { SpiroCtx } from "@/lib/hollis/types";

const ctx: SpiroCtx = { baseUrl: "https://api.spiro.media", apiKey: "k", authScheme: "bearer" };

const rawOrder = {
  orderId: "o1",
  trackingCode: "r2m360pl1",
  status: "confirmed",
  dateSubmitted: "2026-07-14T10:00:00-04:00",
  mediaTitle: "Full Photo + Video Package",
  address: { streetAddress: "15 Oak Dr", city: "Mount Pleasant", stateOrProvince: "SC" },
  client: { agentId: "a1" },
  primaryAppointment: { arrivalWindowStart: "2026-07-16T14:00:00-04:00", photographer: { name: "Taylor Thurber" } },
};

test("toOrderSummary flattens dateSubmitted + mediaTitle alongside the existing card fields", () => {
  const s = toOrderSummary(rawOrder);
  assert.equal(s.orderId, "o1");
  assert.equal(s.dateSubmitted, "2026-07-14T10:00:00-04:00");
  assert.equal(s.mediaTitle, "Full Photo + Video Package");
  assert.equal(s.addressText, "15 Oak Dr, Mount Pleasant, SC");
  assert.equal(s.photographerName, "Taylor Thurber");
  assert.equal(s.appointmentDate, "2026-07-16T14:00:00-04:00");
  assert.equal(s.agentId, "a1");
});

function pageOf(n: number, start: number) {
  return { data: Array.from({ length: n }, (_, i) => ({ ...rawOrder, orderId: `o${start + i}` })) };
}

test("fetchOrdersSince stops after a page smaller than the page size", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify(pageOf(3, 0)), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  const r = await fetchOrdersSince(ctx, "2026-07-01", fetchImpl);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.length, 3);
});

test("fetchOrdersSince pages through a full page then stops on the next, smaller one", async () => {
  let call = 0;
  const fetchImpl = (async () => {
    call += 1;
    const body = call === 1 ? pageOf(200, 0) : pageOf(5, 200);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const r = await fetchOrdersSince(ctx, "2026-07-01", fetchImpl);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.length, 205);
  assert.equal(call, 2);
});

test("createAgentEmailCache fetches an agent only once across repeated calls", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ data: { identity: { agentId: "a1" }, contact: { emailAddress: "v@x.com" } } }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const cache = createAgentEmailCache(ctx, fetchImpl);
  const first = await cache.getEmail("a1");
  const second = await cache.getEmail("a1");
  if (first.ok) assert.equal(first.value, "v@x.com");
  if (second.ok) assert.equal(second.value, "v@x.com");
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test lib/hubspot-sync/spiro-orders.test.ts`
Expected: FAIL — `Cannot find module './spiro-orders'`.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// lib/hubspot-sync/spiro-orders.ts
// Client-wide (multi-agent) Spiro order fetch for the HubSpot order-sync job.
// lib/hollis/spiro.ts is agent-scoped (a caller's own orders) — this module
// adds the multi-agent, date-filtered, paginated "everything since X" query
// this job needs, reusing lib/hollis/spiro.ts's spiroGet/findAgentById rather
// than duplicating Spiro's auth/fetch plumbing.
import { spiroGet, findAgentById } from "@/lib/hollis/spiro";
import type { SpiroCtx, SpiroResult } from "@/lib/hollis/types";
import type { SpiroOrderSummary } from "./types";

type FetchImpl = typeof fetch;

const PAGE_SIZE = 200; // Spiro's documented max pageSize

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toOrderSummary(o: any): SpiroOrderSummary {
  const addr = o?.address ?? {};
  const addressText = [addr.streetAddress || addr.fullAddress, addr.city, addr.stateOrProvince].filter(Boolean).join(", ");
  const appt = o?.primaryAppointment ?? {};
  return {
    orderId: String(o?.orderId ?? ""),
    trackingCode: String(o?.trackingCode ?? ""),
    status: String(o?.status ?? "unknown"),
    dateSubmitted: o?.dateSubmitted ?? null,
    addressText,
    mediaTitle: o?.mediaTitle ?? null,
    photographerName: appt?.photographer?.name ?? null,
    appointmentDate: appt?.arrivalWindowStart ?? null,
    agentId: String(o?.client?.agentId ?? o?.agentId ?? ""),
  };
}

// Oldest-first (sort=dateSubmitted, ascending) so a mid-run failure can
// safely resume from the last order actually processed — the caller
// (orchestrate.ts) advances its checkpoint per-order, not per-page.
export async function fetchOrdersSince(
  ctx: SpiroCtx,
  sinceDate: string,
  fetchImpl: FetchImpl = fetch,
): Promise<SpiroResult<SpiroOrderSummary[]>> {
  const out: SpiroOrderSummary[] = [];
  let page = 1;
  for (;;) {
    const path = `/api/v1/orders?filter[dateSubmitted][gte]=${encodeURIComponent(sinceDate)}&page=${page}&pageSize=${PAGE_SIZE}&sort=dateSubmitted`;
    const r = await spiroGet(ctx, path, fetchImpl);
    if (!r.ok) return r;
    const rows = Array.isArray(r.value?.data) ? r.value.data : [];
    out.push(...rows.map(toOrderSummary));
    if (rows.length < PAGE_SIZE) return { ok: true, value: out };
    page += 1;
  }
}

// Caches agent→email lookups for the lifetime of one sync run so an agent
// with many orders in the same batch is fetched from Spiro only once.
export function createAgentEmailCache(ctx: SpiroCtx, fetchImpl: FetchImpl = fetch) {
  const cache = new Map<string, SpiroResult<string | null>>();
  return {
    async getEmail(agentId: string): Promise<SpiroResult<string | null>> {
      const cached = cache.get(agentId);
      if (cached) return cached;
      const r = await findAgentById(ctx, agentId, fetchImpl);
      const result: SpiroResult<string | null> = r.ok ? { ok: true, value: r.value?.email ?? null } : r;
      cache.set(agentId, result);
      return result;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test lib/hubspot-sync/spiro-orders.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/hubspot-sync/spiro-orders.ts lib/hubspot-sync/spiro-orders.test.ts
git commit -m "feat(hubspot-sync): add client-wide Spiro order fetch + agent email cache"
```

---

### Task 7: `lib/hubspot-sync/store.ts` — `hubspot_order_syncs` ledger wrappers

Thin `supabaseAdmin` passthrough, no branching logic — same shape as `lib/analytics/store.ts`, which has no dedicated test file for exactly this reason (`lib/analytics/store-builders.ts` carries the testable logic instead; there's none here to extract). This task is verified by typecheck only, matching that precedent.

**Files:**
- Create: `lib/hubspot-sync/store.ts`

**Interfaces:**
- Consumes: `supabaseAdmin` from `@/lib/supabase` (pre-existing).
- Produces: `getSyncRow(sourceId, spiroOrderId): Promise<SyncRow | null>`, `upsertSyncRow(row): Promise<void>`, `countSyncStats(sourceId): Promise<{matched, unmatched}>` — `lib/hubspot-sync/orchestrate.ts` (Task 8) calls the first two; `app/api/admin/clients/[id]/hubspot-sync/route.ts` (Task 10) calls `countSyncStats`.

- [ ] **Step 1: Write the file**

```typescript
// lib/hubspot-sync/store.ts
// Thin supabaseAdmin wrappers around hubspot_order_syncs (migration 035).
// Tenant isolation is MANUAL, same convention as lib/analytics/store.ts:
// clientId/sourceId here always come from a source row already scoped to
// one client (orchestrate.ts) or the admin [id] route param (Task 10) —
// never from an unscoped request body.
import { supabaseAdmin } from "@/lib/supabase";

export interface SyncRow {
  spiro_order_id: string;
  spiro_status: string | null;
  hubspot_object_id: string | null;
  hubspot_contact_id: string | null;
  match_status: "matched" | "unmatched";
  error: string | null;
}

export async function getSyncRow(sourceId: string, spiroOrderId: string): Promise<SyncRow | null> {
  const { data, error } = await supabaseAdmin
    .from("hubspot_order_syncs")
    .select("spiro_order_id, spiro_status, hubspot_object_id, hubspot_contact_id, match_status, error")
    .eq("source_id", sourceId)
    .eq("spiro_order_id", spiroOrderId)
    .maybeSingle();
  if (error) throw new Error(`getSyncRow: ${error.message}`);
  return data as SyncRow | null;
}

export async function upsertSyncRow(row: {
  client_id: string;
  source_id: string;
  spiro_order_id: string;
  spiro_status: string | null;
  hubspot_object_id: string | null;
  hubspot_contact_id: string | null;
  match_status: "matched" | "unmatched";
  error: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("hubspot_order_syncs")
    .upsert({ ...row, synced_at: new Date().toISOString() }, { onConflict: "source_id,spiro_order_id" });
  if (error) throw new Error(`upsertSyncRow: ${error.message}`);
}

export async function countSyncStats(sourceId: string): Promise<{ matched: number; unmatched: number }> {
  const [{ count: matched }, { count: unmatched }] = await Promise.all([
    supabaseAdmin.from("hubspot_order_syncs").select("id", { count: "exact", head: true }).eq("source_id", sourceId).eq("match_status", "matched"),
    supabaseAdmin.from("hubspot_order_syncs").select("id", { count: "exact", head: true }).eq("source_id", sourceId).eq("match_status", "unmatched"),
  ]);
  return { matched: matched ?? 0, unmatched: unmatched ?? 0 };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/hubspot-sync/store.ts
git commit -m "feat(hubspot-sync): add hubspot_order_syncs ledger store"
```

---

### Task 8: `lib/hubspot-sync/orchestrate.ts` — the sync orchestration

Composes every prior task into one call: fetch Spiro orders since the checkpoint, match each to a HubSpot contact, upsert + associate, record the ledger, advance the checkpoint. Like `lib/wren/poll.ts` and `lib/nora/orchestrate.ts` (this repo's other "load account → fetch → per-item act → advance checkpoint" orchestrators), this composes already-tested pure/network pieces plus direct `supabaseAdmin` calls and has no dedicated test file of its own — verified by typecheck plus the end-to-end manual smoke test in Task 11.

**Files:**
- Create: `lib/hubspot-sync/orchestrate.ts`

**Interfaces:**
- Consumes: `decryptSecret` (`@/lib/analytics/crypto`), `updateSourceConfig` (`@/lib/analytics/store`), `loadSpiroCtx` (`@/lib/hollis/spiro`), `fetchOrdersSince, createAgentEmailCache` (`./spiro-orders`), `searchContactByEmail, upsertOrder, createAssociation` (`./hubspot-client`), `matchContact` (`./match`), `getSyncRow, upsertSyncRow` (`./store`) — all pre-existing from Tasks 2, 5-7 plus repo code.
- Produces: `runHubspotOrderSync(source: DataSourceRow): Promise<OrderSyncSummary>` where `OrderSyncSummary = { matched: number; unmatched: number; failed: number; error: string | null }` — `lib/inngest/functions/hubspot-order-sync.ts` (Task 9) calls this once per HubSpot source.

- [ ] **Step 1: Write the file**

```typescript
// lib/hubspot-sync/orchestrate.ts
// Ties together: Spiro order fetch, contact matching, HubSpot upsert +
// association, and the local hubspot_order_syncs ledger. One call = one
// HubSpot client_data_sources row's daily sync.
//
// Checkpoint lives in the HubSpot source row's OWN config JSONB
// (last_order_sync_at / last_order_sync_error), NOT the shared last_sync_at
// column — see this plan's Global Constraints for why (the unrelated nightly
// analytics-sync cron sweeps every active source regardless of provider).
//
// On any per-order infra failure (Spiro/HubSpot network/auth error) that
// order is left unrecorded (not written to the ledger) and the checkpoint is
// NOT advanced past this run's start time, so the whole window is retried
// next run. Already-synced orders in that window are safe to reprocess —
// the ledger's spiro_status check makes them a no-op — so this fails safe
// (some extra work) rather than silently skipping a failed order forever.
import { decryptSecret } from "@/lib/analytics/crypto";
import { updateSourceConfig } from "@/lib/analytics/store";
import { loadSpiroCtx } from "@/lib/hollis/spiro";
import { fetchOrdersSince, createAgentEmailCache } from "./spiro-orders";
import { searchContactByEmail, upsertOrder, createAssociation } from "./hubspot-client";
import { matchContact } from "./match";
import { getSyncRow, upsertSyncRow } from "./store";
import type { HubspotCtx } from "./types";
import type { DataSourceRow } from "@/lib/analytics/types";

const HUBSPOT_BASE_URL = "https://api.hubapi.com";

export interface OrderSyncSummary {
  matched: number;
  unmatched: number;
  failed: number;
  error: string | null;
}

interface HubspotSourceConfig {
  spiro_source_id?: string;
  hubspot_object_type?: string;
  hubspot_id_property?: string;
  association_type_id?: number;
  cutoff_date?: string;
  last_order_sync_at?: string;
  last_order_sync_error?: string | null;
}

export async function runHubspotOrderSync(source: DataSourceRow): Promise<OrderSyncSummary> {
  const config = source.config as HubspotSourceConfig;

  if (!config.spiro_source_id) {
    return { matched: 0, unmatched: 0, failed: 0, error: "No Spiro source paired — set it in the HubSpot Order Sync panel" };
  }
  if (!source.secret_enc) {
    return { matched: 0, unmatched: 0, failed: 0, error: "No HubSpot token configured" };
  }
  if (!config.hubspot_object_type || !config.hubspot_id_property || !config.association_type_id) {
    return { matched: 0, unmatched: 0, failed: 0, error: "HubSpot object schema not yet introspected — see the HubSpot Order Sync panel" };
  }

  const spiroCtx = await loadSpiroCtx(source.client_id, config.spiro_source_id);
  if (!spiroCtx) {
    return { matched: 0, unmatched: 0, failed: 0, error: "Paired Spiro source not found or has no API key" };
  }

  const hubspotCtx: HubspotCtx = {
    baseUrl: HUBSPOT_BASE_URL,
    token: decryptSecret(source.secret_enc),
    objectType: config.hubspot_object_type,
    idProperty: config.hubspot_id_property,
    associationTypeId: config.association_type_id,
  };

  const since = config.last_order_sync_at ?? config.cutoff_date;
  if (!since) {
    return { matched: 0, unmatched: 0, failed: 0, error: "No cutoff date configured — set a go-live date in the HubSpot Order Sync panel" };
  }

  const runStartedAt = new Date().toISOString();
  const ordersResult = await fetchOrdersSince(spiroCtx, since);
  if (!ordersResult.ok) {
    await updateSourceConfig(source.id, { ...config, last_order_sync_error: ordersResult.message });
    return { matched: 0, unmatched: 0, failed: 0, error: ordersResult.message };
  }

  const agentEmails = createAgentEmailCache(spiroCtx);
  let matched = 0;
  let unmatched = 0;
  let failed = 0;

  for (const order of ordersResult.value) {
    const existing = await getSyncRow(source.id, order.orderId);
    if (existing && existing.spiro_status === order.status) {
      if (existing.match_status === "matched") matched += 1;
      else unmatched += 1;
      continue;
    }

    const emailResult = await agentEmails.getEmail(order.agentId);
    if (!emailResult.ok) {
      failed += 1;
      continue; // not recorded — retried next run since the checkpoint won't advance past it
    }

    const searchResult = await searchContactByEmail(hubspotCtx, emailResult.value ?? "");
    if (!searchResult.ok) {
      failed += 1;
      continue;
    }

    const outcome = matchContact(emailResult.value, searchResult.value);
    if (outcome.kind === "unmatched") {
      await upsertSyncRow({
        client_id: source.client_id,
        source_id: source.id,
        spiro_order_id: order.orderId,
        spiro_status: order.status,
        hubspot_object_id: null,
        hubspot_contact_id: null,
        match_status: "unmatched",
        error: outcome.reason,
      });
      unmatched += 1;
      continue;
    }

    const properties: Record<string, string> = {
      status: order.status,
      tracking_code: order.trackingCode,
      address: order.addressText,
    };
    if (order.dateSubmitted) properties.date_submitted = order.dateSubmitted;
    if (order.mediaTitle) properties.media_title = order.mediaTitle;
    if (order.photographerName) properties.photographer = order.photographerName;
    if (order.appointmentDate) properties.appointment_date = order.appointmentDate;

    const upserted = await upsertOrder(hubspotCtx, order.orderId, properties);
    if (!upserted.ok) {
      failed += 1;
      continue;
    }
    const associated = await createAssociation(hubspotCtx, upserted.value.id, outcome.contact.id);
    if (!associated.ok) {
      failed += 1;
      continue;
    }

    await upsertSyncRow({
      client_id: source.client_id,
      source_id: source.id,
      spiro_order_id: order.orderId,
      spiro_status: order.status,
      hubspot_object_id: upserted.value.id,
      hubspot_contact_id: outcome.contact.id,
      match_status: "matched",
      error: null,
    });
    matched += 1;
  }

  const nextConfig: HubspotSourceConfig = {
    ...config,
    last_order_sync_error: failed > 0 ? `${failed} order(s) failed this run — will retry` : null,
  };
  if (failed === 0) nextConfig.last_order_sync_at = runStartedAt;
  await updateSourceConfig(source.id, nextConfig);

  return { matched, unmatched, failed, error: nextConfig.last_order_sync_error ?? null };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/hubspot-sync/orchestrate.ts
git commit -m "feat(hubspot-sync): add sync orchestration"
```

---

### Task 9: `lib/inngest/functions/hubspot-order-sync.ts` — the daily job

**Files:**
- Create: `lib/inngest/functions/hubspot-order-sync.ts`
- Modify: `app/api/inngest/route.ts`

**Interfaces:**
- Consumes: `inngest` (`@/lib/inngest/client`), `runHubspotOrderSync` (`@/lib/hubspot-sync/orchestrate`, Task 8), `DataSourceRow` (`@/lib/analytics/types`).
- Produces: exported `hubspotOrderSync` Inngest function, registered in `app/api/inngest/route.ts`'s `functions` array — Task 10's admin route sends it the `crm/hubspot.sync_requested` event.

- [ ] **Step 1: Write the file**

```typescript
// lib/inngest/functions/hubspot-order-sync.ts
//
// Daily HubSpot order-attribution sync for Elevated Productions (and any
// future client with a provider='hubspot' source). Triggered by cron (6am
// ET, staggered an hour after analytics-sync's 5am run so the two don't hit
// Spiro at the same moment) and by "crm/hubspot.sync_requested" (the admin
// "Sync now" button — one client). Concurrency keyed on clientId so an event
// run for the same client serializes. One durable step per source so a
// failing client never blocks another (Promise.allSettled — same pattern as
// analytics-sync.ts). Runtime deps are lazy-imported inside steps
// (hollis-call-completed / analytics-sync pattern).
import { inngest } from "@/lib/inngest/client";
import type { DataSourceRow } from "@/lib/analytics/types";

export const hubspotOrderSync = inngest.createFunction(
  {
    id: "hubspot-order-sync",
    name: "HubSpot: order attribution sync",
    concurrency: [{ key: "event.data.clientId", limit: 1 }],
    triggers: [
      { cron: "TZ=America/New_York 0 6 * * *" },
      { event: "crm/hubspot.sync_requested" },
    ],
  },
  async ({ event, step }) => {
    // Event runs scope to one client; cron runs (no event.data) cover all.
    const data = (event as { data?: { clientId?: unknown } }).data;
    const scopedClientId = typeof data?.clientId === "string" ? data.clientId : undefined;

    const sources = await step.run("load-sources", async () => {
      const { supabaseAdmin } = await import("@/lib/supabase");
      let query = supabaseAdmin
        .from("client_data_sources")
        .select("*")
        .eq("status", "active")
        .eq("provider", "hubspot");
      if (scopedClientId) query = query.eq("client_id", scopedClientId);
      const { data: rows, error } = await query;
      if (error) throw new Error(`hubspot-order-sync load-sources: ${error.message}`);
      return rows ?? [];
    });
    if (sources.length === 0) return { synced: 0, failed: 0, clients: 0 };

    // Rows round-trip through step JSON serialization; shape is unchanged
    // (analytics-sync.ts convention).
    const typedSources = sources as DataSourceRow[];

    const results = await Promise.allSettled(
      typedSources.map((source) =>
        step.run(`sync-${source.id}`, async () => {
          const { runHubspotOrderSync } = await import("@/lib/hubspot-sync/orchestrate");
          try {
            const summary = await runHubspotOrderSync(source);
            return { sourceId: source.id, ok: summary.error === null, summary };
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return { sourceId: source.id, ok: false as const, summary: { matched: 0, unmatched: 0, failed: 0, error: reason } };
          }
        }),
      ),
    );

    let synced = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.ok) synced += 1;
      else failed += 1;
    }
    return { synced, failed, clients: typedSources.length };
  },
);
```

- [ ] **Step 2: Register the function**

In `app/api/inngest/route.ts`, add the import and include it in the `functions` array:

```typescript
import { hubspotOrderSync } from "@/lib/inngest/functions/hubspot-order-sync";
```

```typescript
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [stewardScheduled, devagentRun, hollisCallCompleted, onboardingContractSigned, onboardingInvoicePaid, analyticsSync, analyticsDigest, hubspotOrderSync],
});
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/inngest/functions/hubspot-order-sync.ts app/api/inngest/route.ts
git commit -m "feat(hubspot-sync): add daily order-sync Inngest job"
```

---

### Task 10: `app/api/admin/clients/[id]/hubspot-sync/route.ts` — admin config route

Three actions on one route, mirroring the existing `analytics/sources` + `analytics/sync` route conventions: `PATCH { action: "introspect" }` lists every custom object schema so the admin can identify "Orders" (HubSpot's schema-by-name lookup needs a name we don't have yet); `PATCH { action: "select_schema", objectTypeId }` locks in that choice, checks the `spiro_order_id` property already exists on it (if not, tells the admin to add it in HubSpot first rather than guessing a property group to auto-create it with), and introspects the association type id backing the existing "Associated Orders" panel; plain `PATCH { spiro_source_id?, cutoff_date? }` saves the pairing config; `POST` fires the manual "Sync now" event.

**Files:**
- Create: `app/api/admin/clients/[id]/hubspot-sync/route.ts`

**Interfaces:**
- Consumes: `requireAdmin` (`@/lib/admin-auth`), `supabaseAdmin` (`@/lib/supabase`), `inngest` (`@/lib/inngest/client`), `decryptSecret` (`@/lib/analytics/crypto`), `updateSourceConfig` (`@/lib/analytics/store`), `listObjectSchemas, introspectAssociationTypeId` (`@/lib/hubspot-sync/hubspot-client`, Task 5), `DataSourceRow` (`@/lib/analytics/types`).
- Produces: the three request shapes above — Task 12's `HubspotSyncManager.tsx` calls all of them by these exact paths/bodies.

- [ ] **Step 1: Write the file**

```typescript
// app/api/admin/clients/[id]/hubspot-sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { inngest } from "@/lib/inngest/client";
import { decryptSecret } from "@/lib/analytics/crypto";
import { updateSourceConfig } from "@/lib/analytics/store";
import { listObjectSchemas, introspectAssociationTypeId } from "@/lib/hubspot-sync/hubspot-client";
import type { DataSourceRow } from "@/lib/analytics/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const HUBSPOT_BASE_URL = "https://api.hubapi.com";
const ORDER_ID_PROPERTY = "spiro_order_id";

async function findHubspotSource(clientId: string): Promise<DataSourceRow | null> {
  const { data } = await supabaseAdmin
    .from("client_data_sources")
    .select("*")
    .eq("client_id", clientId)
    .eq("provider", "hubspot")
    .maybeSingle();
  return (data as DataSourceRow | null) ?? null;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const source = await findHubspotSource(id);
  if (!source) return NextResponse.json({ error: "Add a HubSpot source first (Analytics section)" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  if (body.action === "introspect") {
    if (!source.secret_enc) return NextResponse.json({ error: "No HubSpot token configured yet" }, { status: 400 });
    const schemas = await listObjectSchemas(HUBSPOT_BASE_URL, decryptSecret(source.secret_enc));
    if (!schemas.ok) return NextResponse.json({ error: schemas.message }, { status: 502 });
    return NextResponse.json({ schemas: schemas.value });
  }

  if (body.action === "select_schema") {
    if (!source.secret_enc) return NextResponse.json({ error: "No HubSpot token configured yet" }, { status: 400 });
    const objectTypeId = body.objectTypeId;
    if (typeof objectTypeId !== "string" || objectTypeId.length === 0) {
      return NextResponse.json({ error: "objectTypeId is required" }, { status: 400 });
    }
    const token = decryptSecret(source.secret_enc);

    const schemas = await listObjectSchemas(HUBSPOT_BASE_URL, token);
    if (!schemas.ok) return NextResponse.json({ error: schemas.message }, { status: 502 });
    const picked = schemas.value.find((s) => s.objectTypeId === objectTypeId);
    if (!picked) return NextResponse.json({ error: "That object was not found on re-check" }, { status: 404 });
    if (!picked.properties.includes(ORDER_ID_PROPERTY)) {
      return NextResponse.json(
        { error: `Add a "${ORDER_ID_PROPERTY}" (single-line text) property to the ${picked.labelSingular} object in HubSpot first, then try again.` },
        { status: 400 },
      );
    }

    const assoc = await introspectAssociationTypeId(HUBSPOT_BASE_URL, token, objectTypeId, "contacts");
    if (!assoc.ok) return NextResponse.json({ error: assoc.message }, { status: 502 });

    const config = { ...source.config, hubspot_object_type: objectTypeId, hubspot_id_property: ORDER_ID_PROPERTY, association_type_id: assoc.value };
    await updateSourceConfig(source.id, config);
    return NextResponse.json({ ok: true, config });
  }

  // Plain pairing update.
  const config: Record<string, unknown> = { ...source.config };
  if ("spiro_source_id" in body) {
    if (typeof body.spiro_source_id !== "string" || body.spiro_source_id.length === 0) {
      return NextResponse.json({ error: "spiro_source_id must be a non-empty string" }, { status: 400 });
    }
    config.spiro_source_id = body.spiro_source_id;
  }
  if ("cutoff_date" in body) {
    if (typeof body.cutoff_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.cutoff_date)) {
      return NextResponse.json({ error: "cutoff_date must be YYYY-MM-DD" }, { status: 400 });
    }
    config.cutoff_date = body.cutoff_date;
  }
  await updateSourceConfig(source.id, config);
  return NextResponse.json({ ok: true, config });
}

export async function POST(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const source = await findHubspotSource(id);
  if (!source) return NextResponse.json({ error: "No HubSpot source configured" }, { status: 400 });

  await inngest.send({ name: "crm/hubspot.sync_requested", data: { clientId: id, sourceId: source.id } });
  return NextResponse.json({ ok: true, queued: true });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/clients/[id]/hubspot-sync/route.ts
git commit -m "feat(hubspot-sync): add admin config route"
```

---

### Task 11: `AnalyticsManager.tsx` — add the `hubspot` provider option

Reuses every existing add/list/patch/delete/test/pause/resume affordance in the "Add a source" form — only the provider list and one conditional render branch change. No new component, no test file (this component has none today; verified by typecheck + the manual browser smoke test in Task 14).

**Files:**
- Modify: `app/(admin)/clients/[id]/AnalyticsManager.tsx:23-27` (the `PROVIDERS` array), `AnalyticsManager.tsx:256-270` (the provider-specific fields block)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new (purely additive UI branch) — Task 13 does not depend on this task's internals, only on a `provider='hubspot'` `client_data_sources` row existing, which this task's form now makes possible to create.

- [ ] **Step 1: Add `hubspot` to `PROVIDERS`**

Replace:

```tsx
const PROVIDERS = [
  { value: "spiro", label: "Spiro (REST)", kind: "rest" as const },
  { value: "spiro_mcp", label: "Spiro (MCP)", kind: "mcp" as const },
  { value: "generic_mcp", label: "Generic MCP", kind: "mcp" as const },
];
```

with:

```tsx
const PROVIDERS = [
  { value: "spiro", label: "Spiro (REST)", kind: "rest" as const },
  { value: "spiro_mcp", label: "Spiro (MCP)", kind: "mcp" as const },
  { value: "generic_mcp", label: "Generic MCP", kind: "mcp" as const },
  { value: "hubspot", label: "HubSpot (REST)", kind: "rest" as const },
];
```

- [ ] **Step 2: Give `hubspot` its own (empty) fields branch instead of falling into the MCP block**

Replace:

```tsx
      {provider === "spiro" ? (
        <div className="admin-input-row" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <div>
            <label>Base URL</label>
            <input className="admin-input" style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.spiro.media" />
          </div>
          <div>
            <label>Auth scheme</label>
            <select className="admin-select" style={{ marginBottom: 0 }} value={authScheme} onChange={(e) => setAuthScheme(e.target.value)}>
              <option value="bearer">Bearer</option>
              <option value="apikey">API key header</option>
            </select>
          </div>
        </div>
      ) : (
        <>
          <div className="admin-input-row" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <div>
              <label>Auth mode</label>
              <select className="admin-select" style={{ marginBottom: 0 }} value={authMode} onChange={(e) => setAuthMode(e.target.value as "oauth" | "static")}>
                <option value="oauth">OAuth login</option>
                <option value="static">Static token</option>
              </select>
            </div>
            <div>
              <label>MCP endpoint URL</label>
              <input className="admin-input" style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }} value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} placeholder="https://mcp.example.com/v1" />
            </div>
          </div>
        </>
      )}
```

with:

```tsx
      {provider === "spiro" ? (
        <div className="admin-input-row" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <div>
            <label>Base URL</label>
            <input className="admin-input" style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.spiro.media" />
          </div>
          <div>
            <label>Auth scheme</label>
            <select className="admin-select" style={{ marginBottom: 0 }} value={authScheme} onChange={(e) => setAuthScheme(e.target.value)}>
              <option value="bearer">Bearer</option>
              <option value="apikey">API key header</option>
            </select>
          </div>
        </div>
      ) : provider === "hubspot" ? (
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-mute)" }}>
          HubSpot uses a Private App token only — generate one in HubSpot Settings → Integrations → Private Apps, then paste it below. No base URL or auth mode to configure.
        </div>
      ) : (
        <>
          <div className="admin-input-row" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <div>
              <label>Auth mode</label>
              <select className="admin-select" style={{ marginBottom: 0 }} value={authMode} onChange={(e) => setAuthMode(e.target.value as "oauth" | "static")}>
                <option value="oauth">OAuth login</option>
                <option value="static">Static token</option>
              </select>
            </div>
            <div>
              <label>MCP endpoint URL</label>
              <input className="admin-input" style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }} value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} placeholder="https://mcp.example.com/v1" />
            </div>
          </div>
        </>
      )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/clients/[id]/AnalyticsManager.tsx"
git commit -m "feat(hubspot-sync): add hubspot provider option to Add a source form"
```

---

### Task 12: `HubspotSyncManager.tsx` — the new admin panel

A three-stage form driven entirely by `config`'s shape: pair a Spiro source + cutoff date → introspect + link the HubSpot object → steady-state stats + manual sync. No test file (matches every other `*Manager.tsx` in this repo — verified by typecheck + the manual browser smoke test in Task 14).

**Files:**
- Create: `app/(admin)/clients/[id]/HubspotSyncManager.tsx`

**Interfaces:**
- Consumes: the three `hubspot-sync` route shapes from Task 10 (`PATCH` plain pairing, `PATCH {action:"introspect"}`, `PATCH {action:"select_schema", objectTypeId}`, `POST`).
- Produces: `<HubspotSyncManager clientId spiroSources hubspotSourceId initialConfig hasSecret stats />` — Task 13's `page.tsx` renders this.

- [ ] **Step 1: Write the file**

```tsx
"use client";
import { useState } from "react";

type HubspotSourceConfig = {
  spiro_source_id?: string;
  hubspot_object_type?: string;
  hubspot_id_property?: string;
  association_type_id?: number;
  cutoff_date?: string;
  last_order_sync_at?: string;
  last_order_sync_error?: string | null;
};

type SchemaOption = { objectTypeId: string; name: string; labelSingular: string; properties: string[] };

type Props = {
  clientId: string;
  hubspotSourceId: string | null;
  initialConfig: HubspotSourceConfig;
  hasSecret: boolean;
  spiroSources: { id: string; label: string }[];
  stats: { matched: number; unmatched: number };
};

export function HubspotSyncManager({ clientId, hubspotSourceId, initialConfig, hasSecret, spiroSources, stats }: Props) {
  const [config, setConfig] = useState<HubspotSourceConfig>(initialConfig);
  const [spiroSourceId, setSpiroSourceId] = useState(config.spiro_source_id ?? "");
  const [cutoffDate, setCutoffDate] = useState(config.cutoff_date ?? new Date().toISOString().slice(0, 10));
  const [schemas, setSchemas] = useState<SchemaOption[] | null>(null);
  const [selectedObjectTypeId, setSelectedObjectTypeId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  function flash(text: string, tone: "ok" | "err") {
    setMsg({ text, tone });
    setTimeout(() => setMsg(null), 5000);
  }

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/clients/${clientId}/hubspot-sync`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { ok: res.ok, data };
  }

  async function savePairing() {
    if (!spiroSourceId) { flash("Pick a Spiro source", "err"); return; }
    setBusy("pairing");
    const { ok, data } = await patch({ spiro_source_id: spiroSourceId, cutoff_date: cutoffDate });
    setBusy(null);
    if (ok) { setConfig(data.config); flash("Saved", "ok"); }
    else flash(data.error || "Failed to save", "err");
  }

  async function introspect() {
    setBusy("introspect");
    const { ok, data } = await patch({ action: "introspect" });
    setBusy(null);
    if (ok) { setSchemas(data.schemas); flash(`Found ${data.schemas.length} custom object(s)`, "ok"); }
    else flash(data.error || "Introspection failed", "err");
  }

  async function selectSchema() {
    if (!selectedObjectTypeId) { flash("Pick an object", "err"); return; }
    setBusy("select");
    const { ok, data } = await patch({ action: "select_schema", objectTypeId: selectedObjectTypeId });
    setBusy(null);
    if (ok) { setConfig(data.config); setSchemas(null); flash("Object linked — ready to sync", "ok"); }
    else flash(data.error || "Failed to link object", "err");
  }

  async function syncNow() {
    setBusy("sync");
    const res = await fetch(`/api/admin/clients/${clientId}/hubspot-sync`, { method: "POST" });
    setBusy(null);
    flash(res.ok ? "Sync queued" : "Failed to queue sync", res.ok ? "ok" : "err");
  }

  if (!hubspotSourceId) {
    return (
      <div className="admin-card">
        <div className="admin-card-head"><h2>HubSpot Order Sync</h2></div>
        <div className="admin-empty">Add a HubSpot source in the Analytics section above (paste a Private App token), then come back here to configure the sync.</div>
      </div>
    );
  }

  const paired = !!config.spiro_source_id;
  const linked = !!config.hubspot_object_type;

  return (
    <div className="admin-card">
      <div className="admin-card-head"><h2>HubSpot Order Sync</h2></div>

      {!hasSecret && <div className="admin-empty">Paste a HubSpot Private App token in the Analytics section above first.</div>}

      {hasSecret && !paired && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label>Spiro source to pull orders from</label>
            <select className="admin-select" style={{ marginBottom: 0 }} value={spiroSourceId} onChange={(e) => setSpiroSourceId(e.target.value)}>
              <option value="">Select…</option>
              {spiroSources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label>Go-live cutoff date <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>— only orders submitted on/after this date ever sync, no backfill</span></label>
            <input className="admin-input" style={{ marginBottom: 0 }} type="date" value={cutoffDate} onChange={(e) => setCutoffDate(e.target.value)} />
          </div>
          <button className="admin-btn admin-btn-sm" disabled={busy === "pairing"} onClick={savePairing} style={{ alignSelf: "flex-start" }}>
            {busy === "pairing" ? "Saving…" : "Save pairing"}
          </button>
        </div>
      )}

      {hasSecret && paired && !linked && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: "var(--text-mute)" }}>Paired to a Spiro source. Next: link HubSpot&apos;s existing &quot;Orders&quot; custom object.</div>
          <button className="admin-btn admin-btn-sm" disabled={busy === "introspect"} onClick={introspect} style={{ alignSelf: "flex-start" }}>
            {busy === "introspect" ? "Looking…" : "Find custom objects"}
          </button>
          {schemas && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <select className="admin-select" style={{ marginBottom: 0 }} value={selectedObjectTypeId} onChange={(e) => setSelectedObjectTypeId(e.target.value)}>
                <option value="">Select the Orders object…</option>
                {schemas.map((s) => <option key={s.objectTypeId} value={s.objectTypeId}>{s.labelSingular} ({s.objectTypeId})</option>)}
              </select>
              <button className="admin-btn admin-btn-sm" disabled={busy === "select"} onClick={selectSchema} style={{ alignSelf: "flex-start" }}>
                {busy === "select" ? "Linking…" : "Use this object"}
              </button>
            </div>
          )}
        </div>
      )}

      {hasSecret && paired && linked && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--text-mute)" }}>
            {config.last_order_sync_at ? `last synced ${new Date(config.last_order_sync_at).toLocaleString()}` : "never synced"}
          </div>
          {config.last_order_sync_error && <div style={{ fontSize: 12, color: "var(--red)" }}>{config.last_order_sync_error}</div>}
          <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
            <span>{stats.matched} matched</span>
            <span style={{ color: "var(--text-mute)" }}>{stats.unmatched} unmatched</span>
          </div>
          <button className="admin-btn-ghost admin-btn-sm" disabled={busy === "sync"} onClick={syncNow} style={{ alignSelf: "flex-start" }}>
            {busy === "sync" ? "Queuing…" : "Sync now"}
          </button>
        </div>
      )}

      {msg && <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: msg.tone === "ok" ? "var(--sage)" : "var(--red)", marginTop: 10 }}>{msg.text}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/clients/[id]/HubspotSyncManager.tsx"
git commit -m "feat(hubspot-sync): add HubSpot Order Sync admin panel"
```

---

### Task 13: Wire `HubspotSyncManager` into `page.tsx`

**Files:**
- Modify: `app/(admin)/clients/[id]/page.tsx`

**Interfaces:**
- Consumes: `countSyncStats` (`@/lib/hubspot-sync/store`, Task 7), `HubspotSyncManager` (Task 12). `dataSources` is already fetched by the existing `Promise.all` (`client_data_sources` select at `page.tsx:83-87`) — no new top-level query needed for the source row itself, only for its stats.
- Produces: the rendered panel on the client detail admin page — nothing downstream depends on this task.

- [ ] **Step 1: Add the import**

Add alongside the other Manager imports:

```typescript
import { HubspotSyncManager } from "./HubspotSyncManager";
import { countSyncStats } from "@/lib/hubspot-sync/store";
```

- [ ] **Step 2: Derive the HubSpot source and fetch its stats**

Immediately after the existing line:

```typescript
  const spiroSources = (dataSources ?? [])
    .filter((s) => s.provider === "spiro")
    .map((s) => ({ id: s.id as string, label: s.label as string }));
```

add:

```typescript
  const hubspotSource = (dataSources ?? []).find((s) => s.provider === "hubspot") ?? null;
  const hubspotStats = hubspotSource
    ? await countSyncStats(hubspotSource.id as string).catch(() => ({ matched: 0, unmatched: 0 }))
    : { matched: 0, unmatched: 0 };
```

- [ ] **Step 3: Render the panel after `AnalyticsManager`**

Replace:

```tsx
          <AnalyticsManager
            clientId={id}
            // secret_enc is stripped here and replaced with derived booleans —
            // the encrypted credential blob (static secret OR OAuth token
            // bundle) must never reach the browser.
            initialSources={(dataSources ?? []).map(({ secret_enc, ...s }) => ({
              ...s,
              has_secret: secret_enc != null,
              has_tokens: hasStoredTokens(secret_enc),
            }))}
            digestEnabled={client.analytics_digest_enabled ?? true}
            initialGoalRevenue={typeof goalSnap?.goal?.revenue === "number" ? goalSnap.goal.revenue : null}
          />
```

with:

```tsx
          <AnalyticsManager
            clientId={id}
            // secret_enc is stripped here and replaced with derived booleans —
            // the encrypted credential blob (static secret OR OAuth token
            // bundle) must never reach the browser.
            initialSources={(dataSources ?? []).map(({ secret_enc, ...s }) => ({
              ...s,
              has_secret: secret_enc != null,
              has_tokens: hasStoredTokens(secret_enc),
            }))}
            digestEnabled={client.analytics_digest_enabled ?? true}
            initialGoalRevenue={typeof goalSnap?.goal?.revenue === "number" ? goalSnap.goal.revenue : null}
          />

          <HubspotSyncManager
            clientId={id}
            hubspotSourceId={(hubspotSource?.id as string | undefined) ?? null}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            initialConfig={(hubspotSource?.config as any) ?? {}}
            hasSecret={hubspotSource?.secret_enc != null}
            spiroSources={spiroSources}
            stats={hubspotStats}
          />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — every test from Tasks 2-9 plus the full pre-existing suite.

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/clients/[id]/page.tsx"
git commit -m "feat(hubspot-sync): wire HubSpot Order Sync panel into the client admin page"
```

---

### Task 14: End-to-end operator smoke test (manual, no code)

Unit tests cover every pure/network function in isolation; this is the one pass that exercises the whole chain against Elevated's real HubSpot portal, matching the repo's convention for anything Retell/Slack/live-credential-shaped (see the Hollis order-desk plan's Retell smoke test). Perform this after Tasks 1-13 are deployed, once Elevated has generated a HubSpot Private App token.

- [ ] **Step 1:** In HubSpot, generate a Private App token scoped at minimum to `crm.objects.contacts.read`, `crm.objects.custom.read`, `crm.objects.custom.write`, `crm.schemas.custom.read`, and confirm (or add) a single-line-text property named `spiro_order_id` on the existing "Orders" custom object.
- [ ] **Step 2:** In the admin client page's Analytics section, add a source: provider "HubSpot (REST)", paste the token, save, then click "Test" — expect "HubSpot token OK — contacts read access confirmed".
- [ ] **Step 3:** In the new "HubSpot Order Sync" panel, pick the client's Spiro source, set the cutoff date, save.
- [ ] **Step 4:** Click "Find custom objects", confirm the "Orders" object appears in the dropdown with `spiro_order_id` already present (if the route's `select_schema` error fires instead, add the property in HubSpot and retry), select it, click "Use this object".
- [ ] **Step 5:** Click "Sync now". Watch the Inngest dashboard (or `client_logs`) for the `hubspot-order-sync` function run to complete.
- [ ] **Step 6:** In HubSpot, open a contact known to have a recent Spiro order under that email and confirm the order now appears under "Associated Orders" with the expected fields (status, tracking code, address, etc.).
- [ ] **Step 7:** Confirm the panel's matched/unmatched counts updated and `last_order_sync_at` shows a recent timestamp.

---

## Self-Review

**1. Spec coverage** — every §-numbered decision in the design spec maps to a task: §2 access/feasibility → Tasks 5-6 (real REST calls, no webhook); §3 sync flow → Tasks 8-9; §4 matching → Task 3; §5 write layer → Task 5 (upsert/associate) + Task 10 (property-exists check replaces the spec's "added at build time" property-creation ambiguity with an explicit, safe check); §6 data model → Task 1 (ledger table) + the Global Constraints correction (checkpoint moved into `config`, not `last_sync_at`); §7 admin/config → Tasks 4, 10-13; §8 error handling → Task 8's per-order failure/retry logic + Task 4's adapter no-op; §9 reused/net-new → matches the file list above; §10 testing → each task's own test step; §11 out of scope → nothing in this plan builds contact auto-creation, notifications, a Spiro webhook, or fuzzy matching.

**2. Placeholder scan** — no TBD/TODO in any step; every code block is complete and self-contained; Task 14 is intentionally manual/checklist-shaped (no code to write — it's an operator verification pass against live credentials that don't exist until Tasks 1-13 ship).

**3. Type consistency** — `HubspotCtx`/`SpiroOrderSummary`/`HubspotContact`/`MatchOutcome`/`HubspotResult` (Task 2) are used with identical field names across Tasks 5, 6, 8; `OrderSyncSummary` (Task 8) matches what Task 9's Inngest function destructures (`summary.error`); `SyncRow`/`getSyncRow`/`upsertSyncRow`/`countSyncStats` (Task 7) match Task 8's and Task 13's call sites exactly; the `HubspotSourceConfig` shape (`spiro_source_id`, `hubspot_object_type`, `hubspot_id_property`, `association_type_id`, `cutoff_date`, `last_order_sync_at`, `last_order_sync_error`) is identical across Task 8 (orchestrate.ts), Task 10 (route.ts), and Task 12 (HubspotSyncManager.tsx).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-15-elevated-hubspot-order-sync.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
