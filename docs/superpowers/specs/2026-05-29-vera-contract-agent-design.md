# Vera — Client Contract Generation & Signing Agent

- **Date:** 2026-05-29
- **Status:** Approved, ready for implementation plan
- **Author:** John (jmccully@8brands.com), design partnered with Claude

## Summary

Vera is an internal, admin-only agent that generates and signs client services contracts on behalf of GB2GLLC.

- From any client page in admin, John clicks **Generate Contract**, picks product + amount + cadence + optional scope notes, and Vera handles the rest.
- Vera loads the master template from Notion, substitutes client + engagement variables, renders a PDF, and emails the client a magic-link to a public signing page on `gb2gllc.com/sign/<token>`.
- The client reads the contract inline, types their full name + the company they're representing, checks "I have authority to sign," and clicks Sign.
- Vera bakes the typed signature into a countersigned PDF, stores it in Supabase Storage and a new "GB2GLLC Contracts" Notion database (linked back to the client's intake page), and notifies John three ways: email, Slack, admin badge.
- Day 3 auto-reminder; day 14 link expiry. John can void at any time.

Only the client signs. GB2GLLC's side is pre-signed by the template ("John McCully · Founder · Oberon Analytics LLC d/b/a GB2GLLC · {{generated_date}}"). The contract is fully executed when the client signs.

## Design notes (why this shape)

### Why an internal agent, not a third-party service
DocuSign/HelloSign would solve signing but cost $20–50/mo, lock the source-of-truth template inside their UI, and introduce a separate audit trail outside the GB2G admin. Building it in-house is ~2 days, keeps the template editable in Notion, keeps every contract visible in the same Notion DB as client intake, and reuses libraries we already own (`@react-pdf/renderer` from June, Notion client, Resend, Supabase Storage). E-SIGN/UETA compliance is achieved with the standard pattern: clear disclosure that this is electronic, typed signature with intent ("I have authority…"), IP + user-agent + timestamp capture in the row.

### Why only the client signs
For templated agreements at this scale, the pre-signed-by-template pattern is industry standard (Stripe TOS, every SaaS MSA you've ever clicked) and removes the "awaiting countersignature" dead state. John's signature is baked into the template; the contract is fully executed the moment the client signs. If a contract ever needs a real wet countersign for legal reasons, John can void this one and execute a one-off paper agreement.

### Why a hosted signing page (not PDF round-trip)
"Email a PDF, sign in Preview, email back" feels old, breaks on phones, and forces John into a manual "find the signed PDF in Wren and upload to Notion" loop. A hosted page on `gb2gllc.com/sign/<token>` is one click on any device, captures the audit trail automatically, and keeps the experience "simple, not scary."

### Why the master template lives in Notion
John can edit the template directly in Notion without a code change — important for v1 since the legal copy will iterate. The renderer falls back to bundled defaults if Notion is unreachable or a section is missing, so editing Notion can't break contract generation. The PDF layout itself stays in code (React-PDF component), so styling stays consistent regardless of how Notion is edited.

### Why the legal entity is Oberon Analytics LLC d/b/a GB2GLLC
GB2GLLC operates under Oberon Analytics LLC, a South Carolina LLC. The contract names Oberon Analytics LLC as the contracting party with GB2GLLC as the trade name. Governing law: South Carolina.

### Out of scope for v1
- Multiple template variants per product (one master template handles all; `scope_notes` overrides custom engagements). If a true variant is ever needed, John duplicates the page in Notion and points `NOTION_CONTRACT_TEMPLATE_PAGE_ID` at it; productizing "Vera authors a new template variant on demand" is a v2 question.
- Real countersign step.
- Payment processing on signing. Stripe is wired elsewhere; contract signing does not trigger an invoice automatically.
- Editing a contract after it has been sent. To change terms, void and regenerate.

---

## Behavior (the loops)

### Generate loop (admin-triggered)
1. John clicks **Generate Contract** on `/clients/[id]`. Form: product (Herald / Atrium / Steward / Custom), amount (integer cents) + cadence (monthly / one-time / hourly), optional scope-notes free text.
2. `POST /api/admin/vera/contracts` with `{client_id, product, amount_cents, cadence, scope_notes?}`.
3. `requireAdmin()` → insert a row in `contracts` (`status='draft'`, `token=randomUrlSafe(32)`, `expires_at=now()+14d`).
4. Fetch master template from Notion (env `NOTION_CONTRACT_TEMPLATE_PAGE_ID`); fall back to bundled defaults if unreachable or any section is missing.
5. Substitute variables. Render the unsigned PDF via `@react-pdf/renderer`. Upload to Supabase Storage at `vera/<contract_id>/unsigned.pdf`.
6. Send the "Your GB2GLLC contract is ready to sign" email via Resend with the signing-page link.
7. Update row: `status='sent'`, `sent_at=now()`. Log to `client_logs` with category `"vera"`.
8. UI returns: success state with view link + copy-link button.

### Sign loop (client-triggered, public)
1. Client clicks the email link → `https://gb2gllc.com/sign/<token>`.
2. Server-side load: row by `token`. Gate on `status='sent'` and `expires_at > now()`. If `viewed_at` is null, set it now. Render the contract HTML inline using the same substituted-template content as the PDF.
3. Form at bottom: full-name input, "Representing on behalf of" input (pre-filled with `client.company`, editable), checkbox "I have authority to sign on behalf of this company and I agree to the terms above," Sign button (disabled until checkbox checked and both inputs filled).
4. `POST /api/sign/<token>` with `{signer_name, signer_representing, agree:true}`. Capture `x-forwarded-for` and `user-agent`.
5. Update row: `status='signed'`, `signed_at=now()`, `signer_name`, `signer_representing`, `signer_ip`, `signer_user_agent`.
6. `after()` runs:
   - Re-render PDF with typed signature embedded in the client section.
   - Upload to `vera/<contract_id>/signed.pdf`.
   - Create a page in Notion DB "GB2GLLC Contracts" with all metadata + signed PDF attached + relation to client intake page (`notion_page_id` on `contracts` row).
   - Email client: "Thanks for signing — here's your countersigned copy" with PDF attached.
   - Email John: "[Client company] signed the [Product] contract" with PDF attached + Notion link.
   - Slack ping the admin workspace channel.
7. Page swaps to "Signed! Check your inbox for a copy."

### Followup loop (cron-triggered, daily 09:00 UTC)
`GET /api/cron/vera-followups` (bearer auth with `CRON_SECRET`, registered in `vercel.json`):
- For rows where `status='sent' AND reminder_sent_at IS NULL AND sent_at < now() - interval '3 days'`: send reminder email via Resend, set `reminder_sent_at=now()`.
- For rows where `status='sent' AND expires_at < now()`: set `status='expired'`.

### Voiding (admin-triggered)
`POST /api/admin/vera/contracts/[id]/void` with optional `{reason?, notify_client?}`. Updates row to `status='voided'`, `voided_at`, `voided_reason`. If `notify_client === true`, sends a polite "this contract has been voided" email. Token lookups for voided contracts return a friendly page, not a 404.

---

## Components (new code)

```
lib/vera/
  master-template-defaults.ts   — bundled fallback: section IDs + default copy
  template.ts                    — fetch Notion page, parse blocks by H2, substitute {{vars}}
  pdf.tsx                        — <ContractDocument> React-PDF component
  html.tsx                       — same content as a React server component for /sign/[token]
  notion.ts                      — createSignedContractPage(contract, client, pdfBuffer)
  notify.ts                      — sendForSignature, sendReminder, sendSignedToClient, notifyAdmin (email + Slack)
  tokens.ts                      — mint (random 32-byte URL-safe) + verifyAndLoad
  product-scopes.ts              — default scope_paragraph per product (Herald/Atrium/Steward)
  format.ts                      — amount formatting (cents → "$2,400.00") + cadence label

app/(admin)/clients/[id]/
  ContractManager.tsx            — "Generate Contract" form + history of this client's contracts

app/(admin)/agents/vera/
  page.tsx                       — index: all contracts across clients, status filter, "X awaiting" badge
  [contractId]/page.tsx          — detail: view, resend, void, download PDF

app/api/admin/vera/
  contracts/route.ts             — POST create
  contracts/[id]/resend/route.ts — POST resend signing-link email
  contracts/[id]/void/route.ts   — POST void

app/sign/[token]/
  page.tsx                       — public signing page (rendered on gb2gllc.com host)
app/api/sign/[token]/
  route.ts                       — POST sign

app/api/cron/vera-followups/route.ts  — daily: reminders + expiry

supabase/migrations/
  021_vera_contracts.sql         — contracts table + indexes + service-role RLS
```

**Reused unchanged:** `lib/admin-auth.ts`, `lib/supabase.ts`, `lib/resend.ts`, `lib/notion.ts` (extends with new helper), `lib/slack.ts`, `lib/slack-builders.ts`, `lib/logger.ts`. Add `"vera"` to the `client_logs.category` union in `lib/logger.ts`.

**Why no Claude calls:** Vera is deterministic — template + substitution + PDF render. No classification, no drafting. That keeps the cost at zero and behavior predictable. If we ever want LLM-authored scope paragraphs from John's free text, that's a small addition later.

---

## The contract content

Stored as a single Notion page (env `NOTION_CONTRACT_TEMPLATE_PAGE_ID`). Parsed by H2 headings into a section map keyed by section ID. `lib/vera/template.ts` substitutes `{{variables}}` after fetching. Fallback: `lib/vera/master-template-defaults.ts` provides the same sections in TypeScript constants — if the Notion page is unreachable or a required section is missing, the fallback is used and a warning is logged.

Sections and draft copy:

```
GB2GLLC SERVICES AGREEMENT
Effective: upon signing by Client

Between:
  Oberon Analytics LLC, a South Carolina limited liability company,
  doing business as GB2GLLC ("GB2GLLC"), and
  {{client_company}} ("Client").

1. SCOPE OF WORK
   GB2GLLC will provide {{product_label}} services to Client.
   {{scope_paragraph}}

2. FEES
   Client will pay GB2GLLC {{amount_formatted}} {{cadence_label}}.
   Invoices are due Net-15 from the date of issue.

3. INTELLECTUAL PROPERTY
   GB2GLLC owns, in full, all software, code, models, prompts, design assets,
   methodologies, and other work product created under this Agreement.
   Client receives a perpetual, worldwide, royalty-free license to use the
   deliverables for Client's own business purposes.

4. THIRD-PARTY AI DISCLAIMER
   GB2GLLC's services may use third-party AI providers (such as Anthropic,
   OpenAI, Google, and others). These systems can produce inaccurate,
   incomplete, or unexpected outputs ("hallucinations"). GB2GLLC is not
   responsible for any third-party AI output, and Client is responsible for
   reviewing AI-generated content before relying on it.

5. CONFIDENTIALITY
   Each party will keep the other's non-public information confidential and
   use it only as needed to perform this Agreement.

6. TERM AND TERMINATION
   This Agreement begins on the date Client signs below. Either party may
   end it by giving the other at least thirty (30) days' written notice.
   Fees earned through the termination date remain payable.

7. AUTHORITY TO SIGN
   By signing below, {{signer_name}} confirms that they have full legal
   authority to represent {{client_company}} and to enter into this
   Agreement on its behalf.

8. GOVERNING LAW
   This Agreement is governed by the laws of the State of South Carolina,
   without regard to its conflict-of-laws principles.

— On behalf of GB2GLLC —
John McCully · Founder
Oberon Analytics LLC d/b/a GB2GLLC
Date: {{generated_date}}

— On behalf of Client —
Signature: {{signer_name}}
Representing: {{signer_representing}} on behalf of {{client_company}}
Date: {{signed_date}}
```

### Template variables

| Variable | Source |
|---|---|
| `{{client_company}}` | `clients.company` (fallback `clients.name`) |
| `{{product_label}}` | Map from the `product` enum: "Herald" / "Atrium" / "Steward" / "Custom" |
| `{{scope_paragraph}}` | `scope_notes` if set, else `product-scopes.ts` default for the product |
| `{{amount_formatted}}` | `formatCents(amount_cents)` → "$2,400.00" |
| `{{cadence_label}}` | "per month" / "as a one-time fee" / "per hour" |
| `{{generated_date}}` | `contracts.created_at` formatted "May 29, 2026" |
| `{{signer_name}}` | Filled at sign time. In the unsigned PDF, shows a blank line. |
| `{{signer_representing}}` | Filled at sign time. Defaults to `client.company` in the UI, editable. |
| `{{signed_date}}` | Filled at sign time. Shows blank in the unsigned PDF. |

### Visual tone
Single-page-ish PDF. Body in serif at 11pt, generous line height, no boxed headings, no scary all-caps clause titles beyond the existing convention. Reads more like a one-pager than a 12-page MSA. React-PDF gives us this — see `lib/june/pdf.tsx` for the typography pattern already in use.

---

## Data model — new migration `021_vera_contracts.sql`

```sql
CREATE TABLE contracts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  product              TEXT NOT NULL CHECK (product IN ('herald','atrium','steward','custom')),
  amount_cents         INTEGER NOT NULL,
  cadence              TEXT NOT NULL CHECK (cadence IN ('monthly','one_time','hourly')),
  scope_notes          TEXT,

  template_version     TEXT,                  -- "notion:<page_id>@<retrieved_at>" or "bundled:<git_sha>"
  token                TEXT NOT NULL UNIQUE,
  expires_at           TIMESTAMPTZ NOT NULL,

  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','sent','signed','voided','expired'
  )),

  sent_at              TIMESTAMPTZ,
  viewed_at            TIMESTAMPTZ,
  reminder_sent_at     TIMESTAMPTZ,
  signed_at            TIMESTAMPTZ,
  voided_at            TIMESTAMPTZ,
  voided_reason        TEXT,

  signer_name          TEXT,
  signer_representing  TEXT,
  signer_ip            TEXT,
  signer_user_agent    TEXT,

  notion_page_id       TEXT,
  unsigned_pdf_path    TEXT,
  signed_pdf_path      TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contracts_client_created ON contracts(client_id, created_at DESC);
CREATE INDEX idx_contracts_status         ON contracts(status, sent_at DESC);
CREATE INDEX idx_contracts_pending_reminder
  ON contracts(sent_at) WHERE status = 'sent' AND reminder_sent_at IS NULL;
CREATE INDEX idx_contracts_pending_expiry
  ON contracts(expires_at) WHERE status = 'sent';

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contracts_service_role_only ON contracts FOR ALL USING (false);
```

No `vera_settings` table for v1. Configuration is env vars + constants:
- `NOTION_CONTRACT_TEMPLATE_PAGE_ID` — master template page
- `NOTION_CONTRACTS_DATABASE_ID` — Contracts DB (new, separate from intake DB)
- `VERA_SLACK_CHANNEL` (or reuse `SUPPORT_SLACK_CHANNEL` from Wren) — admin notification channel
- Bundled constants for Net-15, SC, Oberon Analytics LLC d/b/a GB2GLLC entity name. If those change, code change.

---

## State machine

```
                Generate                                      Day 14 unsigned, cron
   draft  ───────────────►  sent  ───────────────────────────────────────────►  expired
                              │
                              │ (Day 3 unsigned, cron) sets reminder_sent_at,
                              │   sends reminder; status stays "sent"
                              │
                              │ client opens link → viewed_at set;
                              │   status stays "sent"
                              │
                              │ client submits sign form
                              ▼
                           signed   ──► after(): countersign PDF, store in
                                              Supabase + Notion, 3-way notify

   (any non-terminal state) ── John clicks void ──►  voided
```

`signed`, `expired`, and `voided` are terminal. A voided or expired contract cannot be reactivated; John generates a fresh one.

---

## Failure modes + edge cases

| Case | Behavior |
|---|---|
| Notion template fetch fails | Use `master-template-defaults.ts`. Log warning to `client_logs`. Contract still generates. `template_version` recorded as `bundled:<git_sha>`. |
| Notion page-create on signing fails | Don't block the signing flow. PDF + DB row + emails still go out. Retry once in `after()`. If still failing, leave `notion_page_id` null; surface a "Notion sync pending" badge on the contract detail page so John can retry manually. |
| Resend send fails on generate | Roll the contract back to `status='draft'`. Return error to UI. John can hit "Resend" once Resend is back. |
| Resend fails on sign confirmation | Don't block. Signing is committed. Log to `client_logs`, surface in admin. John can re-send. |
| Token guessed / brute-forced | 32-byte URL-safe = ~256 bits of entropy, no enumeration possible. Failed lookups return 404, no info leak about whether a token existed. |
| Client tries to sign expired / voided link | Friendly page: "This contract is no longer active. Contact john@gb2gllc.com for a fresh copy." No 404. |
| Client submits without checking authority box | Server validates `agree === true`. UI disables button until checked + both name fields populated. |
| Same client gets multiple contracts over time | Each is its own row + Notion page. The client's intake page in Notion shows all linked contracts via the relation column. The client detail admin page's ContractManager shows them in a history table. |
| Client clicks "Sign" twice in rapid succession | Server-side check: if `status !== 'sent'`, return 409 with "already signed" message. UI prevents this with disabled button after submit. |
| `expires_at` passes between view and submit | Server re-checks expiry on POST. Returns "expired" page. |
| Client signs at the moment cron runs and marks the contract expired | Cron uses `UPDATE … WHERE status='sent'` so a successful sign that flipped status to `'signed'` will be skipped by the cron. No race. |
| Voided contract token visited | Token returns the friendly voided page, not the signing page. |
| Re-send button used after expiry | Surface as disabled in the admin UI; voiding is the only way to "restart" — John voids and generates a fresh one. |
| PDF upload to Supabase Storage fails | Generation: roll back to draft, return error. Sign: still commit DB sign, retry once in `after()`, surface in admin if still failing. |
| Client's email bounces | Resend webhook (not wired today) — out of scope. John sees "sent" but no view, and can resend or contact the client out-of-band. |

---

## Testing

Following the Wren pattern: Node test runner via `npm test`, `.test.ts` files alongside source.

- `lib/vera/template.test.ts` — substitute `{{vars}}`, fallback on missing sections, escape-safe content
- `lib/vera/tokens.test.ts` — token mint format, verify expiry, verify status gating
- `lib/vera/format.test.ts` — cent formatting, cadence labels
- `lib/vera/notify.test.ts` — fake Resend client, assert subject / body / to / from / attachment shape
- `app/api/sign/[token]/route.test.ts` — accepts valid token, rejects expired/voided/signed, captures IP and UA

PDF rendering and the signing page UI don't need unit tests. Validate via `npm run dev` against a seed contract (and inspect the resulting PDF in `vera/<id>/`).

---

## Env vars (Vercel only — never in chat)

- `NOTION_CONTRACT_TEMPLATE_PAGE_ID` — master template Notion page
- `NOTION_CONTRACTS_DATABASE_ID` — Contracts Notion database
- `VERA_SLACK_CHANNEL` — admin Slack channel ID for sign notifications (or reuse `SUPPORT_SLACK_CHANNEL`)
- Reuses existing: `NOTION_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM` (or `VERA_RESEND_FROM` if we want a `contracts@` from-address), `SLACK_ADMIN_BOT_TOKEN`, `SUPABASE_URL` + service-role key, `CRON_SECRET`, `NEXT_PUBLIC_ADMIN_URL`, `ADMIN_EMAIL`.

A separate from-address (`contracts@gb2gllc.com`) is nicer for deliverability and inbox-routing on John's side (e.g., Wren can label inbound contract responses). Recommend wiring `VERA_RESEND_FROM`, with fallback to `RESEND_FROM`.

---

## Notion setup (one-time, manual)

1. Create a Notion database "GB2GLLC Contracts" with columns:
   - `Name` (title)
   - `Client` (relation → intake-submissions database)
   - `Product` (select: Herald / Atrium / Steward / Custom)
   - `Amount` (text)
   - `Status` (select: Draft / Sent / Signed / Voided / Expired)
   - `Signed PDF` (files)
   - `Signed by` (text)
   - `Signed at` (date)
   - `Effective date` (date)
   - `Contract ID` (text — Supabase `contracts.id`)
2. Share the database with the GB2G Notion integration.
3. Set `NOTION_CONTRACTS_DATABASE_ID` in Vercel.
4. Create a Notion page "GB2GLLC Services Agreement — Master Template" with the section content above (under H2 headings). Share with the integration.
5. Set `NOTION_CONTRACT_TEMPLATE_PAGE_ID` in Vercel.

---

## Phasing

Single PR. Migration + lib + admin UI + signing page + cron + tests. Mirrors the Wren shape (which also shipped as one PR). Estimated work: ~2 days.

Operational tasks after merge (user-only, Phase N):
- `supabase db push` to apply `021_vera_contracts.sql`
- Create the two Notion artifacts (Contracts DB + master template page); share with integration
- Set the new env vars in Vercel
- Smoke test: generate a contract against a test client (John's own email), sign it, verify Notion page + Slack ping + emails

---

## Related

- [[project-iris-inbox-agent]] — sibling architecture (cron + admin-only)
- [[project-wren-support-triage-agent]] — sibling architecture (notifications + admin pages)
- [[project-gb2g-build-conventions]] — Manager-component pattern, migration conventions
- [[project-gb2g-brand-rules]] — typography, no UI libraries
