# Elevated Productions — Spiro → HubSpot Order Attribution Sync — Design Spec

**Date:** 2026-07-15
**Status:** Approved design, pending implementation plan
**Owner decision summary:** A daily backend sync that reads client **Elevated Productions**'s Spiro orders and attributes each one to the matching **existing** HubSpot contact (by email), landing on Elevated's already-configured **"Orders" custom object** (an "Associated Orders" panel already exists — empty — on their HubSpot contact records). Forward-only from a go-live cutoff date, no backfill. No contact auto-creation, no notification on unmatched orders — an order with no matching contact is simply skipped and logged locally. Auth via a HubSpot **Private App token** (not OAuth). No persona/agent name — this is plain backend plumbing, configured as a small section on Elevated's existing admin page. No Spiro webhook exists (verified: Spiro's public API/MCP surface is fully read-only, no webhook resource found anywhere) — daily poll confirmed as sufficient latency.

---

## 1. What we're building

A one-way, one-client (Elevated Productions) sync pipeline:

**Spiro (orders) → match to existing HubSpot contact (by email) → upsert onto HubSpot's "Orders" custom object → associate to the contact.**

No new voice/chat/persona surface. No Spiro writes (impossible — Spiro's API is read-only for orders, per the existing Hollis order-desk spec). No new HubSpot contacts created. Runs once a day; a manual "Sync now" is available from admin.

---

## 2. Access & feasibility

- **Spiro**: read-only REST, already integrated for Elevated (`client_data_sources`, `provider='spiro'`, reused by both the analytics build and Hollis's order desk). The analytics adapter (`lib/analytics/providers/spiro.ts`) already supports `GET /api/v1/orders?filter[dateSubmitted][gte]=...` — exactly the "orders since date X" query this sync needs. Order list rows include `client.{agentId,agentName,companyName}` but not email; email comes from the Agents endpoint (`GET /api/v1/agents?filter[agentId][eq]=<id>` → `contact.emailAddress`), same lookup Hollis's `lib/hollis/spiro.ts` already performs by phone/email — this sync adds a by-id lookup, cached per run so an agent with many orders in one batch is only fetched once.
- **HubSpot**: no existing integration in this repo (only a placeholder `steward_platform_agents` capability listing, never implemented). Net-new: a Private App token (scopes: read contacts, read/write the custom "Orders" object and its associations), stored the same way as the Spiro key — `client_data_sources`, `kind='rest'`, `provider='hubspot'`, `secret_enc`.
- **The "Orders" custom object already exists** in Elevated's HubSpot portal, associated to Contacts (confirmed by you — the "Associated Orders" panel visible on a contact today, currently empty). Its exact internal object name, property list, and association type are **not yet known** to us and will be introspected via HubSpot's schema API (`GET /crm/v4/schemas/{objectType}`, `GET /crm/v4/associations/{objectType}/contacts/labels`) once we have the token — this is a build-time step, not a design blocker.
- **No Spiro webhook** — checked: the full public OpenAPI (`/swagger/v1/swagger.json`) and the 40-tool MCP surface (all `get_`/`search_`/`summarize_`) show no webhook/subscription resource of any kind. This sync is poll-only. You confirmed daily latency is fine, so this isn't a gap in practice.

---

## 3. Sync flow

1. Daily Inngest function `hubspot-order-sync.ts` — cron `TZ=America/New_York 0 6 * * *` (staggered an hour after the existing `analytics-sync` 5am run to avoid both hammering Spiro at once) **plus** an event trigger `crm/hubspot.sync_requested` (fired by an admin "Sync now" button, scoped to one `clientId`). Concurrency keyed on `clientId`, limit 1 — matches `analytics-sync.ts` exactly.
2. Load active `client_data_sources` rows where `provider='hubspot'` (scoped to `event.data.clientId` for an event run, all clients for a cron run — today that's just Elevated, but this isn't Elevated-specific code).
3. Per HubSpot source, in its own `step.run` (so one client's failure never blocks another's — `Promise.allSettled`, same isolation pattern as `analytics-sync.ts`):
   a. Decrypt the HubSpot token. Load the paired Spiro source via `config.spiro_source_id` and decrypt its key.
   b. Determine the sync window: `since = last_sync_at ?? config.cutoff_date`.
   c. Fetch Spiro orders with `dateSubmitted >= since` (paginated, `pageSize` max 200 per the Spiro contract).
   d. For each order: resolve the agent's email (cached by `agentId` within the run). Skip (see §4) if no email or no confident contact match. Otherwise upsert + associate (see §5), then upsert the local `hubspot_order_syncs` row.
   e. On completion, update the HubSpot source's `last_sync_at`/`last_sync_error` (reusing the existing `client_data_sources` checkpoint columns — no separate cursor table needed for the checkpoint itself).
4. **No backfill, structurally enforced** — the Spiro query itself never asks for orders before `cutoff_date`; there's no code path that could accidentally reach further back.

---

## 4. Contact matching

- **Match key: exact email**, Spiro agent's `contact.emailAddress` against HubSpot `contacts` via `POST /crm/v3/objects/contacts/search` (email filter, `EQ`).
- **Zero matches** → skip. Record `hubspot_order_syncs` with `match_status='unmatched'`. No HubSpot writes, no contact creation, no notification — per your call, only orders whose agent is already a HubSpot contact get attributed.
- **More than one contact shares that email** → also treated as unmatched (logged with a note), rather than guessing which one is "right." This is a deliberate safety choice: an ambiguous match is worse than a skipped one.
- **Exactly one match** → proceed to write (§5).
- No name/phone fuzzy matching in v1 — email is the one reliable key HubSpot contacts are built around, and it keeps the matching logic simple and auditable.

---

## 5. HubSpot write layer

- **Upsert, not create-then-check.** HubSpot's Custom Object API supports upsert-by-external-id: `PATCH /crm/v3/objects/{objectType}/{idValue}?idProperty=<property>`. We add a `spiro_order_id` property to the existing "Orders" object at build time (a property addition, not a schema rebuild — compatible with "the object already exists") and key every upsert on it. Re-syncing an order whose status changed (e.g. `confirmed` → `delivered`) updates the same HubSpot record instead of duplicating it.
- **Field set** (defaults — "simple details," confirmed/adjusted once the real property list is introspected): tracking code, status, date submitted, formatted address, package/media title, photographer name, scheduled appointment date/window. Explicitly excluded: pricing/fees, media download links, internal notes — this mirrors the Hollis order-desk read-minimization stance even though the audience here is internal (Elevated's own HubSpot), not a caller.
- **Association**: after upsert, `PUT /crm/v4/objects/{objectType}/{objectId}/associations/{contactObjectType}/{contactId}` using whichever association type/label ID backs the existing "Associated Orders" panel (introspected, §2) — not HubSpot's generic default association, since the label already exists and presumably has a specific type ID.
- **Idempotency backstop**: before writing, check the local `hubspot_order_syncs` row for that `(source_id, spiro_order_id)` — if `spiro_status` is unchanged since the last successful sync, skip the HubSpot call entirely (saves API calls; HubSpot's upsert would be a no-op anyway, but this avoids the round-trip).

---

## 6. Data model — migration `035_hubspot_order_sync.sql`

Next free number is **035** (`034_hollis_order_desk.sql` exists). Standard boxed-comment header + RLS `ENABLE` + `CREATE POLICY "service role only" ... FOR ALL USING (false)` per convention; all access via `supabaseAdmin` filtered by `client_id`.

**No schema change to `client_data_sources`.** A `provider='hubspot'` row's `config` JSONB carries the sync-specific wiring:
```
{
  "spiro_source_id": "<uuid of the paired provider='spiro' row>",
  "hubspot_object_type": "<introspected internal name, e.g. '2-xxxxx' or a named schema>",
  "hubspot_id_property": "spiro_order_id",
  "cutoff_date": "2026-07-15"
}
```
Its existing `last_sync_at` / `last_sync_error` columns are this job's checkpoint — no new cursor field.

### New table `hubspot_order_syncs`

| column | type | notes |
|---|---|---|
| `id` | `UUID PK DEFAULT gen_random_uuid()` | |
| `client_id` | `UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE` | |
| `source_id` | `UUID NOT NULL REFERENCES client_data_sources(id) ON DELETE CASCADE` | the `provider='hubspot'` row |
| `spiro_order_id` | `TEXT NOT NULL` | |
| `spiro_status` | `TEXT` | order status as of last sync — drives the idempotency skip |
| `hubspot_object_id` | `TEXT` | null when unmatched |
| `hubspot_contact_id` | `TEXT` | null when unmatched |
| `match_status` | `TEXT CHECK IN ('matched','unmatched')` | |
| `synced_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |
| `error` | `TEXT` | e.g. "multiple contacts matched" |

`UNIQUE (source_id, spiro_order_id)`. Index `(client_id, synced_at DESC)`.

---

## 7. Admin & config

- **`AnalyticsManager.tsx`**'s existing "Add a source" form gains a `hubspot` provider entry (`kind: 'rest'`) — a token paste field only (HubSpot's API base is fixed, no URL to configure). This reuses all existing add/list/remove-source plumbing; no new credential-entry UI to build.
- **New small panel — "HubSpot Order Sync"** (own component, rendered on the client admin page once a `provider='hubspot'` source exists): a picker for which `provider='spiro'` source to pull from, the go-live cutoff date (set once, editable only before first sync), last-sync time/status, matched/unmatched counts from `hubspot_order_syncs`, and a "Sync now" button that fires `crm/hubspot.sync_requested`.
- **New route** `app/api/admin/clients/[id]/hubspot-sync/route.ts` — `PATCH` to save the pairing/cutoff into `client_data_sources.config`, `POST` to trigger the manual-sync event.

---

## 8. Error handling & edge cases

| Case | Behavior |
|---|---|
| Spiro 401/403/5xx/timeout | Mark `last_sync_error` on the HubSpot source row; this client's step fails, others proceed (`Promise.allSettled`). |
| HubSpot 401 (bad/revoked token) | Same — surfaced as an error banner in the new admin panel. |
| HubSpot 429 (rate limit) | Rely on Inngest's built-in step retry/backoff — no custom rate limiter needed at this volume (one client, daily batch). |
| Agent has no email on file in Spiro | Unmatched, logged, skipped. |
| Zero or >1 HubSpot contact for that email | Unmatched, logged (see §4) — never guesses. |
| Order status changes after a prior sync (e.g. reaches `delivered`) | Upserted again via the same `spiro_order_id` key — updates in place, no duplicate record. |
| Client has no `spiro_source_id` paired yet | Step no-ops with a clear `last_sync_error` ("no Spiro source configured") rather than crashing. |

---

## 9. Reused vs. net-new

- **Reused**: `client_data_sources` + `lib/analytics/crypto.ts` encryption; the Spiro `dateSubmitted` incremental-query pattern (`lib/analytics/providers/spiro.ts`); agent-by-id email lookup pattern (`lib/hollis/spiro.ts`); the `analytics-sync.ts` Inngest shape (cron + event dual-trigger, per-source `Promise.allSettled` isolation, `clientId`-keyed concurrency); `AnalyticsManager.tsx`'s add-source form.
- **Net-new**: `lib/inngest/functions/hubspot-order-sync.ts`; a small HubSpot REST client (contact search, custom-object upsert, association write, schema introspection) — no existing module owns HubSpot; migration `035` (`hubspot_order_syncs` table); the "HubSpot Order Sync" admin panel + its API route; a `spiro_order_id` property added to the existing "Orders" custom object in HubSpot itself (a one-time manual or scripted schema change, not a new object).

---

## 10. Testing

Pure unit tests (existing `node --test` + `tsx` convention, mocked `fetch`, no live API needed):
- Agent-email resolution + per-run caching.
- Contact-match logic: 0 results, 1 result, >1 results.
- Upsert payload construction (Spiro order → HubSpot properties mapping).
- Idempotency skip (unchanged `spiro_status` → no HubSpot call).
- Association-write call shape.

Orchestration test with a mock ctx: no HubSpot sources configured (no-op), one client happy path (matched + unmatched orders in the same batch), Spiro failure isolated to one client, HubSpot failure isolated to one client.

No live HubSpot/Spiro needed for any of the above. A real "Sync now" against Elevated's actual portal, after the token is provisioned, is the operator-time smoke test (same convention as Hollis's Retell smoke test).

---

## 11. Out of scope / future

- **Contact auto-creation** for unmatched orders — explicitly rejected; revisit only if Elevated asks for it later.
- **Notifications on unmatched orders** (Slack/email) — explicitly rejected; the admin panel's unmatched count is the only visibility in v1.
- **Spiro webhook** — no such capability currently exists on Spiro's platform; if Spiro's team ever adds one, this becomes a fast-follow (swap the cron trigger for a webhook-driven event; matching/write logic is unchanged) rather than a redesign.
- **Phone/name fuzzy matching** as a fallback when email doesn't match — not built in v1.
- **Multi-client generalization** — this is written client-agnostically (any `provider='hubspot'` source works), but Elevated is the only client wiring it up today.

---

## Config-level items (confirmed 2026-07-15)

- **Object**: existing "Orders" custom object, already associated to Contacts — schema details introspected at build time.
- **Auth**: HubSpot Private App token (not OAuth).
- **Unmatched handling**: skip silently, log locally only.
- **Frequency**: daily.
- **Naming**: no persona/agent name — plain "HubSpot Order Sync" section on the existing admin page.
- **Scope**: forward-only from a go-live cutoff date; no backfill.

**Still open (answer at plan/build time — none block the plan):**
1. Exact HubSpot Private App scopes needed (confirm once we draft the token in HubSpot's UI).
2. Exact cutoff date/time for go-live (defaults to the day this ships, editable once before first sync).
3. Final property list on the "Orders" object once introspected — may add/drop from the §5 default set.
