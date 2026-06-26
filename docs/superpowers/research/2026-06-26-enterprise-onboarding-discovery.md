# GB2G Enterprise Client Onboarding — Discovery Brief

> Produced 2026-06-26 from a 7-agent discovery workflow (3 mapped the existing repo, 3 researched enterprise best practices, 1 synthesis).
> Owner direction (2026-06-26): all four pillars in scope (experience + identity + trust + automated provisioning); **hybrid** (self-serve + white-glove); clients = **SMB now, enterprise-ready**; #1 goal = **win bigger deals**.

## 1. Where GB2G is today

The current path is **polished at the front, manual at the seams, and disconnected at the back.**

**Intake (excellent).** A prospect hits `app/intake/page.tsx` → `POST /api/intake/new` mints `sess_…` (stored in `intake_sessions`, migration `001`, 30-day expiry) → `/intake/[sessionId]` serves static `public/intake.html` + `intake-app.js` (two-path: AI brain-dump via Claude Sonnet in `lib/intake/braindump.ts`, or 8-stage structured). Autosaves; file uploads via pre-signed Supabase Storage URLs. The strongest piece of the stack.

**Submit (partial handoff).** `POST /api/intake/[sessionId]/submit` creates a Notion packet, stamps `submitted_at`/`notion_page_id`, upserts a `clients` row. It does **not** send a portal invite, fire an event, or email the prospect. Notion creation is synchronous in the handler.

**Client → invite (manual).** John opens `/submissions`, clicks Convert → `POST /api/admin/submissions/[id]/convert` → upsert client + `workos.userManagement.sendInvitation`. First sign-in backfills `workos_user_id` by email. Auth = WorkOS AuthKit throughout; `lib/admin-auth.ts` = single hardcoded `ADMIN_EMAIL`.

**Contract / payment / activation (three disconnected islands).**
- **Contract (Vera):** `/api/sign/[token]` flips `contracts.status='signed'` (migration `026`); `after()` does PDF/Notion/email/Slack. Holds `product`/`amount_cents`/`cadence` but triggers **no** invoice, product row, or invite.
- **Payment (Stripe):** `/api/admin/billing` manually creates+finalizes invoices. `invoices.paid_at` exists but is **never written** — the Stripe webhook is Nora-only (AR/dunning), doesn't handle `invoice.payment_succeeded` for provisioning.
- **Activation:** `/api/admin/clients/[id]/products` manually toggles `client_products` (herald/atrium/steward only — no `custom`). Toggling has no portal-side effect; portal renders all sections regardless. `clients.status` does **not** gate portal access.

**Net:** Intake is automated and slick; everything after "submit" is manual admin clicks with no connecting tissue. Inngest exists but touches none of it. ~13 named agents already in `lib/<name>/`.

## 2. What "enterprise-grade onboarding" means

- **(a) Experience/process.** ACV-segmented (self-serve <$5K, assisted $5–25K, white-glove >$25K), one validated "aha moment," a ~14-day time-to-value gate, a shared per-client onboarding workspace with phase-gated milestones + named owners, kickoff within 48–72h of signing. For GB2G, activation = "first agent does real work."
- **(b) Identity & access.** A WorkOS **Organization per client**, SSO/SAML, SCIM auto-provision/deprovision, JIT + domain capture, RBAC roles in the JWT (owner/member/billing/read-only), self-serve Admin Portal for client IT. Replaces today's email-invite-only, binary owner-vs-teammate, 1-seat cap.
- **(c) Trust/security/compliance.** SOC 2 Type II (6-month observation — clock should start now), click-to-sign DPA + subprocessor list, a trust center (Vanta/Drata/SafeBase), MSA + Order Form + SLA, immutable audit logs, documented retention/deletion. Mostly documentation + certification, not architecture.
- **(d) Automated provisioning.** One event-driven sequence: contract signed → invoice → payment confirmed → product/agent activated → org + invite created → kickoff scheduled → welcome sent. Idempotent, retryable, audited. The layer GB2G is missing entirely.

## 3. The WorkOS leverage

