# Analytics Dashboard — Design Spec

**Date:** 2026-07-07
**Status:** Approved design, pending implementation plan
**Owner decision summary:** bundled platform feature (not a sellable product); portal + admin mirror; hybrid connectors (REST sync + MCP); AI = ask-your-data chat + auto insights + weekly digests; launch scope includes CSV/PDF exports, audit trail, and multi-source support; role-gating deferred.

## 1. What we're building

An enterprise-grade, multi-client business analytics dashboard, bundled into the platform. John connects one or more **data sources** to a client from admin (that act *is* activation); the client's team then sees an **Analytics** tab in their portal with fast KPI tiles, charts, AI-written insights, an ask-your-data chat, exports, and a weekly email digest. Admin gets a per-client manager card (sources, sync, health) plus a mirror of exactly what the client sees.

First client: **Elevated Productions** (real-estate media company on Spiro). Verified live 2026-07-07 via their MCP server: ~300–500 orders/month, ~$90–150k/month revenue; FY2025-07→2026-06 ≈ $1.47M / 4,579 orders. June 2026 = 286 orders / $100,054.30 — the built dashboard must reproduce these numbers.

### Why hybrid connectors (decision)

The Spiro MCP server is read-only, uses short-lived interactive OAuth (~1h), and Spiro's own integration guidance states MCP is for chat-time analysis while **durable dashboards must use their REST API** (`https://api.spiro.media/`, OpenAPI) with an API key. A headless platform cannot hold an interactive OAuth MCP session open. Therefore:

- **Dashboard tiles** are powered by scheduled syncs into our own DB (warehouse), via provider adapters — REST for Spiro.
- **AI chat** is where MCP shines: connected MCP servers' tools are exposed (allowlisted) to the chat model for live drill-down.
- A source is `kind: 'rest' | 'mcp'`; a client can have any mix (multi-source is in launch scope).

## 2. Data model — migration `032_analytics.sql`

