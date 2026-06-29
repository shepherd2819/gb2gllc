# WorkOS Integration Cheatsheet — GB2G Phase B (Enterprise Identity)

> Confirmed 2026-06-29 from a 6-agent WorkOS doc-lookup workflow. Stack: Next.js 16, `@workos-inc/authkit-nextjs` (~v4.1), `@workos-inc/node` (~v9.3). Client = `getWorkOS()` (lazy singleton; never `new WorkOS()`). Session = `withAuth()`. Namespaces: `workos.organizations`, `workos.userManagement`, `workos.webhooks`, `workos.adminPortal` (NOT `workos.portal`), `workos.auditLogs`.

## 1. Organizations (one per client)
- Create: `workos.organizations.createOrganization({ name, domainData?: [{domain,state}], externalId?, metadata? })` → `org.id` (`org_…`).
- Reverse lookup by our id: `workos.organizations.getOrganizationByExternalId(externalId)` (throws on 404 — catch).
- Get/list: `getOrganization(id)`, `listOrganizations({ domains?: string[], limit })`.
- Update: `updateOrganization({ organization: 'org_…', ... })` — **key is `organization`, not `id`**.
- Membership: `workos.userManagement.createOrganizationMembership({ organizationId, userId, roleSlug })` (re-activates an inactive membership; no dup). `updateOrganizationMembership('om_…', { roleSlug })`, `deleteOrganizationMembership('om_…')`.
- Invitation: `workos.userManagement.sendInvitation({ email, organizationId?, roleSlug?, inviterUserId? })` — role applied on acceptance; `roleSlug` ignored if no `organizationId`.
- Gotchas: `domainData` (create/update) vs `domains` (list filter); `roleSlug` XOR `roleSlugs`; pass camelCase.

## 2. Directory Sync (SCIM) webhook
- Verify: `await workos.webhooks.constructEvent({ payload: rawBody, sigHeader, secret: WORKOS_WEBHOOK_SECRET })` — **async**, raw `req.text()` (never `req.json()` first), header `workos-signature`, throws `SignatureVerificationException` (from `@workos-inc/node`). Secret is per-endpoint, NOT the API key. Default tolerance 180s.
- Events: `dsync.user.created|updated|deleted`, `dsync.group.created|updated|deleted`, `dsync.group.user_added|user_removed`, `dsync.activated`, `dsync.deleted`.
- Payload snake_case (`DirectoryUserResponse`): `{ id, directory_id, organization_id (nullable!), idp_id, email (SINGULAR string|null), first_name, last_name, state ('active'|'inactive'), role, roles }`. `group.user_added/removed` carry inline `{ directory_id, user, group }`.
- The route lives under `/api/*` which is excluded from `proxy.ts` matcher → not auth-gated (correct, machine-to-machine).

## 3. RBAC / roles via AuthKit
- `withAuth()` → `{ user, sessionId, organizationId?, role?, roles?, permissions?, entitlements?, featureFlags?, accessToken }` (decoded JWT, no network). `role`/`permissions` are **undefined without an org context** — narrow first.
- Gate: `if (!permissions?.includes('slug')) …`. Fresh claims after a role change: `refreshSession({ organizationId })`.
- GB2G's portal layout/auth currently destructure only `{ user }` — extend to pull `role`/`permissions`.

## 4. Admin Portal (self-serve)
- `await workos.adminPortal.generateLink({ organization: 'org_…', intent, returnUrl?, successUrl? })` → `{ link }`. Link valid **5 min** — generate on demand, redirect immediately, never store/email.
- Intents: `'sso'`, `'dsync'`, `'audit_logs'`, `'log_streams'`, `'domain_verification'`, `'certificate_renewal'`, `'bring_your_own_key'`. Org must exist first (404 otherwise). `returnUrl`/`successUrl` must be HTTPS + registered in Dashboard Redirects.

## 5. Audit Logs (outbound only)
- `await workos.auditLogs.createEvent(orgId, { action, occurredAt: new Date(), actor: {id,type}, targets: [{id,type}], context: {location}, metadata? })` → `void`. **camelCase** `occurredAt`. `metadata` scalars only (≤50 keys). Optional 3rd arg `{ idempotencyKey }`.
- Every `action` MUST be pre-registered (Dashboard or `createSchema`) or HTTP 422. No webhooks (outbound only).

## Dashboard prerequisites (operator — BLOCK the code)
1. **Roles & permissions** (Authorization): define every `roleSlug` (`owner`/`admin`/`member`/`billing`/`read_only`) + permission slugs.
2. **Audit-log schemas**: pre-register every `action` string we emit (else 422); Audit Logs product active on plan.
3. **Webhook endpoint**: register `/api/webhooks/workos`, subscribe to `dsync.*`, copy per-endpoint Secret → `WORKOS_WEBHOOK_SECRET`.
4. **Directory connections** (per client, via Admin Portal `intent:'dsync'`): created + activated before `dsync.*` events fire.
5. **Redirect URIs**: register every `returnUrl`/`successUrl`.
6. **Env:** `WORKOS_API_KEY` (exists) + add `WORKOS_WEBHOOK_SECRET`.

## What GB2G builds (maps to files)
- **B1** finish `lib/onboarding/provision.ts` `ensureWorkosOrg` (find-or-create org by externalId=clientId, store `clients.workos_org_id`); `sendPortalInvite` passes `organizationId`+`roleSlug`. Backfill route for existing clients.
- **B2** `app/api/webhooks/workos/route.ts` (verify + handle `dsync.*` → `client_members`).
- **B3** extend `app/(portal)/layout.tsx` / `lib/portal-auth.ts` / `lib/admin-auth.ts` to read `role`/`permissions`; tier-driven seat caps replacing `MAX_TEAMMATES`.
- **B4** Admin Portal link route + surface (needs `workos_org_id`).
- **B5** wire `lib/onboarding/audit.ts` → `workos.auditLogs.createEvent` (org-scoped, scalars-only metadata, never-throw).