GB2G already pays for AuthKit, so most enterprise IAM is config, not code.

| Get nearly for free (config/SDK) | Must build in-app |
|---|---|
| **SSO/SAML** auto-routing by domain | Per-client SSO enforcement policy UI |
| **Directory Sync / SCIM** provision + deprovision | Webhook handler → upsert/deactivate `client_members` |
| **Admin Portal** (client IT self-configures SSO/SCIM) | Generate + embed the scoped portal link per org |
| **Organizations** = multi-tenant anchor | `clients.workos_org_id` column + create-on-provision |
| **RBAC** roles in session JWT | `role` on `client_members`; permission checks at API layer |
| **Audit Logs** immutable | Define event schemas; emit on key actions |
| **JIT + Domain Capture** | Org-selection picker for multi-org users |

The gap is almost entirely "WorkOS features paid for but not wired up." No Organizations exist yet — which blocks SSO/SCIM/Admin Portal/Audit Logs downstream.

## 4. Gap analysis

| Capability | Have today | Enterprise-grade target | Effort |
|---|---|---|---|
| Intake form | Polished two-path AI form | Keep; feed into onboarding state machine | S |
| Post-submit handoff | Manual Convert click | Auto invite + provision on submit/sign | M |
| Onboarding state/milestones | None (`atrium_progress` only) | Per-client workspace + checklist | L |
| Sign→bill→activate wiring | 3 disconnected islands | One Inngest sequence | L |
| `invoices.paid_at` reconciliation | Never written | Stripe `invoice.payment_succeeded` → mark paid → activate | S |
| Product activation effect | Display-only toggle | Drives portal gating + agent provisioning | M |
| Portal gating on status/products | None | `disabled`/`paused` block access; products gate sections | S |
| WorkOS Organizations | None | One org per client | M |
| SSO/SAML | None | Per-org via Admin Portal | M |
| SCIM / deprovisioning | Manual | WorkOS Directory Sync webhook | M |
| RBAC roles | Binary owner/teammate in code | WorkOS roles in JWT + `role` column | M |
| Teams / seat cap | Hardcoded `MAX_TEAMMATES=1` | Plan-tier-driven seat limits | S |
| Audit logging | None | WorkOS Audit Logs on key events | M |
| Kickoff (Calendly) | URIs captured, never consumed | Webhook → milestone | S |
| DPA/subprocessors/SLA/trust center | `data-deletion` page only | Published legal stack + trust center | M (mostly non-eng) |
| SOC 2 Type II | None | 6-month observation → audit | L (external) |
| Prospect welcome email | None | Automated on submit/activation | S |

## 5. Recommended architecture

Treat this as **platform infrastructure with a thin agent face.** Orchestration (sign→bill→provision→invite) is infra in `lib/onboarding/`; the client-facing concierge that nudges milestones + tracks TTV reuses the existing Herald SSE assistant pattern rather than standing up a heavy 14th agent. Working name: **Onboard**.

**Data model (migration `029_onboarding.sql`):**
- `onboarding_journeys` — `id, client_id FK, stage (invited→kickoff_scheduled→provisioning→activated→adopted→complete), template, ttv_target_at, activated_at`. The state-machine spine.
- `onboarding_milestones` — `id, journey_id FK, key, title, owner (client|gb2g), status (pending|in_progress|done|blocked), due_at, completed_at`. The shared checklist.
- `onboarding_events` — append-only audit of transitions (mirrors WorkOS Audit Logs).
- Column adds: `clients.workos_org_id`, `client_members.role`, `contracts.stripe_invoice_id`, widen `client_products` CHECK to include `custom`.

**Routes / modules:**
- `lib/onboarding/` — `journey.ts` (state machine), `provision.ts` (org create, product activation, invite), `milestones.ts`, `templates.ts`.
- `lib/inngest/functions/` — `contract-signed`, `invoice-paid`, `client-provisioned`. The sign route's `after()` + Stripe webhook emit Inngest events instead of working inline.
- Portal: `app/(portal)/onboarding/page.tsx` (client workspace). Admin: `app/(admin)/onboarding/` (journey overview, stuck accounts, TTV dashboard).
- `app/api/webhooks/workos/route.ts` (SCIM/membership), `app/api/webhooks/calendly/route.ts` (kickoff → milestone).