Next free migration number is **032** (verified; filenames are authoritative — numbering has collided historically). Every table: UUID PK `DEFAULT gen_random_uuid()`, `client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE`, `created_at`/`updated_at TIMESTAMPTZ DEFAULT NOW()`, `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `CREATE POLICY "service role only" … FOR ALL USING (false)`. Boxed comment header per convention.

### `client_data_sources`
| column | type | notes |
|---|---|---|
| kind | TEXT CHECK IN ('mcp','rest') | transport family |
| provider | TEXT | `'spiro'`, `'generic_mcp'`; future: `'stripe'`, … |
| label | TEXT NOT NULL | admin-facing name, e.g. "Spiro — production" |
| config | JSONB DEFAULT '{}' | non-secret: base/endpoint URL, account name, timezone |
| secret_enc | TEXT NULL | AES-256-GCM-encrypted credential blob (see §3) |
| chat_tool_allowlist | JSONB DEFAULT '[]' | MCP tool names admin approved for chat |
| status | TEXT CHECK IN ('active','paused','error') DEFAULT 'active' | |
| last_sync_at / last_sync_error | TIMESTAMPTZ / TEXT | health surface |

`UNIQUE(client_id, provider, label)`.

### `analytics_metrics` (the warehouse)
`source_id UUID REFERENCES client_data_sources(id) ON DELETE CASCADE`, `metric TEXT` (`orders.count`, `orders.revenue`, …), `grain TEXT CHECK IN ('day','week','month')`, `period_start DATE`, `period_end DATE`, `dimension JSONB DEFAULT '{}'`, `dimension_key TEXT NOT NULL DEFAULT ''` (canonical serialization, e.g. `company=X|product=Y`; empty string = no dimensions), `value NUMERIC NOT NULL`, `synced_at`.

- `UNIQUE(source_id, metric, grain, period_start, dimension_key)` → idempotent re-sync upserts (iris dedupe pattern).
- Index `(client_id, metric, period_start DESC)`.

### `analytics_snapshots`
One row per client: `client_id UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE`, `payload JSONB` (all precomputed tile/chart/table data), `insights JSONB` (AI cards: text, generated_at, model), `computed_at TIMESTAMPTZ`. Dashboard pages read **only** this row → one-query page load (nora `last_metrics_json` pattern).

### `analytics_conversations` / `analytics_messages`
Sawyer `proposal_messages` pattern. Conversations: `client_id`, `created_by TEXT` (WorkOS user id), `title`. Messages: `conversation_id` FK, `role CHECK IN ('user','assistant')`, `content TEXT`, `tool_calls JSONB DEFAULT '[]'` (audit: name, input summary, source id, duration), `model TEXT`, `tokens_used INT`. Index `(conversation_id, created_at)`.

### `analytics_events` (audit)
Append-only, `onboarding_events` shape: `client_id`, `kind TEXT` (`source.connected|updated|paused|removed`, `sync.completed|failed`, `chat.query`, `export.csv|pdf`, `digest.sent`), `actor TEXT` (admin email / WorkOS user id / `system`), `payload JSONB`. Index `(client_id, created_at DESC)`.

### `analytics_digests`
`herald_digests` shape: `client_id`, `period_start/end`, `metrics_json JSONB`, `html TEXT`, `resend_id TEXT`, `sent_at`.

### Column add
`ALTER TABLE clients ADD COLUMN analytics_digest_enabled BOOLEAN NOT NULL DEFAULT TRUE;` (herald `herald_digest_enabled` precedent; digest additionally requires ≥1 active source, so the default is inert until connection).

No `client_products` change: bundled feature; the portal gates on active sources, not entitlements.

## 3. Credential handling

Per-client third-party keys can't live in env vars (they scale per client), and migration 024 set the precedent of keeping secrets out of plaintext DB rows. Middle path:

- `lib/analytics/crypto.ts`: `encryptSecret`/`decryptSecret` using Node `crypto` AES-256-GCM (random 12-byte IV, auth tag; format `v1:<iv>:<tag>:<ciphertext>` base64) keyed by **`ANALYTICS_SECRET_KEY`** (32 bytes, Vercel encrypted env, documented in `.env.example`). A DB leak alone exposes nothing.
- Credentials are **write-only**: admin UI shows "configured ✓ ····last4" after save, never the value. Decryption happens only server-side at adapter call time.
- Client API keys are entered into the admin form directly (never pasted into chat — Spiro's own credential guidance).

## 4. Provider adapters + MCP client

`lib/analytics/types.ts` defines `MetricRow` and the adapter interface:

```ts
interface ProviderAdapter {
  provider: string;
  testConnection(source: SourceCtx): Promise<Result<ConnectionInfo>>;
  sync(source: SourceCtx, window: SyncWindow): Promise<Result<MetricRow[]>>;   // may be unsupported for generic MCP
  chatTools(source: SourceCtx): Promise<ChatTool[]>;                            // Anthropic tool defs + executors
}
```

All results are the repo-standard `{ok:true,…} | {ok:false, kind, reason}` unions — no cross-module throws.

### `lib/analytics/providers/spiro.ts`
- REST against `api.spiro.media` per its OpenAPI contract; API-key auth from decrypted secret. **All Spiro HTTP in this one file** (retell.ts convention), native fetch, `cache: "no-store"`, lenient JSON parse, status-code mapping.
- `sync`: reporting summaries → metrics `orders.count` / `orders.revenue` at month + week grain, undimensioned plus dimensions `company`, `product`, `status` (top 10 per period; long tail bucketed as `__other__`).
- `chatTools`: curated read-only drill-downs (e.g. `search_orders`, `top_companies`) executed via REST.
- Exact endpoint paths/params come from the OpenAPI document at implementation time; the tool surface of their MCP server (verified today) demonstrates the reporting capabilities exist (`search_spiro_reporting_orders`, `summarize_spiro_reporting_orders` with company/agent/product/status filters).

### `lib/analytics/providers/generic-mcp.ts` + `lib/analytics/mcp.ts`
- New direct dependency **`@modelcontextprotocol/sdk`** (today only transitive via `@anthropic-ai/claude-agent-sdk`; pin compatible with its `^1.29.0`).
- `lib/analytics/mcp.ts` is the single MCP transport module: Streamable HTTP, `Authorization: Bearer <decrypted secret>` (or custom header from config), `initialize` → `tools/list` → `tools/call`, 15s per-call timeout, result-size cap, discriminated-union returns. No retries in v1.
- On connect, discovered tools (name + description + read-only annotation) are shown to admin, who checks which ones chat may use → `chat_tool_allowlist`. Only annotated-read-only/allowlisted tools are ever exposed.
- `sync` is **unsupported** for `generic_mcp` in v1 (returns `{ok:false, kind:'unsupported'}`): arbitrary MCP tools can't be auto-normalized into warehouse metrics. MCP sources power chat; tile metrics come from REST adapters (or future per-provider MCP sync recipes).
- We deliberately run our **own** MCP client (not the Anthropic Messages API MCP connector) so every tool call flows through our loop → complete audit trail, per-client scoping, and no requirement that client servers be reachable from Anthropic's infra.

## 5. Sync pipeline (Inngest)

`lib/inngest/functions/analytics-sync.ts`, cloned from `steward-scheduled`:

- **Triggers:** `[{ cron: "TZ=America/New_York 0 5 * * *" }, { event: "analytics/source.connected" }]` (v4 triggers-array syntax). The event trigger serves both first-connect backfill and the admin **Sync now** button. `concurrency: [{ key: "event.data.clientId", limit: 1 }]` for event runs.
- **Steps:** fetch active sources in one step; then one durable `step.run` per source (`Promise.allSettled`): decrypt → `adapter.sync` with a 60-day overlapping window at day/week grain + month grain for the trailing 13 months (first sync: 24-month month-grain backfill) → upsert metrics → update `last_sync_at`/`last_sync_error` + status (`error` after failure, back to `active` on success). Then **one step per client** (after all of that client's source steps settle): recompute `analytics_snapshots.payload` from the full warehouse + generate insights (§6.1) — one writer per client per run, no snapshot races between same-client sources. Every step emits `analytics_events` + `logEvent`.
- **Registration:** imported and appended to `functions:[]` in `app/api/inngest/route.ts` (silent no-op otherwise).
- **Why Inngest, not vercel.json cron:** Hobby plan allows only daily-or-slower crons and 300s per request; per-source durable steps get independent retries and unbounded total runtime. (Commit 24dae80 already named Inngest as the platform's polling direction.)
- `lib/logger.ts` `Category` union widened with `'analytics'`.
- Snapshot computation is pure code in `lib/analytics/snapshot.ts` (unit-tested): KPI values + deltas, chart series, top-N tables, per-source freshness.

## 6. AI layer (raw `@anthropic-ai/sdk`, no Vercel AI SDK)

Model tiering per repo convention; model IDs pinned as exported consts and persisted with outputs.

### 6.1 Auto insights (post-sync, not page-load)
- Deterministic candidate rules in `lib/analytics/insights.ts`: MoM/YoY movers beyond thresholds, best/worst period in window, mix shifts, anomaly vs trailing mean.
- `claude-sonnet-4-6` turns candidates into 3–5 short narrative cards citing the actual numbers (JSON-only prompt output, fence-strip + validate, safe fallback = no cards). Stored in `analytics_snapshots.insights` with `generated_at` + model.
- Rendered as cards labeled "AI-generated · <date>".

### 6.2 Ask-your-data chat
- `POST /api/portal/analytics/chat` — `export const dynamic = "force-dynamic"`, `export const maxDuration = 300`; SSE via `anthropic.messages.stream` → hand-rolled `ReadableStream` (`data: {token}` / `data: [DONE]`, Sawyer pattern), `cache_control` on the stable system+context block.
- Steward-style manual tool loop, **max 8 iterations**, parallel tool execution, every call audited (message `tool_calls` + `analytics_events` `chat.query`).
- Tools: (1) `query_metrics` — parameterized warehouse queries (metric, grain, period range, dimension filters, top-N group-by); `client_id` injected server-side from session, never model-controlled. (2) Live source tools from adapters/MCP allowlists, namespaced `src_<sourceLabel>_<tool>`.
- Model `claude-sonnet-4-6`; conversation + per-message model/tokens persisted.
- Prompt-injection posture: MCP results are untrusted data (explicit system-prompt guard), read-only tools only, result-size caps.
- Rate limiting: per-client daily cap of 200 chat messages, checked against `analytics_messages` count (DB-based; the in-memory-Map precedent resets per instance and is insufficient for a client-facing surface).
- Auth: `withAuth` + `getPortalClientId`; **clientId never read from the request body** (deliberately not copying the tickets-route gap).

### 6.3 Weekly digest
- `lib/analytics/digest.ts` + its own Inngest function `analytics-digest` (cron trigger, Mondays 9am ET; registered in `functions:[]` alongside `analytics-sync`); eligibility gates: `clients.status = 'active'`, ≥1 active source, `analytics_digest_enabled`.
- Reuses latest snapshot + insights → branded HTML email via Resend to owner + members; all interpolated values HTML-escaped (herald lesson); persisted to `analytics_digests` + `digest.sent` audit event.

## 7. Portal surface — `app/(portal)/analytics/`

- **Routing/auth:** `/analytics` added to `proxy.ts` `config.matcher` (allowlist — omission silently skips AuthKit). Page = async server component: `withAuth` → redirect `/auth/signin?next=/analytics`; `getPortalClientId` → redirect `/auth/no-account`; **no active sources → redirect `/dashboard`** (mark-page gating). Nav tab "Analytics" in `(portal)/layout.tsx` rendered only when the client has ≥1 active source. Params/searchParams awaited (Next 16 Promises).
- **Reads:** the snapshot row (+ conversation list) via `supabaseAdmin`, `.eq('client_id', …)`.
- **Layout:** page-header → KPI `.stat-grid` hero (month revenue, orders, AOV, active customers; MoM deltas, `CounterAnimation`) → charts: 12-month revenue+orders trend (line/area), product mix (bar), status breakdown (donut), top companies + top agents (hand-rolled `.at-*`-style grid rows) → insight cards → freshness line ("Data as of <last sync>" + per-source `StatusPill` health) → chat panel.
- **Chat panel:** colocated `"use client"` island; SSE streaming with the existing `.ds-caret`; history from `analytics_messages`; graceful error/empty states (`EmptyState`, `useToast`).
- **Exports:** `GET /api/portal/analytics/export?format=csv&table=…` streams CSV from the warehouse; `format=pdf` renders a branded snapshot report via `@react-pdf/renderer` (already a dep). Both emit `export.*` audit events.
- **Chart kit:** `components/charts/` — `LineChart`, `BarChart`, `Donut`, `Sparkline`. Server-rendered SVG; colors exclusively semantic `--color-*` tokens (never hex — per-surface contrast-corrected accents); `ds-chart-*` classes in `tokens.css` (shared across surfaces, dark-mode-safe); aria labels + visually-hidden data summaries; `prefers-reduced-motion` respected. Implementation follows the dataviz skill guidance.
- Portal stays light-only (no dark-mode scope creep); admin mirror inherits admin dark mode via tokens.

## 8. Admin surface

- **`AnalyticsManager.tsx`** card on `app/(admin)/clients/[id]/page.tsx` (HollisManager pattern, `"use client"` + optimistic fetch): sources list (kind, provider, label, status, last sync, last error), add/edit/pause/remove, **Test connection** (calls adapter `testConnection` before save), MCP tool-allowlist checklist, **Sync now**, digest toggle, link to mirror.
- **Mirror:** `app/(admin)/clients/[id]/analytics/page.tsx` renders the same shared components from `components/analytics/` fed the same snapshot — pixel-identical to the client view.
- **Routes** (all `requireAdmin()`, params awaited): `app/api/admin/clients/[id]/analytics/sources` (GET/POST), `sources/[sourceId]` (PATCH/DELETE), `sources/[sourceId]/test` (POST), `sync` (POST → Inngest event), `digest` (PATCH).

## 9. Security & audit

1. **Tenant isolation is manual** (all tables deny-all RLS; everything runs as service role): every read/write filters `.eq('client_id', …)` where `client_id` comes from `getPortalClientId` (portal) or the route param under `requireAdmin` (admin). Chat/export handlers never accept a client id from the body. This is the platform's #1 stated bug source — implementation plan must include a cross-tenant test.
2. **Credentials:** AES-256-GCM at rest, write-only UI, env-held key (§3).
3. **Audit trail:** `analytics_events` rows for every source change, sync, AI query, export, digest; plus `logEvent` category `'analytics'`. WorkOS Audit Logs mirroring deferred (schema-registration operational blocker noted from Phase B).
4. **MCP hygiene:** read-only allowlisted tools only, untrusted-content prompt guard, size caps, 15s timeouts, our own client (full call visibility).
5. **Fail-soft rendering:** a down source or missing snapshot never breaks the page (rowsOf/countOf posture) — show stale data + health badge instead.

## 10. Testing

`node --test` via tsx (`npm test`) + `npm run typecheck`, logic in `lib/analytics/` pure and unit-tested; route handlers thin:

- crypto: encrypt/decrypt roundtrip, tamper detection (auth tag), bad-key failure
- spiro adapter: recorded fixture payloads → MetricRow normalization (incl. dimension_key canonicalization, `__other__` bucketing)
- snapshot: metrics → payload (KPIs, deltas, series, top-N) — golden-file style
- insights: candidate rules on synthetic series (movers, anomalies, empty data)
- MCP bridge: MCP tool schema → Anthropic tool def; allowlist enforcement; oversized-result truncation
- chat loop: tool-call audit recording, iteration cap, client_id injection (mocked Anthropic)
- digest: eligibility gates, HTML escaping
- CSV serialization edge cases

## 11. Rollout (Elevated Productions)

1. Apply `032_analytics.sql` to prod (manual, per convention).
2. Set `ANALYTICS_SECRET_KEY` in Vercel env (+ `.env.example` entry).
3. Deploy (Inngest functions self-register on deploy).
4. Obtain Spiro API key from the client's Spiro account; enter via admin add-source form (test connection → save).
5. First sync backfills 24 months; verify tiles against known-good numbers (June 2026: 286 orders / $100,054.30; Sep 2025 peak: 507 / $152,925; FY total ≈ $1.47M / 4,579 orders).
6. Optionally add their MCP server as a second `generic_mcp` source for chat if a headless (API-key/bearer) MCP auth mode exists; not a launch dependency.
7. Enable/confirm weekly digest.

## 12. Out of scope (v1)

- Role-gated analytics access (owner decision: all client members see it; helpers exist for later)
- Sync recipes for generic MCP sources (chat-only in v1)
- WorkOS Audit Logs mirroring (operational schema registration pending)
- Portal dark mode; additional provider adapters (Stripe etc.); Sawyer/marketing packaging (not a sellable product)
- Redis-backed rate limiting (DB count cap suffices at current scale)

## 13. Design decisions log

| Question | Decision |
|---|---|
| Audience/placement | Client portal + admin mirror |
| AI meaning | Chat + auto insights + weekly digests (all three) |
| Data architecture | Hybrid: REST sync → warehouse for tiles; MCP for chat drill-down |
| Enterprise launch scope | CSV+PDF exports, audit trail, multi-source day one; role-gating deferred |
| Product framing | Bundled platform feature; activation = connecting a source; no client_products change |
| Approach | A: warehouse + live AI, in-house SVG charts (vs live-query-only; vs chart dependency) |