**The automated sequence (Inngest):** `contract.signed` → ensure Stripe invoice → on `invoice.payment_succeeded` write `paid_at` + emit `invoice.paid` → `provision.ts`: create WorkOS Organization + set `workos_org_id`, upsert `client_products` from contract, configure agent, idempotent WorkOS invite, seed journey + milestones → schedule kickoff → welcome email. Every step idempotent, emitting `onboarding_events` + WorkOS Audit Logs.

This also lets GB2G finally land the approved-but-unbuilt Herald intake-link spec as the first journey template.

## 6. Three scoped options (sequence them)

- **Option A — Polished self-serve wizard (M, ~2–3 wks).** `029` migration, `app/(portal)/onboarding`, Inngest `contract-signed`/`invoice-paid`, write `invoices.paid_at`, auto-invite on submit/sign, portal gating on `status` + `client_products`, welcome email, Calendly→milestone, Herald concierge nudges. Kills manual clicks, gives every client a tracked TTV path. **Build first — highest leverage, no external deps.**
- **Option B — Enterprise identity + trust (M–L, ~3–4 wks eng + parallel non-eng).** WorkOS Organizations per client, SSO via Admin Portal, SCIM webhook + deprovisioning, RBAC roles in JWT + `client_members.role`, tier-driven seat caps, Audit Logs. Parallel non-eng: publish DPA/subprocessors/SLA/MSA, stand up Vanta/Drata trust center, **start the SOC 2 Type II 6-month clock.** Unlocks the ability to *close* enterprise deals. **Build second; start the non-eng/SOC 2 track immediately, in parallel with A.**
- **Option C — Fully automated provisioning pipeline (L, ~2–3 wks, depends on A+B).** The complete idempotent Inngest sequence + admin TTV/stuck-account dashboard + `custom` product + `contracts.stripe_invoice_id`. Zero-touch onboarding at scale. **Build third — stitches A's state machine and B's org/identity into one pipeline.**

**Sequence:** A (now) ∥ B-non-eng track (start SOC 2 clock + publish DPA today, near-zero cost) → B-eng → C.

## 7. Key decisions for the owner

1. **Concierge agent vs pure infra?** Rec: infra in `lib/onboarding/` + reuse Herald's SSE assistant — don't stand up a heavy 14th agent.
2. **Provisioning trigger: contract-signed or payment-confirmed?** Rec: invite + read-only portal on `signed`, full agent activation on `paid`.
3. **One WorkOS Organization per client now, or only enterprise tier?** Rec: org-for-all (foundation for everything); SSO/SCIM only when a client requests it.
4. **Seat cap as a real plan/tier model** vs the `MAX_TEAMMATES` constant — needed before B.
5. **SOC 2 timing.** The 6-month observation window means deferring the start directly delays your first enterprise close.
6. **Build vs buy the workspace UX.** Rec: native `app/(portal)/onboarding` (in-stack, integrates with agents).

## 8. Open risks

- **Synchronous Notion creation** in submit can time out → move to Inngest.
- **In-memory Herald rate limiter** resets on restart / breaks across instances → move to Supabase/Redis. (Same pattern fixed in the Hollis demo via the `hollis_demo_calls` table.)
- **Brain-dump field drift** between structured tasks and extraction → shared source of truth.
- **No portal gating on `status`** → a `disabled` client can still sign in; close before SOC 2.
- **Idempotency is the hard part of C** — double-charge/duplicate-org/duplicate-invite on retries. Every Inngest step keyed + guarded (model: the convert route's re-fetch-after-ignoreDuplicates).
- **WorkOS Organization backfill** for existing clients.
- **`custom` product mismatch** (contracts have 4 values, `client_products` 3) silently drops activation until the CHECK is widened.
- **DPA/subprocessor absence blocks EU deals today** — zero-cost to fix.
