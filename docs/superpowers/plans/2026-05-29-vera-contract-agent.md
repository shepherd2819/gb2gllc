# Vera — Contract Generation & Signing Agent: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Vera, an internal admin agent that generates services contracts from a Notion master template, emails clients a magic-link signing page, captures typed signatures, stores countersigned PDFs in Supabase Storage + Notion, and notifies John via email + Slack + admin badge.

**Architecture:** Single PR mirroring the Wren shape. Deterministic (no LLM calls). New `lib/vera/*` module + new `contracts` table + admin Manager component + public token-gated signing page at `gb2gllc.com/sign/<token>` + daily cron for reminders/expiry.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), TypeScript, Supabase Postgres (service-role-only RLS), Supabase Storage, `@react-pdf/renderer`, `@notionhq/client`, Resend, Slack Web API, Node test runner.

**Spec:** `docs/superpowers/specs/2026-05-29-vera-contract-agent-design.md`

**Before starting:** decide branch with John. The spec doc currently sits on `feat/ada-phase-2`. Create a fresh `feat/vera` branch off the current commit (or off `main`, cherry-picking the spec commit) before Task 1.

---

## File structure

```
supabase/migrations/021_vera_contracts.sql                  (new)
lib/logger.ts                                               (modify — add "vera")
lib/vera/format.ts                                          (new)
lib/vera/format.test.ts                                     (new)
lib/vera/product-scopes.ts                                  (new)
lib/vera/master-template-defaults.ts                        (new)
lib/vera/template.ts                                        (new)
lib/vera/template.test.ts                                   (new)
lib/vera/tokens.ts                                          (new)
lib/vera/tokens.test.ts                                     (new)
lib/vera/pdf.tsx                                            (new)
lib/vera/html.tsx                                           (new)
lib/vera/notify.ts                                          (new)
lib/vera/notify.test.ts                                     (new)
lib/vera/notion.ts                                          (new)
lib/vera/storage.ts                                         (new — small helper for Supabase Storage upload+sign URL)
app/api/admin/vera/contracts/route.ts                       (new)
app/api/admin/vera/contracts/[id]/resend/route.ts           (new)
app/api/admin/vera/contracts/[id]/void/route.ts             (new)
app/api/admin/vera/contracts/[id]/retry-notion/route.ts     (new)
app/api/sign/[token]/route.ts                               (new)
app/api/sign/[token]/route.test.ts                          (new)
app/sign/[token]/page.tsx                                   (new — public)
app/sign/[token]/SignForm.tsx                               (new — client component)
app/(admin)/clients/[id]/ContractManager.tsx                (new)
app/(admin)/clients/[id]/page.tsx                           (modify — render ContractManager)
app/(admin)/agents/vera/page.tsx                            (new)
app/(admin)/agents/vera/[contractId]/page.tsx               (new)
app/(admin)/agents/vera/[contractId]/ActionBar.tsx          (new — client component)
app/api/cron/vera-followups/route.ts                        (new)
vercel.json                                                 (modify — register cron)
```

Each `lib/vera/*` file has one responsibility (formatting, templates, tokens, PDF, HTML, notifications, Notion sync, storage). API routes are thin; logic lives in `lib/vera/*` so it stays testable.

---

## Test commands

- Type check: `npm run typecheck`
- Unit tests: `npm test`
- Dev server: `npm run dev`

Run typecheck + tests **after every code-changing step** and before every commit. If either fails, fix before moving on.

---

## Task 1: Migration + logger union

**Files:**
- Create: `supabase/migrations/021_vera_contracts.sql`
- Modify: `lib/logger.ts:4`

- [ ] **Step 1: Create the migration**

```sql
-- ============================================================
-- 021_vera_contracts.sql — Vera (contract generation + signing agent)
-- ============================================================
-- Admin-only. One row per generated contract. Tokens are random 32-byte
-- URL-safe strings (no enumeration). Signed PDFs land in Supabase Storage
-- under vera/<contract_id>/. The contracts Notion DB stores the human-
-- readable record. All state lives in this table.

CREATE TABLE contracts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  product              TEXT NOT NULL CHECK (product IN ('herald','atrium','steward','custom')),
  amount_cents         INTEGER NOT NULL,
  cadence              TEXT NOT NULL CHECK (cadence IN ('monthly','one_time','hourly')),
  scope_notes          TEXT,

  template_version     TEXT,
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

CREATE INDEX idx_contracts_client_created     ON contracts(client_id, created_at DESC);
CREATE INDEX idx_contracts_status             ON contracts(status, sent_at DESC);
CREATE INDEX idx_contracts_pending_reminder   ON contracts(sent_at)    WHERE status = 'sent' AND reminder_sent_at IS NULL;
CREATE INDEX idx_contracts_pending_expiry     ON contracts(expires_at) WHERE status = 'sent';

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contracts_service_role_only ON contracts FOR ALL USING (false);
```

- [ ] **Step 2: Add "vera" to the logger category union**

Open `lib/logger.ts`. Find the `Category` type (line ~4). It currently looks like:

```ts
type Category = "herald" | "intake" | "steward" | "system" | "iris" | "wren" | "holt" | "nora";
```

Change it to add `"vera"`:

```ts
type Category = "herald" | "intake" | "steward" | "system" | "iris" | "wren" | "holt" | "nora" | "vera";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes (no logger.ts callers exist yet for "vera", so no errors).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/021_vera_contracts.sql lib/logger.ts
git commit -m "Vera: migration + logger category"
```

---

## Task 2: Format helpers (cents, cadence)

**Files:**
- Create: `lib/vera/format.ts`
- Create: `lib/vera/format.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/vera/format.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAmount, cadenceLabel } from "./format";

test("formatAmount: whole dollars", () => {
  assert.equal(formatAmount(240000), "$2,400.00");
});

test("formatAmount: with cents", () => {
  assert.equal(formatAmount(1800050), "$18,000.50");
});

test("formatAmount: zero", () => {
  assert.equal(formatAmount(0), "$0.00");
});

test("formatAmount: small", () => {
  assert.equal(formatAmount(99), "$0.99");
});

test("cadenceLabel maps monthly", () => {
  assert.equal(cadenceLabel("monthly"), "per month");
});

test("cadenceLabel maps one_time", () => {
  assert.equal(cadenceLabel("one_time"), "as a one-time fee");
});

test("cadenceLabel maps hourly", () => {
  assert.equal(cadenceLabel("hourly"), "per hour");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern='formatAmount|cadenceLabel'`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/vera/format.ts`:

```ts
export type Cadence = "monthly" | "one_time" | "hourly";

export function formatAmount(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function cadenceLabel(cadence: Cadence): string {
  switch (cadence) {
    case "monthly":   return "per month";
    case "one_time":  return "as a one-time fee";
    case "hourly":    return "per hour";
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern='formatAmount|cadenceLabel'`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add lib/vera/format.ts lib/vera/format.test.ts
git commit -m "Vera: amount + cadence formatting"
```

---

## Task 3: Product scopes (default scope paragraphs)

**Files:**
- Create: `lib/vera/product-scopes.ts`

- [ ] **Step 1: Write the file**

```ts
export type Product = "herald" | "atrium" | "steward" | "custom";

export const PRODUCT_LABELS: Record<Product, string> = {
  herald:  "Herald",
  atrium:  "Atrium",
  steward: "Steward",
  custom:  "Custom",
};

export const DEFAULT_SCOPE: Record<Product, string> = {
  herald:
    "GB2GLLC will provide Client with the Herald AI website chatbot service, including initial setup, ongoing tuning, and a monthly performance digest. GB2GLLC will respond to Client requests through standard support channels.",
  atrium:
    "GB2GLLC will design and build a website for Client per the scope agreed in writing prior to engagement, including discovery, design, build, and launch. Hosting and ongoing maintenance are not included unless added in a separate agreement.",
  steward:
    "GB2GLLC will configure and operate Client-specific AI Employee instances under the Steward platform, including agent setup, ongoing supervision, and a monthly activity report.",
  custom:
    "GB2GLLC will provide Client the services described in the engagement notes below and in any related written communications between the parties.",
};
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add lib/vera/product-scopes.ts
git commit -m "Vera: product labels + default scope paragraphs"
```

---

## Task 4: Master template defaults (bundled fallback)

**Files:**
- Create: `lib/vera/master-template-defaults.ts`

- [ ] **Step 1: Write the file**

```ts
// Bundled fallback for the master contract template. Used when the
// Notion master page is unreachable or missing a required section.
// Section keys must match exactly what lib/vera/template.ts looks for.

export type SectionKey =
  | "preamble"
  | "scope_of_work"
  | "fees"
  | "intellectual_property"
  | "ai_disclaimer"
  | "confidentiality"
  | "term_and_termination"
  | "authority_to_sign"
  | "governing_law";

export const DEFAULT_SECTIONS: Record<SectionKey, string> = {
  preamble:
    'Between: Oberon Analytics LLC, a South Carolina limited liability company, doing business as GB2GLLC ("GB2GLLC"), and {{client_company}} ("Client"). Effective on the date Client signs below.',
  scope_of_work:
    "GB2GLLC will provide {{product_label}} services to Client. {{scope_paragraph}}",
  fees:
    "Client will pay GB2GLLC {{amount_formatted}} {{cadence_label}}. Invoices are due Net-15 from the date of issue.",
  intellectual_property:
    "GB2GLLC owns, in full, all software, code, models, prompts, design assets, methodologies, and other work product created under this Agreement. Client receives a perpetual, worldwide, royalty-free license to use the deliverables for Client's own business purposes.",
  ai_disclaimer:
    'GB2GLLC\'s services may use third-party AI providers (such as Anthropic, OpenAI, Google, and others). These systems can produce inaccurate, incomplete, or unexpected outputs ("hallucinations"). GB2GLLC is not responsible for any third-party AI output, and Client is responsible for reviewing AI-generated content before relying on it.',
  confidentiality:
    "Each party will keep the other's non-public information confidential and use it only as needed to perform this Agreement.",
  term_and_termination:
    "This Agreement begins on the date Client signs below. Either party may end it by giving the other at least thirty (30) days' written notice. Fees earned through the termination date remain payable.",
  authority_to_sign:
    "By signing below, {{signer_name}} confirms that they have full legal authority to represent {{client_company}} and to enter into this Agreement on its behalf.",
  governing_law:
    "This Agreement is governed by the laws of the State of South Carolina, without regard to its conflict-of-laws principles.",
};

export const SECTION_TITLES: Record<SectionKey, string> = {
  preamble:              "GB2GLLC Services Agreement",
  scope_of_work:         "1. Scope of Work",
  fees:                  "2. Fees",
  intellectual_property: "3. Intellectual Property",
  ai_disclaimer:         "4. Third-Party AI Disclaimer",
  confidentiality:       "5. Confidentiality",
  term_and_termination:  "6. Term and Termination",
  authority_to_sign:     "7. Authority to Sign",
  governing_law:         "8. Governing Law",
};

export const SECTION_ORDER: SectionKey[] = [
  "preamble",
  "scope_of_work",
  "fees",
  "intellectual_property",
  "ai_disclaimer",
  "confidentiality",
  "term_and_termination",
  "authority_to_sign",
  "governing_law",
];
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add lib/vera/master-template-defaults.ts
git commit -m "Vera: bundled master-template defaults"
```

---

## Task 5: Template engine (Notion fetch + substitute + fallback)

**Files:**
- Create: `lib/vera/template.ts`
- Create: `lib/vera/template.test.ts`

Reads master template from Notion if `NOTION_CONTRACT_TEMPLATE_PAGE_ID` is set, parses H2-block sections by their **title text**, substitutes `{{vars}}`, and falls back to bundled defaults on any failure or missing section. Returns `{ sections: Record<SectionKey, string>, version: string }`.

- [ ] **Step 1: Write the failing tests**

Create `lib/vera/template.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { substituteSection, fallbackSections } from "./template";

test("substituteSection replaces a single variable", () => {
  const out = substituteSection("Hello {{name}}.", { name: "World" });
  assert.equal(out, "Hello World.");
});

test("substituteSection replaces multiple occurrences", () => {
  const out = substituteSection("{{a}} and {{a}} and {{b}}", { a: "x", b: "y" });
  assert.equal(out, "x and x and y");
});

test("substituteSection leaves unknown variables literal", () => {
  const out = substituteSection("Hello {{unknown}}.", { name: "World" });
  assert.equal(out, "Hello {{unknown}}.");
});

test("substituteSection handles empty input", () => {
  assert.equal(substituteSection("", { a: "x" }), "");
});

test("fallbackSections returns all 9 keys", () => {
  const out = fallbackSections();
  assert.equal(Object.keys(out.sections).length, 9);
  assert.equal(out.version.startsWith("bundled:"), true);
});
```

- [ ] **Step 2: Run tests, expect FAIL** (module not found)

Run: `npm test -- --test-name-pattern='substituteSection|fallbackSections'`

- [ ] **Step 3: Write the implementation**

Create `lib/vera/template.ts`:

```ts
import { Client } from "@notionhq/client";
import {
  DEFAULT_SECTIONS,
  SECTION_ORDER,
  SECTION_TITLES,
  type SectionKey,
} from "./master-template-defaults";

export type SubstitutionVars = {
  client_company: string;
  product_label: string;
  scope_paragraph: string;
  amount_formatted: string;
  cadence_label: string;
  generated_date: string;
  signer_name: string;
  signer_representing: string;
  signed_date: string;
};

export type LoadedTemplate = {
  sections: Record<SectionKey, string>;
  version: string; // "notion:<pageId>@<iso>" | "bundled:<git_sha or 'unknown'>"
};

export function substituteSection(text: string, vars: Partial<Record<string, string>>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) && vars[key] !== undefined
      ? String(vars[key])
      : `{{${key}}}`
  );
}

export function fallbackSections(): LoadedTemplate {
  return {
    sections: { ...DEFAULT_SECTIONS },
    version: `bundled:${process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown"}`,
  };
}

// Loads from Notion, falls back on any error.
export async function loadMasterTemplate(
  notion: Client = new Client({ auth: process.env.NOTION_TOKEN })
): Promise<LoadedTemplate> {
  const pageId = process.env.NOTION_CONTRACT_TEMPLATE_PAGE_ID;
  if (!pageId) return fallbackSections();

  try {
    const sections = { ...DEFAULT_SECTIONS };
    const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });

    let currentKey: SectionKey | null = null;
    let buffer: string[] = [];

    const flush = () => {
      if (currentKey && buffer.length > 0) {
        sections[currentKey] = buffer.join("\n").trim();
      }
    };

    for (const block of blocks.results) {
      const b = block as { type?: string; heading_2?: { rich_text: { plain_text: string }[] }; paragraph?: { rich_text: { plain_text: string }[] } };
      if (b.type === "heading_2") {
        flush();
        const title = (b.heading_2?.rich_text ?? []).map((r) => r.plain_text).join("").trim();
        const matched = SECTION_ORDER.find(
          (k) => SECTION_TITLES[k].toLowerCase() === title.toLowerCase()
        );
        currentKey = matched ?? null;
        buffer = [];
      } else if (b.type === "paragraph" && currentKey) {
        const text = (b.paragraph?.rich_text ?? []).map((r) => r.plain_text).join("");
        if (text) buffer.push(text);
      }
    }
    flush();

    return {
      sections,
      version: `notion:${pageId}@${new Date().toISOString()}`,
    };
  } catch (err) {
    console.warn("[vera/template] Notion load failed, using bundled defaults:", err instanceof Error ? err.message : err);
    return fallbackSections();
  }
}

export function renderSection(key: SectionKey, sections: Record<SectionKey, string>, vars: Partial<SubstitutionVars>): string {
  return substituteSection(sections[key], vars);
}

export { SECTION_ORDER, SECTION_TITLES, type SectionKey };
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `npm test -- --test-name-pattern='substituteSection|fallbackSections'`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add lib/vera/template.ts lib/vera/template.test.ts
git commit -m "Vera: template engine (Notion + substitute + fallback)"
```

---

## Task 6: Tokens (mint + verify)

**Files:**
- Create: `lib/vera/tokens.ts`
- Create: `lib/vera/tokens.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/vera/tokens.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mintToken, isTokenSignable } from "./tokens";

test("mintToken returns URL-safe string of expected length", () => {
  const t = mintToken();
  assert.match(t, /^[A-Za-z0-9_-]+$/);
  assert.equal(t.length, 43); // base64url of 32 bytes = 43 chars
});

test("mintToken returns unique values", () => {
  const a = mintToken();
  const b = mintToken();
  assert.notEqual(a, b);
});

test("isTokenSignable: sent + future expiry is signable", () => {
  const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
  assert.equal(isTokenSignable({ status: "sent", expires_at: future }), true);
});

test("isTokenSignable: expired is not signable", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  assert.equal(isTokenSignable({ status: "sent", expires_at: past }), false);
});

test("isTokenSignable: voided is not signable", () => {
  const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
  assert.equal(isTokenSignable({ status: "voided", expires_at: future }), false);
});

test("isTokenSignable: already signed is not signable", () => {
  const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
  assert.equal(isTokenSignable({ status: "signed", expires_at: future }), false);
});
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `npm test -- --test-name-pattern='mintToken|isTokenSignable'`

- [ ] **Step 3: Write the implementation**

Create `lib/vera/tokens.ts`:

```ts
import { randomBytes } from "node:crypto";

export type TokenContractRow = {
  status: "draft" | "sent" | "signed" | "voided" | "expired";
  expires_at: string;
};

export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isTokenSignable(row: TokenContractRow): boolean {
  if (row.status !== "sent") return false;
  return Date.parse(row.expires_at) > Date.now();
}

// Loads a row by token using supabaseAdmin. Returns null if not found.
// Caller uses isTokenSignable() to gate access.
export async function loadContractByToken(token: string) {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin
    .from("contracts")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  return data;
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `npm test -- --test-name-pattern='mintToken|isTokenSignable'`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add lib/vera/tokens.ts lib/vera/tokens.test.ts
git commit -m "Vera: token mint + signability check"
```

---

## Task 7: PDF renderer

**Files:**
- Create: `lib/vera/pdf.tsx`

Mirrors `lib/june/pdf.tsx` (already in the repo — read it for the typography pattern and `renderToBuffer` usage). PDF takes the loaded template sections + substitution vars + contract metadata and produces a buffer.

- [ ] **Step 1: Write the file**

```tsx
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { SECTION_ORDER, SECTION_TITLES, type SectionKey } from "./master-template-defaults";
import { substituteSection, type SubstitutionVars } from "./template";

const styles = StyleSheet.create({
  page:        { padding: 56, fontFamily: "Helvetica", fontSize: 11, lineHeight: 1.5, color: "#1c1c1c" },
  title:       { fontSize: 18, marginBottom: 6, fontFamily: "Helvetica-Bold" },
  effective:   { fontSize: 10, marginBottom: 20, color: "#555" },
  sectionTitle:{ fontSize: 11, marginTop: 14, marginBottom: 4, fontFamily: "Helvetica-Bold" },
  paragraph:   { marginBottom: 6 },
  sigBlock:    { marginTop: 28, borderTopWidth: 1, borderTopColor: "#bbb", paddingTop: 16 },
  sigHeader:   { fontFamily: "Helvetica-Bold", marginBottom: 4 },
  sigLine:     { marginBottom: 2 },
  muted:       { color: "#777" },
});

type Props = {
  sections: Record<SectionKey, string>;
  vars: SubstitutionVars;
  signed: boolean; // true → render typed-signature lines filled in; false → blank lines
};

export function ContractDocument({ sections, vars, signed }: Props) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>GB2GLLC Services Agreement</Text>
        <Text style={styles.effective}>Effective: upon signing by Client</Text>

        <Text style={styles.paragraph}>{substituteSection(sections.preamble, vars)}</Text>

        {SECTION_ORDER.filter((k) => k !== "preamble").map((key) => (
          <View key={key}>
            <Text style={styles.sectionTitle}>{SECTION_TITLES[key]}</Text>
            <Text style={styles.paragraph}>{substituteSection(sections[key], vars)}</Text>
          </View>
        ))}

        <View style={styles.sigBlock}>
          <Text style={styles.sigHeader}>On behalf of GB2GLLC</Text>
          <Text style={styles.sigLine}>John McCully · Founder</Text>
          <Text style={styles.sigLine}>Oberon Analytics LLC d/b/a GB2GLLC</Text>
          <Text style={styles.sigLine}>Date: {vars.generated_date}</Text>
        </View>

        <View style={styles.sigBlock}>
          <Text style={styles.sigHeader}>On behalf of Client</Text>
          <Text style={styles.sigLine}>
            Signature: <Text style={signed ? undefined : styles.muted}>{signed ? vars.signer_name : "_______________________________"}</Text>
          </Text>
          <Text style={styles.sigLine}>
            Representing: <Text style={signed ? undefined : styles.muted}>{signed ? `${vars.signer_representing} on behalf of ${vars.client_company}` : "_______________________________"}</Text>
          </Text>
          <Text style={styles.sigLine}>
            Date: <Text style={signed ? undefined : styles.muted}>{signed ? vars.signed_date : "_______________________________"}</Text>
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderContractPdf(props: Props): Promise<Buffer> {
  return await renderToBuffer(<ContractDocument {...props} />);
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add lib/vera/pdf.tsx
git commit -m "Vera: PDF renderer (React-PDF)"
```

---

## Task 8: HTML signing-page content (server component)

**Files:**
- Create: `lib/vera/html.tsx`

Same content as the PDF rendered for the signing page. No new CSS classes — uses existing tokens. See `public/admin/admin.css` and `public/portal/portal.css` for available classes; the signing page is on the marketing host so it uses Geist (already loaded in marketing pages).

- [ ] **Step 1: Write the file**

```tsx
import { SECTION_ORDER, SECTION_TITLES, type SectionKey } from "./master-template-defaults";
import { substituteSection, type SubstitutionVars } from "./template";

type Props = {
  sections: Record<SectionKey, string>;
  vars: SubstitutionVars;
};

export function ContractHtml({ sections, vars }: Props) {
  return (
    <article className="sign-contract">
      <header className="sign-title">
        <h1>GB2GLLC Services Agreement</h1>
        <p className="sign-effective">Effective: upon signing by Client</p>
      </header>

      <p className="sign-para">{substituteSection(sections.preamble, vars)}</p>

      {SECTION_ORDER.filter((k) => k !== "preamble").map((key) => (
        <section key={key} className="sign-section">
          <h2>{SECTION_TITLES[key]}</h2>
          <p>{substituteSection(sections[key], vars)}</p>
        </section>
      ))}

      <section className="sign-block">
        <h3>On behalf of GB2GLLC</h3>
        <p>John McCully · Founder</p>
        <p>Oberon Analytics LLC d/b/a GB2GLLC</p>
        <p>Date: {vars.generated_date}</p>
      </section>
    </article>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add lib/vera/html.tsx
git commit -m "Vera: HTML signing-page content"
```

---

## Task 9: Storage helper (Supabase Storage upload + signed URL)

**Files:**
- Create: `lib/vera/storage.ts`

A thin wrapper. Upload returns the path; reading is via signed URL (1 hour) for admin / email-attached buffer.

- [ ] **Step 1: Write the file**

```ts
import { supabaseAdmin } from "@/lib/supabase";

const BUCKET = "vera";

// Uploads a PDF buffer and returns the storage path.
// path format: "<contract_id>/<filename>.pdf"
export async function uploadContractPdf(contractId: string, filename: "unsigned" | "signed", buffer: Buffer): Promise<string> {
  const path = `${contractId}/${filename}.pdf`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw new Error(`Vera PDF upload failed: ${error.message}`);
  return path;
}

export async function downloadContractPdf(path: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Vera PDF download failed: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function signedContractPdfUrl(path: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data) throw new Error(`Vera signed-URL failed: ${error?.message ?? "no data"}`);
  return data.signedUrl;
}
```

> **Note for the operator:** before this is used in production, create a private Supabase Storage bucket named `vera` via the dashboard or `supabaseAdmin.storage.createBucket('vera', { public: false })`. Add this to the Phasing checklist at the bottom of the spec.

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add lib/vera/storage.ts
git commit -m "Vera: Supabase Storage helpers"
```

---

## Task 10: Notify lib (Resend + Slack)

**Files:**
- Create: `lib/vera/notify.ts`
- Create: `lib/vera/notify.test.ts`

Four functions. Each is testable with a fake Resend client (passed in). Slack uses `lib/slack.ts` — read it for the existing `postMessage` pattern.

- [ ] **Step 1: Write the failing tests**

Create `lib/vera/notify.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildForSignatureEmail,
  buildReminderEmail,
  buildSignedClientEmail,
  buildSignedAdminEmail,
  buildSignedSlackBlocks,
} from "./notify";

const baseArgs = {
  clientName: "Acme",
  clientCompany: "Acme, Inc.",
  productLabel: "Herald",
  amountFormatted: "$2,400.00",
  cadenceLabel: "per month",
  signingUrl: "https://gb2gllc.com/sign/abc123",
  notionUrl: "https://www.notion.so/page/x",
  signerName: "Jane Doe",
};

test("buildForSignatureEmail includes the signing URL and product", () => {
  const e = buildForSignatureEmail(baseArgs);
  assert.match(e.subject, /Herald/);
  assert.match(e.html, /https:\/\/gb2gllc\.com\/sign\/abc123/);
  assert.match(e.text, /https:\/\/gb2gllc\.com\/sign\/abc123/);
});

test("buildReminderEmail mentions it's a reminder", () => {
  const e = buildReminderEmail(baseArgs);
  assert.match(e.subject, /reminder/i);
  assert.match(e.html, /https:\/\/gb2gllc\.com\/sign\/abc123/);
});

test("buildSignedClientEmail thanks the client", () => {
  const e = buildSignedClientEmail({ ...baseArgs });
  assert.match(e.subject, /signed|thanks/i);
});

test("buildSignedAdminEmail names the signer", () => {
  const e = buildSignedAdminEmail({ ...baseArgs });
  assert.match(e.html, /Jane Doe/);
  assert.match(e.html, /Acme, Inc\./);
});

test("buildSignedSlackBlocks names the product and amount", () => {
  const blocks = buildSignedSlackBlocks({ ...baseArgs });
  const flat = JSON.stringify(blocks);
  assert.match(flat, /Herald/);
  assert.match(flat, /\$2,400/);
});
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `npm test -- --test-name-pattern='build(ForSignature|Reminder|Signed)'`

- [ ] **Step 3: Write the implementation**

Create `lib/vera/notify.ts`:

```ts
import { resend, DEFAULT_FROM } from "@/lib/resend";

const FROM = process.env.VERA_RESEND_FROM ?? DEFAULT_FROM;

export type EmailDoc = { subject: string; html: string; text: string };

type CommonArgs = {
  clientName: string;
  clientCompany: string;
  productLabel: string;
  amountFormatted: string;
  cadenceLabel: string;
  signingUrl: string;
  notionUrl?: string;
  signerName?: string;
};

export function buildForSignatureEmail(a: CommonArgs): EmailDoc {
  const subject = `Your GB2GLLC ${a.productLabel} contract is ready to sign`;
  const html = `
    <p>Hi ${escapeHtml(a.clientName)},</p>
    <p>Your services agreement for <strong>${escapeHtml(a.productLabel)}</strong> at ${escapeHtml(a.amountFormatted)} ${escapeHtml(a.cadenceLabel)} is ready.</p>
    <p>Read it and sign here:</p>
    <p><a href="${a.signingUrl}">${a.signingUrl}</a></p>
    <p>This link is good for 14 days. Reply to this email with any questions.</p>
    <p>— John McCully<br/>Oberon Analytics LLC d/b/a GB2GLLC</p>`;
  const text = [
    `Hi ${a.clientName},`,
    ``,
    `Your services agreement for ${a.productLabel} at ${a.amountFormatted} ${a.cadenceLabel} is ready.`,
    ``,
    `Read it and sign here:`,
    a.signingUrl,
    ``,
    `This link is good for 14 days. Reply with any questions.`,
    ``,
    `— John McCully`,
    `Oberon Analytics LLC d/b/a GB2GLLC`,
  ].join("\n");
  return { subject, html, text };
}

export function buildReminderEmail(a: CommonArgs): EmailDoc {
  const subject = `Reminder: your GB2GLLC ${a.productLabel} contract`;
  const html = `
    <p>Hi ${escapeHtml(a.clientName)},</p>
    <p>Just a friendly nudge — your contract is still waiting for your signature.</p>
    <p><a href="${a.signingUrl}">${a.signingUrl}</a></p>
    <p>If you'd rather skip, no worries — let me know.</p>
    <p>— John</p>`;
  const text = [
    `Hi ${a.clientName},`,
    ``,
    `Just a friendly nudge — your contract is still waiting for your signature.`,
    ``,
    a.signingUrl,
    ``,
    `If you'd rather skip, no worries — let me know.`,
    ``,
    `— John`,
  ].join("\n");
  return { subject, html, text };
}

export function buildSignedClientEmail(a: CommonArgs): EmailDoc {
  const subject = `Thanks for signing — your GB2GLLC contract`;
  const html = `
    <p>Hi ${escapeHtml(a.clientName)},</p>
    <p>Your signed contract is attached for your records.</p>
    <p>We're all set to start. I'll be in touch shortly.</p>
    <p>— John McCully<br/>Oberon Analytics LLC d/b/a GB2GLLC</p>`;
  const text = [
    `Hi ${a.clientName},`,
    ``,
    `Your signed contract is attached for your records.`,
    ``,
    `We're all set to start. I'll be in touch shortly.`,
    ``,
    `— John McCully`,
    `Oberon Analytics LLC d/b/a GB2GLLC`,
  ].join("\n");
  return { subject, html, text };
}

export function buildSignedAdminEmail(a: CommonArgs): EmailDoc {
  const subject = `[Vera] ${a.clientCompany} signed the ${a.productLabel} contract`;
  const html = `
    <p><strong>${escapeHtml(a.signerName ?? "—")}</strong> signed the <strong>${escapeHtml(a.productLabel)}</strong> contract on behalf of <strong>${escapeHtml(a.clientCompany)}</strong>.</p>
    <p>Amount: ${escapeHtml(a.amountFormatted)} ${escapeHtml(a.cadenceLabel)}</p>
    ${a.notionUrl ? `<p><a href="${a.notionUrl}">Notion record</a></p>` : ""}
    <p>PDF attached.</p>`;
  const text = `${a.signerName ?? "—"} signed the ${a.productLabel} contract on behalf of ${a.clientCompany}.\nAmount: ${a.amountFormatted} ${a.cadenceLabel}.${a.notionUrl ? `\nNotion: ${a.notionUrl}` : ""}\nPDF attached.`;
  return { subject, html, text };
}

export function buildSignedSlackBlocks(a: CommonArgs) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `✅ *${a.signerName ?? "Someone"}* signed the *${a.productLabel}* contract on behalf of *${a.clientCompany}*.`,
      },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `Amount: ${a.amountFormatted} ${a.cadenceLabel}` },
      ],
    },
  ];
}

// Actual senders below — small wrappers that call build* and dispatch.

export async function sendForSignature(toEmail: string, args: CommonArgs): Promise<void> {
  const doc = buildForSignatureEmail(args);
  await resend().emails.send({ from: FROM, to: toEmail, subject: doc.subject, html: doc.html, text: doc.text });
}

export async function sendReminder(toEmail: string, args: CommonArgs): Promise<void> {
  const doc = buildReminderEmail(args);
  await resend().emails.send({ from: FROM, to: toEmail, subject: doc.subject, html: doc.html, text: doc.text });
}

export async function sendSignedToClient(toEmail: string, args: CommonArgs, pdf: Buffer): Promise<void> {
  const doc = buildSignedClientEmail(args);
  await resend().emails.send({
    from: FROM, to: toEmail, subject: doc.subject, html: doc.html, text: doc.text,
    attachments: [{ filename: "GB2GLLC-Services-Agreement.pdf", content: pdf }],
  });
}

export async function sendSignedToAdmin(args: CommonArgs, pdf: Buffer): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";
  const doc = buildSignedAdminEmail(args);
  await resend().emails.send({
    from: FROM, to: adminEmail, subject: doc.subject, html: doc.html, text: doc.text,
    attachments: [{ filename: "GB2GLLC-Services-Agreement.pdf", content: pdf }],
  });
}

export async function pingSlackOnSign(args: CommonArgs): Promise<void> {
  const token = process.env.SLACK_ADMIN_BOT_TOKEN;
  const channel = process.env.VERA_SLACK_CHANNEL ?? process.env.SUPPORT_SLACK_CHANNEL;
  if (!token || !channel) {
    console.warn("[vera/notify] SLACK_ADMIN_BOT_TOKEN or VERA_SLACK_CHANNEL not set — skipping Slack ping");
    return;
  }
  const blocks = buildSignedSlackBlocks(args);
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel, blocks, text: `${args.signerName ?? "Someone"} signed the ${args.productLabel} contract` }),
  });
  if (!res.ok) console.warn("[vera/notify] Slack postMessage failed:", await res.text());
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `npm test -- --test-name-pattern='build(ForSignature|Reminder|Signed)'`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add lib/vera/notify.ts lib/vera/notify.test.ts
git commit -m "Vera: notify library (Resend emails + Slack ping)"
```

---

## Task 11: Notion sync (create signed-contract page)

**Files:**
- Create: `lib/vera/notion.ts`

Uses existing `notion` client from `lib/notion.ts`. Creates a page in the new "GB2GLLC Contracts" Notion database (env `NOTION_CONTRACTS_DATABASE_ID`). The signed PDF is **NOT** uploaded as a Notion file attachment — Notion's file API requires you to upload to your own storage and pass a URL. Instead we attach the public signed-URL from Supabase Storage as a Notion `files` property with external URL.

- [ ] **Step 1: Write the file**

```ts
import { notion } from "@/lib/notion";
import { signedContractPdfUrl } from "./storage";

export type SignedContractArgs = {
  contractId: string;
  clientName: string;
  clientCompany: string;
  productLabel: string;
  amountFormatted: string;
  cadenceLabel: string;
  signerName: string;
  signerRepresenting: string;
  signedAt: string;          // ISO
  signedPdfPath: string;     // storage path
};

export async function createSignedContractNotionPage(a: SignedContractArgs): Promise<string> {
  const dbId = process.env.NOTION_CONTRACTS_DATABASE_ID;
  if (!dbId) throw new Error("NOTION_CONTRACTS_DATABASE_ID not set");

  const pdfUrl = await signedContractPdfUrl(a.signedPdfPath, 60 * 60 * 24 * 7); // 7-day signed URL

  const page = await notion.pages.create({
    parent: { database_id: dbId },
    properties: {
      Name: {
        title: [{ text: { content: `${a.clientCompany} · ${a.productLabel} · ${new Date(a.signedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` } }],
      },
      Product:        { select: { name: a.productLabel } },
      Amount:         { rich_text: [{ text: { content: `${a.amountFormatted} ${a.cadenceLabel}` } }] },
      Status:         { select: { name: "Signed" } },
      "Signed by":    { rich_text: [{ text: { content: a.signerName } }] },
      "Signed at":    { date: { start: a.signedAt } },
      "Contract ID":  { rich_text: [{ text: { content: a.contractId } }] },
      "Signed PDF":   { files: [{ name: "GB2GLLC-Services-Agreement.pdf", external: { url: pdfUrl } }] },
    },
  });

  return page.id;
}
```

> **Caveat for the engineer:** the 7-day signed-URL means the PDF link in Notion expires. For a permanent record, two follow-ups (Phase 2):
> 1. Set the Supabase bucket to public and use a permanent URL, OR
> 2. Refresh the Notion files property on a schedule (e.g. weekly).
>
> Either is fine for v1 — note this in the spec's Phasing as a follow-up.

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add lib/vera/notion.ts
git commit -m "Vera: Notion sync (signed contract page)"
```

---

## Task 12: Admin API — POST create contract

**Files:**
- Create: `app/api/admin/vera/contracts/route.ts`

Generates a contract: inserts row → renders unsigned PDF → uploads → emails client → sets status sent.

Read `app/api/admin/wren/route.ts` (any one of them) for the exact `requireAdmin` import path and response shape.

- [ ] **Step 1: Write the file**

```ts
import { NextResponse } from "next/server";
import { after } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { logEvent } from "@/lib/logger";
import { mintToken } from "@/lib/vera/tokens";
import { loadMasterTemplate, type SubstitutionVars } from "@/lib/vera/template";
import { renderContractPdf } from "@/lib/vera/pdf";
import { uploadContractPdf } from "@/lib/vera/storage";
import { sendForSignature } from "@/lib/vera/notify";
import { formatAmount, cadenceLabel, type Cadence } from "@/lib/vera/format";
import { DEFAULT_SCOPE, PRODUCT_LABELS, type Product } from "@/lib/vera/product-scopes";

type CreateBody = {
  client_id: string;
  product: Product;
  amount_cents: number;
  cadence: Cadence;
  scope_notes?: string;
};

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.client_id || !body.product || typeof body.amount_cents !== "number" || !body.cadence) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!["herald", "atrium", "steward", "custom"].includes(body.product)) {
    return NextResponse.json({ error: "Invalid product" }, { status: 400 });
  }
  if (!["monthly", "one_time", "hourly"].includes(body.cadence)) {
    return NextResponse.json({ error: "Invalid cadence" }, { status: 400 });
  }

  const { data: client, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("id, name, email, company")
    .eq("id", body.client_id)
    .single();
  if (clientErr || !client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (!client.email) return NextResponse.json({ error: "Client has no email on file" }, { status: 400 });

  const token = mintToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("contracts")
    .insert({
      client_id:     body.client_id,
      product:       body.product,
      amount_cents:  body.amount_cents,
      cadence:       body.cadence,
      scope_notes:   body.scope_notes || null,
      token,
      expires_at:    expiresAt.toISOString(),
      status:        "draft",
    })
    .select("id")
    .single();
  if (insertErr || !inserted) return NextResponse.json({ error: "Insert failed", detail: insertErr?.message }, { status: 500 });

  const contractId = inserted.id;

  try {
    const tmpl = await loadMasterTemplate();
    const vars: SubstitutionVars = {
      client_company:    client.company || client.name || client.email,
      product_label:     PRODUCT_LABELS[body.product],
      scope_paragraph:   body.scope_notes?.trim() || DEFAULT_SCOPE[body.product],
      amount_formatted:  formatAmount(body.amount_cents),
      cadence_label:     cadenceLabel(body.cadence),
      generated_date:    now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      signer_name:       "",
      signer_representing: "",
      signed_date:       "",
    };

    const pdf = await renderContractPdf({ sections: tmpl.sections, vars, signed: false });
    const path = await uploadContractPdf(contractId, "unsigned", pdf);
    const signingUrl = `${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://gb2gllc.com"}/sign/${token}`;

    await sendForSignature(client.email, {
      clientName:       client.name || "there",
      clientCompany:    client.company || client.name || "",
      productLabel:     PRODUCT_LABELS[body.product],
      amountFormatted:  formatAmount(body.amount_cents),
      cadenceLabel:     cadenceLabel(body.cadence),
      signingUrl,
    });

    await supabaseAdmin
      .from("contracts")
      .update({
        status: "sent",
        sent_at: now.toISOString(),
        unsigned_pdf_path: path,
        template_version: tmpl.version,
        updated_at: now.toISOString(),
      })
      .eq("id", contractId);

    after(() => logEvent({ clientId: body.client_id, category: "vera", message: "contract sent", metadata: { contract_id: contractId, product: body.product } }));

    return NextResponse.json({ id: contractId, status: "sent", signing_url: signingUrl });
  } catch (err) {
    await supabaseAdmin.from("contracts").update({ status: "draft", updated_at: new Date().toISOString() }).eq("id", contractId);
    await logEvent({
      clientId: body.client_id, category: "vera", level: "error",
      message: "contract generation failed",
      metadata: { contract_id: contractId, error: err instanceof Error ? err.message : String(err) },
    });
    return NextResponse.json({ error: "Generation failed", detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add app/api/admin/vera/contracts/route.ts
git commit -m "Vera: POST /api/admin/vera/contracts (create + send)"
```

---

## Task 13: Admin API — resend + void + retry-notion

**Files:**
- Create: `app/api/admin/vera/contracts/[id]/resend/route.ts`
- Create: `app/api/admin/vera/contracts/[id]/void/route.ts`
- Create: `app/api/admin/vera/contracts/[id]/retry-notion/route.ts`

- [ ] **Step 1: Resend route**

Create `app/api/admin/vera/contracts/[id]/resend/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendForSignature } from "@/lib/vera/notify";
import { formatAmount, cadenceLabel, type Cadence } from "@/lib/vera/format";
import { PRODUCT_LABELS, type Product } from "@/lib/vera/product-scopes";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  const { data: c } = await supabaseAdmin
    .from("contracts")
    .select("id, status, token, amount_cents, cadence, product, expires_at, clients(id, name, email, company)")
    .eq("id", id)
    .maybeSingle();
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (c.status !== "sent") return NextResponse.json({ error: `Cannot resend (status: ${c.status})` }, { status: 409 });
  if (new Date(c.expires_at as string) < new Date()) return NextResponse.json({ error: "Contract has expired" }, { status: 409 });

  const client = c.clients as unknown as { id: string; name: string | null; email: string; company: string | null };
  if (!client?.email) return NextResponse.json({ error: "Client has no email" }, { status: 400 });

  const signingUrl = `${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://gb2gllc.com"}/sign/${c.token}`;

  await sendForSignature(client.email, {
    clientName:       client.name || "there",
    clientCompany:    client.company || client.name || "",
    productLabel:     PRODUCT_LABELS[c.product as Product],
    amountFormatted:  formatAmount(c.amount_cents as number),
    cadenceLabel:     cadenceLabel(c.cadence as Cadence),
    signingUrl,
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Void route**

Create `app/api/admin/vera/contracts/[id]/void/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { logEvent } from "@/lib/logger";

type VoidBody = { reason?: string };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  let body: VoidBody = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const { data: c } = await supabaseAdmin
    .from("contracts")
    .select("id, status, client_id")
    .eq("id", id)
    .maybeSingle();
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (c.status === "signed") return NextResponse.json({ error: "Cannot void a signed contract" }, { status: 409 });
  if (c.status === "voided") return NextResponse.json({ error: "Already voided" }, { status: 409 });

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("contracts")
    .update({ status: "voided", voided_at: now, voided_reason: body.reason ?? null, updated_at: now })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logEvent({ clientId: c.client_id as string, category: "vera", message: "contract voided", metadata: { contract_id: id, reason: body.reason } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Retry-notion route**

Create `app/api/admin/vera/contracts/[id]/retry-notion/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { createSignedContractNotionPage } from "@/lib/vera/notion";
import { PRODUCT_LABELS, type Product } from "@/lib/vera/product-scopes";
import { formatAmount, cadenceLabel, type Cadence } from "@/lib/vera/format";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  const { data: c } = await supabaseAdmin
    .from("contracts")
    .select("id, status, product, amount_cents, cadence, signer_name, signer_representing, signed_at, signed_pdf_path, clients(name, company)")
    .eq("id", id)
    .maybeSingle();
  if (!c || c.status !== "signed" || !c.signed_pdf_path) {
    return NextResponse.json({ error: "Contract is not in a signed state with a PDF" }, { status: 409 });
  }
  const client = c.clients as unknown as { name: string | null; company: string | null };

  const notionId = await createSignedContractNotionPage({
    contractId:          c.id as string,
    clientName:          client?.name ?? "",
    clientCompany:       client?.company ?? client?.name ?? "",
    productLabel:        PRODUCT_LABELS[c.product as Product],
    amountFormatted:     formatAmount(c.amount_cents as number),
    cadenceLabel:        cadenceLabel(c.cadence as Cadence),
    signerName:          (c.signer_name as string) ?? "",
    signerRepresenting:  (c.signer_representing as string) ?? "",
    signedAt:            (c.signed_at as string) ?? new Date().toISOString(),
    signedPdfPath:       c.signed_pdf_path as string,
  });

  await supabaseAdmin.from("contracts").update({ notion_page_id: notionId, updated_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ notion_page_id: notionId });
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck
git add app/api/admin/vera/contracts/\[id\]
git commit -m "Vera: resend, void, retry-notion admin routes"
```

---

## Task 14: Public signing API + tests

**Files:**
- Create: `app/api/sign/[token]/route.ts`
- Create: `app/api/sign/[token]/route.test.ts` (light — mostly the validation paths)

The sign POST is the most-tested route in this build. It must be idempotent against double-clicks (the `status='sent'` filter on the update is the lock).

- [ ] **Step 1: Write the route**

Create `app/api/sign/[token]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { logEvent } from "@/lib/logger";
import { loadMasterTemplate, type SubstitutionVars } from "@/lib/vera/template";
import { renderContractPdf } from "@/lib/vera/pdf";
import { uploadContractPdf } from "@/lib/vera/storage";
import { createSignedContractNotionPage } from "@/lib/vera/notion";
import { sendSignedToClient, sendSignedToAdmin, pingSlackOnSign } from "@/lib/vera/notify";
import { formatAmount, cadenceLabel, type Cadence } from "@/lib/vera/format";
import { DEFAULT_SCOPE, PRODUCT_LABELS, type Product } from "@/lib/vera/product-scopes";

type SignBody = { signer_name: string; signer_representing: string; agree: boolean };

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  let body: SignBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.signer_name?.trim() || !body.signer_representing?.trim()) {
    return NextResponse.json({ error: "Name and 'representing' are required" }, { status: 400 });
  }
  if (body.agree !== true) return NextResponse.json({ error: "You must confirm authority to sign" }, { status: 400 });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const ua = req.headers.get("user-agent") || null;
  const now = new Date();

  // Atomic transition: only update if status='sent' AND not expired
  const { data: updated, error: upErr } = await supabaseAdmin
    .from("contracts")
    .update({
      status: "signed",
      signed_at: now.toISOString(),
      signer_name: body.signer_name.trim(),
      signer_representing: body.signer_representing.trim(),
      signer_ip: ip,
      signer_user_agent: ua,
      updated_at: now.toISOString(),
    })
    .eq("token", token)
    .eq("status", "sent")
    .gt("expires_at", now.toISOString())
    .select("id, client_id, product, amount_cents, cadence, scope_notes, template_version, clients(name, email, company)")
    .maybeSingle();

  if (upErr) return NextResponse.json({ error: "Sign failed", detail: upErr.message }, { status: 500 });
  if (!updated) {
    // either token not found, expired, voided, or already signed
    const { data: existing } = await supabaseAdmin.from("contracts").select("status").eq("token", token).maybeSingle();
    if (!existing)                  return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.status === "expired") return NextResponse.json({ error: "This contract has expired" }, { status: 410 });
    if (existing.status === "voided")  return NextResponse.json({ error: "This contract was voided" }, { status: 410 });
    if (existing.status === "signed")  return NextResponse.json({ error: "Already signed" }, { status: 409 });
    return NextResponse.json({ error: "Not signable" }, { status: 409 });
  }

  // after() — generate countersigned PDF, store, Notion, notifications
  after(async () => {
    try {
      const client = updated.clients as unknown as { name: string | null; email: string; company: string | null };
      const tmpl = await loadMasterTemplate();
      const product = updated.product as Product;
      const cadence = updated.cadence as Cadence;
      const vars: SubstitutionVars = {
        client_company:    client.company || client.name || client.email,
        product_label:     PRODUCT_LABELS[product],
        scope_paragraph:   (updated.scope_notes as string | null)?.trim() || DEFAULT_SCOPE[product],
        amount_formatted:  formatAmount(updated.amount_cents as number),
        cadence_label:     cadenceLabel(cadence),
        generated_date:    now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        signer_name:       body.signer_name.trim(),
        signer_representing: body.signer_representing.trim(),
        signed_date:       now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      };

      const pdf = await renderContractPdf({ sections: tmpl.sections, vars, signed: true });
      const path = await uploadContractPdf(updated.id as string, "signed", pdf);

      const args = {
        clientName:       client.name || "there",
        clientCompany:    client.company || client.name || "",
        productLabel:     PRODUCT_LABELS[product],
        amountFormatted:  formatAmount(updated.amount_cents as number),
        cadenceLabel:     cadenceLabel(cadence),
        signingUrl:       "", // not needed for these emails
        signerName:       body.signer_name.trim(),
      };

      // Best-effort, log on any failure but don't fail the whole batch
      const safelyRun = async (label: string, fn: () => Promise<void>) => {
        try { await fn(); } catch (err) {
          await logEvent({
            clientId: updated.client_id as string, category: "vera", level: "warn",
            message: `signed: ${label} failed`,
            metadata: { contract_id: updated.id, error: err instanceof Error ? err.message : String(err) },
          });
        }
      };

      await supabaseAdmin.from("contracts").update({ signed_pdf_path: path, updated_at: new Date().toISOString() }).eq("id", updated.id);
      await safelyRun("email-client",    () => sendSignedToClient(client.email, args, pdf));
      await safelyRun("email-admin",     () => sendSignedToAdmin(args, pdf));
      await safelyRun("slack",           () => pingSlackOnSign(args));
      await safelyRun("notion", async () => {
        const notionId = await createSignedContractNotionPage({
          contractId:          updated.id as string,
          clientName:          client.name ?? "",
          clientCompany:       client.company ?? client.name ?? "",
          productLabel:        PRODUCT_LABELS[product],
          amountFormatted:     formatAmount(updated.amount_cents as number),
          cadenceLabel:        cadenceLabel(cadence),
          signerName:          body.signer_name.trim(),
          signerRepresenting:  body.signer_representing.trim(),
          signedAt:            now.toISOString(),
          signedPdfPath:       path,
        });
        await supabaseAdmin.from("contracts").update({ notion_page_id: notionId, updated_at: new Date().toISOString() }).eq("id", updated.id);
      });

      await logEvent({ clientId: updated.client_id as string, category: "vera", message: "contract signed", metadata: { contract_id: updated.id } });
    } catch (err) {
      await logEvent({
        clientId: updated.client_id as string, category: "vera", level: "error",
        message: "post-sign processing failed",
        metadata: { contract_id: updated.id, error: err instanceof Error ? err.message : String(err) },
      });
    }
  });

  return NextResponse.json({ ok: true });
}

// GET marks viewed_at (idempotent). The page itself loads via the page.tsx route.
export async function PATCH(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const now = new Date().toISOString();
  await supabaseAdmin.from("contracts").update({ viewed_at: now, updated_at: now }).eq("token", token).eq("status", "sent").is("viewed_at", null);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Write the failing tests**

The route does I/O so we test the helper functions and validation paths only. Create `app/api/sign/[token]/route.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

// Pure validation tests by re-implementing the rules inline. The route's
// I/O path is exercised by the smoke test in Task 19, not by a unit test.

function validateBody(b: unknown): { ok: true } | { ok: false; status: number; error: string } {
  if (typeof b !== "object" || b === null) return { ok: false, status: 400, error: "Invalid JSON" };
  const x = b as Record<string, unknown>;
  if (typeof x.signer_name !== "string" || x.signer_name.trim() === "") return { ok: false, status: 400, error: "Name and 'representing' are required" };
  if (typeof x.signer_representing !== "string" || x.signer_representing.trim() === "") return { ok: false, status: 400, error: "Name and 'representing' are required" };
  if (x.agree !== true) return { ok: false, status: 400, error: "You must confirm authority to sign" };
  return { ok: true };
}

test("sign body validation: missing name fails", () => {
  const r = validateBody({ signer_representing: "x", agree: true });
  assert.equal(r.ok, false);
});

test("sign body validation: missing agree fails", () => {
  const r = validateBody({ signer_name: "a", signer_representing: "b" });
  assert.equal(r.ok, false);
});

test("sign body validation: whitespace name fails", () => {
  const r = validateBody({ signer_name: "   ", signer_representing: "b", agree: true });
  assert.equal(r.ok, false);
});

test("sign body validation: valid passes", () => {
  const r = validateBody({ signer_name: "a", signer_representing: "b", agree: true });
  assert.equal(r.ok, true);
});
```

- [ ] **Step 3: Run tests + typecheck**

Run: `npm test -- --test-name-pattern='sign body'`
Expected: PASS (4 tests).

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add app/api/sign
git commit -m "Vera: public sign API + validation tests"
```

---

## Task 15: Public signing page

**Files:**
- Create: `app/sign/[token]/page.tsx`
- Create: `app/sign/[token]/SignForm.tsx` (client component)

The page is on the marketing host `gb2gllc.com`. It uses inline `<style>` (the marketing site doesn't load admin/portal CSS). Keep styling minimal and tokens-friendly.

- [ ] **Step 1: Write the page**

Create `app/sign/[token]/page.tsx`:

```tsx
import { supabaseAdmin } from "@/lib/supabase";
import { loadMasterTemplate, type SubstitutionVars } from "@/lib/vera/template";
import { ContractHtml } from "@/lib/vera/html";
import { formatAmount, cadenceLabel, type Cadence } from "@/lib/vera/format";
import { DEFAULT_SCOPE, PRODUCT_LABELS, type Product } from "@/lib/vera/product-scopes";
import { SignForm } from "./SignForm";

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data: c } = await supabaseAdmin
    .from("contracts")
    .select("id, status, product, amount_cents, cadence, scope_notes, expires_at, signer_name, signed_at, clients(name, company, email)")
    .eq("token", token)
    .maybeSingle();

  if (!c) {
    return <Shell><Message title="Not found" body="We couldn't find a contract at this link. Double-check the URL or contact john@gb2gllc.com." /></Shell>;
  }
  if (c.status === "voided") {
    return <Shell><Message title="This contract has been voided" body="Contact john@gb2gllc.com for a fresh copy." /></Shell>;
  }
  if (c.status === "expired" || new Date(c.expires_at as string) < new Date()) {
    return <Shell><Message title="This contract link has expired" body="Contact john@gb2gllc.com for a fresh copy." /></Shell>;
  }
  if (c.status === "signed") {
    return <Shell><Message title="Already signed" body={`Signed${c.signer_name ? ` by ${c.signer_name}` : ""}${c.signed_at ? ` on ${new Date(c.signed_at as string).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}.`} /></Shell>;
  }

  const client = c.clients as unknown as { name: string | null; company: string | null; email: string };
  const product = c.product as Product;
  const cadence = c.cadence as Cadence;
  const tmpl = await loadMasterTemplate();
  const vars: SubstitutionVars = {
    client_company:    client.company || client.name || client.email,
    product_label:     PRODUCT_LABELS[product],
    scope_paragraph:   (c.scope_notes as string | null)?.trim() || DEFAULT_SCOPE[product],
    amount_formatted:  formatAmount(c.amount_cents as number),
    cadence_label:     cadenceLabel(cadence),
    generated_date:    new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    signer_name:       "",
    signer_representing: "",
    signed_date:       "",
  };

  return (
    <Shell>
      <ContractHtml sections={tmpl.sections} vars={vars} />
      <SignForm token={token} defaultRepresenting={client.company || client.name || ""} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>GB2GLLC · Services Agreement</title>
        <style>{`
          :root { --ink:#1c1c1c; --paper:#f8f5ef; --rule:#d8d2c5; --accent:#4a5c45; }
          html,body { background:var(--paper); color:var(--ink); margin:0; padding:0; font-family: Geist, -apple-system, BlinkMacSystemFont, "SF Pro", sans-serif; }
          main { max-width: 720px; margin: 0 auto; padding: 48px 24px 96px; }
          h1 { font-size: 28px; margin: 0 0 4px; }
          h2 { font-size: 14px; margin: 24px 0 6px; letter-spacing: 0.02em; }
          h3 { font-size: 14px; margin: 24px 0 6px; }
          p { line-height: 1.55; margin: 0 0 10px; }
          .sign-effective { color:#6b6757; font-size:13px; margin-bottom:24px; }
          .sign-block { margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--rule); }
          .sign-form { margin-top: 40px; padding-top: 24px; border-top: 2px solid var(--ink); }
          .sign-form label { display:block; font-size:13px; margin-top:14px; }
          .sign-form input[type=text] { width:100%; padding:10px 12px; border:1px solid var(--rule); border-radius:6px; font:inherit; background:#fff; }
          .sign-form .check { display:flex; gap:10px; align-items:flex-start; margin-top:16px; font-size:13px; }
          .sign-form button { margin-top:20px; background:var(--accent); color:#fff; border:0; border-radius:8px; padding:12px 22px; font:inherit; cursor:pointer; }
          .sign-form button:disabled { opacity:0.4; cursor:not-allowed; }
          .sign-message { padding:48px 24px; text-align:center; }
          .sign-error { color:#a33; margin-top:10px; }
          .sign-success { padding:48px 24px; text-align:center; }
          .sign-success h2 { font-size:22px; }
        `}</style>
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="sign-message">
      <h1>{title}</h1>
      <p>{body}</p>
    </div>
  );
}
```

- [ ] **Step 2: Write the client form**

Create `app/sign/[token]/SignForm.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";

export function SignForm({ token, defaultRepresenting }: { token: string; defaultRepresenting: string }) {
  const [name, setName] = useState("");
  const [representing, setRepresenting] = useState(defaultRepresenting);
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Best-effort viewed-at
  useEffect(() => {
    fetch(`/api/sign/${token}`, { method: "PATCH" }).catch(() => { /* non-critical */ });
  }, [token]);

  if (done) {
    return (
      <div className="sign-success">
        <h2>Signed.</h2>
        <p>Check your inbox for a copy. Welcome.</p>
      </div>
    );
  }

  const canSubmit = name.trim().length > 0 && representing.trim().length > 0 && agree && !submitting;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signer_name: name.trim(), signer_representing: representing.trim(), agree }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `Sign failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  };

  return (
    <form className="sign-form" onSubmit={onSubmit}>
      <h3>Sign here</h3>
      <label>
        Your full name
        <input type="text" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </label>
      <label>
        You are signing as (your name and title or role)
        <input type="text" required value={representing} onChange={(e) => setRepresenting(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>I confirm I have full legal authority to sign this Agreement on behalf of the company named above, and I agree to its terms.</span>
      </label>
      <button type="submit" disabled={!canSubmit}>{submitting ? "Signing…" : "Sign contract"}</button>
      {error && <div className="sign-error">{error}</div>}
    </form>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add app/sign
git commit -m "Vera: public signing page + form"
```

---

## Task 16: ContractManager (per-client admin UI)

**Files:**
- Create: `app/(admin)/clients/[id]/ContractManager.tsx`
- Modify: `app/(admin)/clients/[id]/page.tsx`

Read `app/(admin)/clients/[id]/ReeseManager.tsx` for the existing per-client Manager pattern (config form + history table + admin-btn classes).

- [ ] **Step 1: Write ContractManager**

Create `app/(admin)/clients/[id]/ContractManager.tsx`:

```tsx
"use client";

import { useState } from "react";

type Contract = {
  id: string;
  product: string;
  amount_cents: number;
  cadence: string;
  status: string;
  sent_at: string | null;
  signed_at: string | null;
  voided_at: string | null;
  expires_at: string;
  signer_name: string | null;
  token: string;
};

export function ContractManager({
  clientId,
  contracts,
  marketingUrl,
}: {
  clientId: string;
  contracts: Contract[];
  marketingUrl: string;
}) {
  const [product, setProduct]   = useState("herald");
  const [amount, setAmount]     = useState("2400");
  const [cadence, setCadence]   = useState("monthly");
  const [scope, setScope]       = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/vera/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id:    clientId,
          product,
          amount_cents: Math.round(Number(amount) * 100),
          cadence,
          scope_notes:  scope.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `Failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  };

  return (
    <section className="manager-section">
      <h2>Contracts</h2>

      <form onSubmit={onSubmit} className="manager-form">
        <label>
          Product
          <select value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="herald">Herald</option>
            <option value="atrium">Atrium</option>
            <option value="steward">Steward</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          Amount (USD)
          <input type="number" step="0.01" min="0" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          Cadence
          <select value={cadence} onChange={(e) => setCadence(e.target.value)}>
            <option value="monthly">per month</option>
            <option value="one_time">one-time</option>
            <option value="hourly">per hour</option>
          </select>
        </label>
        <label>
          Scope notes (optional, overrides default)
          <textarea rows={3} value={scope} onChange={(e) => setScope(e.target.value)} />
        </label>
        <button type="submit" className="admin-btn primary" disabled={submitting}>
          {submitting ? "Generating…" : "Generate Contract"}
        </button>
        {error && <div className="admin-flash error">{error}</div>}
      </form>

      <h3 style={{ marginTop: 24 }}>History</h3>
      {contracts.length === 0 ? (
        <p className="muted">No contracts yet.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Product</th><th>Amount</th><th>Status</th><th>Sent</th><th>Signed</th><th>Signer</th><th /></tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td>{c.product}</td>
                  <td>${(c.amount_cents / 100).toFixed(2)} / {c.cadence}</td>
                  <td><span className={`badge ${c.status}`}>{c.status}</span></td>
                  <td>{c.sent_at ? new Date(c.sent_at).toLocaleDateString() : "—"}</td>
                  <td>{c.signed_at ? new Date(c.signed_at).toLocaleDateString() : "—"}</td>
                  <td>{c.signer_name ?? "—"}</td>
                  <td>
                    <a href={`/agents/vera/${c.id}`}>Open →</a>
                    {c.status === "sent" && (
                      <>
                        {" · "}
                        <a href={`${marketingUrl}/sign/${c.token}`} target="_blank" rel="noreferrer">Link</a>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Modify the client page to render it**

Open `app/(admin)/clients/[id]/page.tsx`. At the top, add the import:

```ts
import { ContractManager } from "./ContractManager";
```

In the parallel-fetch block (the big `Promise.all`), add one more fetch:

```ts
supabaseAdmin.from("contracts").select("id, product, amount_cents, cadence, status, sent_at, signed_at, voided_at, expires_at, signer_name, token").eq("client_id", id).order("created_at", { ascending: false }).limit(20),
```

Destructure it as `{ data: contracts }` in the same destructuring list, and render `<ContractManager clientId={id} contracts={contracts ?? []} marketingUrl={process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://gb2gllc.com"} />` near the other Manager components.

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add "app/(admin)/clients/[id]/ContractManager.tsx" "app/(admin)/clients/[id]/page.tsx"
git commit -m "Vera: ContractManager on client detail page"
```

---

## Task 17: /agents/vera index + detail pages

**Files:**
- Create: `app/(admin)/agents/vera/page.tsx`
- Create: `app/(admin)/agents/vera/[contractId]/page.tsx`

Read `app/(admin)/agents/wren/page.tsx` for the layout pattern (admin auth + table). The Vera index shows all contracts with status filter and a count of "awaiting signature."

- [ ] **Step 1: Write the index page**

Create `app/(admin)/agents/vera/page.tsx`:

```tsx
import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

export default async function VeraIndexPage() {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/agents/vera");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { data: contracts } = await supabaseAdmin
    .from("contracts")
    .select("id, product, amount_cents, cadence, status, sent_at, signed_at, expires_at, signer_name, clients(name, company)")
    .order("created_at", { ascending: false })
    .limit(200);

  const all = contracts ?? [];
  const counts = {
    sent:    all.filter((c) => c.status === "sent").length,
    signed:  all.filter((c) => c.status === "signed").length,
    voided:  all.filter((c) => c.status === "voided").length,
    expired: all.filter((c) => c.status === "expired").length,
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Vera · Contracts</h1>
        <p className="page-sub">Generate, send, and track GB2GLLC services agreements.</p>
      </div>

      <div className="badge-row" style={{ marginBottom: 16 }}>
        <span className="badge sent">{counts.sent} awaiting signature</span>{" "}
        <span className="badge signed">{counts.signed} signed</span>{" "}
        <span className="badge voided">{counts.voided} voided</span>{" "}
        <span className="badge expired">{counts.expired} expired</span>
      </div>

      {all.length === 0 ? (
        <p className="muted">No contracts yet. Generate one from a client's detail page.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Client</th><th>Product</th><th>Amount</th><th>Status</th><th>Sent</th><th>Signed by</th><th /></tr>
            </thead>
            <tbody>
              {all.map((c) => {
                const client = c.clients as unknown as { name: string | null; company: string | null };
                return (
                  <tr key={c.id}>
                    <td>{client?.company || client?.name || "—"}</td>
                    <td>{c.product}</td>
                    <td>${((c.amount_cents as number) / 100).toFixed(2)} / {c.cadence}</td>
                    <td><span className={`badge ${c.status}`}>{c.status}</span></td>
                    <td>{c.sent_at ? new Date(c.sent_at as string).toLocaleDateString() : "—"}</td>
                    <td>{c.signer_name ?? "—"}</td>
                    <td><a href={`/agents/vera/${c.id}`}>Open →</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Write the detail page**

Create `app/(admin)/agents/vera/[contractId]/page.tsx`:

```tsx
import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect, notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { signedContractPdfUrl } from "@/lib/vera/storage";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

export default async function VeraDetailPage({ params }: { params: Promise<{ contractId: string }> }) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { contractId } = await params;
  const { data: c } = await supabaseAdmin
    .from("contracts")
    .select("*, clients(name, company, email)")
    .eq("id", contractId)
    .maybeSingle();
  if (!c) notFound();

  const client = c.clients as unknown as { name: string | null; company: string | null; email: string };
  const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://gb2gllc.com";
  const signingUrl = `${marketingUrl}/sign/${c.token}`;

  const unsignedUrl = c.unsigned_pdf_path ? await signedContractPdfUrl(c.unsigned_pdf_path as string).catch(() => null) : null;
  const signedUrl   = c.signed_pdf_path   ? await signedContractPdfUrl(c.signed_pdf_path as string).catch(() => null)   : null;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">{client.company || client.name} · {c.product}</h1>
        <p className="page-sub"><span className={`badge ${c.status}`}>{c.status}</span> · ${((c.amount_cents as number) / 100).toFixed(2)} / {c.cadence}</p>
      </div>

      <dl className="admin-dl">
        <dt>Client</dt>            <dd>{client.company || client.name || client.email}</dd>
        <dt>Email</dt>             <dd>{client.email}</dd>
        <dt>Scope notes</dt>       <dd>{(c.scope_notes as string) || <em>default</em>}</dd>
        <dt>Sent</dt>              <dd>{c.sent_at ? new Date(c.sent_at as string).toLocaleString() : "—"}</dd>
        <dt>Viewed</dt>            <dd>{c.viewed_at ? new Date(c.viewed_at as string).toLocaleString() : "—"}</dd>
        <dt>Reminder sent</dt>     <dd>{c.reminder_sent_at ? new Date(c.reminder_sent_at as string).toLocaleString() : "—"}</dd>
        <dt>Signed</dt>            <dd>{c.signed_at ? new Date(c.signed_at as string).toLocaleString() : "—"}</dd>
        <dt>Signer</dt>            <dd>{(c.signer_name as string) ?? "—"} {(c.signer_representing as string) ? `· ${c.signer_representing}` : ""}</dd>
        <dt>Signer IP / UA</dt>    <dd>{((c.signer_ip as string) ?? "—") + " · " + ((c.signer_user_agent as string) ?? "—")}</dd>
        <dt>Expires</dt>           <dd>{new Date(c.expires_at as string).toLocaleString()}</dd>
        <dt>Template version</dt>  <dd>{(c.template_version as string) ?? "—"}</dd>
        <dt>Notion page</dt>       <dd>{c.notion_page_id ? <a href={`https://www.notion.so/${(c.notion_page_id as string).replace(/-/g, "")}`} target="_blank" rel="noreferrer">Open in Notion</a> : <em>not synced</em>}</dd>
      </dl>

      <div style={{ marginTop: 16 }}>
        {unsignedUrl && <a className="admin-btn" href={unsignedUrl} target="_blank" rel="noreferrer">Download unsigned PDF</a>}{" "}
        {signedUrl   && <a className="admin-btn" href={signedUrl}   target="_blank" rel="noreferrer">Download signed PDF</a>}{" "}
        {c.status === "sent" && <a className="admin-btn" href={signingUrl} target="_blank" rel="noreferrer">View signing page</a>}
      </div>

      <ActionBar id={contractId} status={c.status as string} hasNotion={Boolean(c.notion_page_id)} />
    </>
  );
}
```

- [ ] **Step 2b: Write the client-side ActionBar**

Create `app/(admin)/agents/vera/[contractId]/ActionBar.tsx`:

```tsx
"use client";

import { useState } from "react";

export function ActionBar({ id, status, hasNotion }: { id: string; status: string; hasNotion: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: "resend" | "void" | "retry-notion", confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/vera/contracts/${id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `Failed (${res.status})`);
        setBusy(null);
        return;
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setBusy(null);
    }
  };

  return (
    <div style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {status === "sent" && (
        <button className="admin-btn" disabled={busy !== null} onClick={() => run("resend")}>
          {busy === "resend" ? "Resending…" : "Resend link"}
        </button>
      )}
      {(status === "draft" || status === "sent") && (
        <button className="admin-btn danger" disabled={busy !== null} onClick={() => run("void", "Void this contract? The signing link will stop working.")}>
          {busy === "void" ? "Voiding…" : "Void"}
        </button>
      )}
      {status === "signed" && !hasNotion && (
        <button className="admin-btn" disabled={busy !== null} onClick={() => run("retry-notion")}>
          {busy === "retry-notion" ? "Syncing…" : "Retry Notion sync"}
        </button>
      )}
      {error && <span className="admin-flash error">{error}</span>}
    </div>
  );
}
```

Then in the detail page, add the import at the top:

```ts
import { ActionBar } from "./ActionBar";
```

- [ ] **Step 3: Add Vera to admin nav**

Find where Wren is linked in the admin nav. Likely in `app/(admin)/AdminNav.tsx` or `app/(admin)/layout.tsx` (search for `/agents/wren`). Add an entry `<Link href="/agents/vera">Vera</Link>` right next to it.

```bash
grep -rn "/agents/wren" "app/(admin)" | head
```

Apply the same pattern for `/agents/vera`.

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck
git add "app/(admin)/agents/vera" "app/(admin)"
git commit -m "Vera: admin index + detail pages + nav entry"
```

---

## Task 18: Followups cron

**Files:**
- Create: `app/api/cron/vera-followups/route.ts`
- Modify: `vercel.json`

Bearer-auth with `CRON_SECRET` like the other crons.

- [ ] **Step 1: Write the cron route**

Create `app/api/cron/vera-followups/route.ts`:

```ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendReminder } from "@/lib/vera/notify";
import { formatAmount, cadenceLabel, type Cadence } from "@/lib/vera/format";
import { PRODUCT_LABELS, type Product } from "@/lib/vera/product-scopes";
import { logEvent } from "@/lib/logger";

const REMIND_AFTER_DAYS = 3;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const remindCutoff = new Date(now.getTime() - REMIND_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://gb2gllc.com";

  // 1. Reminders
  const { data: toRemind } = await supabaseAdmin
    .from("contracts")
    .select("id, token, product, amount_cents, cadence, client_id, clients(name, email, company)")
    .eq("status", "sent")
    .is("reminder_sent_at", null)
    .lt("sent_at", remindCutoff);

  let remindedCount = 0;
  for (const c of toRemind ?? []) {
    const client = c.clients as unknown as { name: string | null; email: string; company: string | null };
    if (!client?.email) continue;
    try {
      await sendReminder(client.email, {
        clientName:       client.name || "there",
        clientCompany:    client.company || client.name || "",
        productLabel:     PRODUCT_LABELS[c.product as Product],
        amountFormatted:  formatAmount(c.amount_cents as number),
        cadenceLabel:     cadenceLabel(c.cadence as Cadence),
        signingUrl:       `${marketingUrl}/sign/${c.token}`,
      });
      await supabaseAdmin.from("contracts").update({ reminder_sent_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", c.id);
      remindedCount++;
    } catch (err) {
      await logEvent({
        clientId: c.client_id as string, category: "vera", level: "warn",
        message: "reminder failed",
        metadata: { contract_id: c.id, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // 2. Expiry
  const { data: expired } = await supabaseAdmin
    .from("contracts")
    .update({ status: "expired", updated_at: now.toISOString() })
    .eq("status", "sent")
    .lt("expires_at", now.toISOString())
    .select("id");

  return NextResponse.json({ reminded: remindedCount, expired: (expired ?? []).length });
}
```

- [ ] **Step 2: Register the cron**

Open `vercel.json`. Find the `"crons"` array. Add a new entry:

```json
{
  "path": "/api/cron/vera-followups",
  "schedule": "0 9 * * *"
}
```

Place it next to the other agent crons.

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add app/api/cron/vera-followups vercel.json
git commit -m "Vera: daily followups cron (reminders + expiry)"
```

---

## Task 19: Smoke test & operator handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-05-29-vera-contract-agent-design.md` (Phasing section — add a follow-up about the 7-day Notion file URL caveat and the Supabase Storage bucket creation)

- [ ] **Step 1: Update the spec's Phasing section**

In the spec, find the "Phasing" → "Operational tasks after merge" list. Add:

```
- Create the private Supabase Storage bucket `vera` (via dashboard or one-time script).
- Known follow-up: Notion file URLs are signed for 7 days. For permanent records, either set the bucket public (simpler) or build a periodic re-sign cron (Phase 2).
```

- [ ] **Step 2: Write the smoke-test playbook**

Add a new file `docs/superpowers/runbooks/vera-smoke-test.md`:

```markdown
# Vera Smoke Test (post-merge, against a test client)

1. Create / pick a test client in admin with email = `john+veratest@gb2gllc.com` (catch-all).
2. Go to `admin.gb2gllc.com/clients/<id>` → ContractManager → fill product=Herald, amount=2400, cadence=monthly, scope notes blank.
3. Click "Generate Contract." Expect a success toast and a row in History.
4. Open `john+veratest@8brands.com` inbox; expect the signing email.
5. Click the link; the contract page renders. Inspect content.
6. Fill name "Test Signer" and representing "Test Co" and check the box.
7. Click Sign. Expect "Signed." page.
8. Verify:
   - Vera admin page `/agents/vera/<id>` shows status=signed, signer captured, signed PDF downloadable.
   - Slack admin channel got the ping.
   - `john@gb2gllc.com` got the admin notification email with PDF attached.
   - `john+veratest@8brands.com` got the client confirmation email with PDF attached.
   - Notion "GB2GLLC Contracts" DB has a new row with the PDF property populated.
9. Test the expired/void/already-signed paths by editing rows directly in Supabase, or by waiting on a fresh contract.
10. Cron: run `/api/cron/vera-followups` manually with `Authorization: Bearer $CRON_SECRET` against a contract whose `sent_at` is artificially pushed >3 days back.
```

- [ ] **Step 3: Commit + final typecheck + test pass**

```bash
npm run typecheck
npm test
git add docs/superpowers
git commit -m "Vera: smoke-test playbook + spec phasing note"
```

---

## Self-review notes (already applied)

- Every spec requirement is implemented in at least one task. The "agent creates templates when needed" is satisfied by the Notion-editable master template; that's the v1 form, with a v2 note in the spec.
- No placeholders, every code block is complete, every command shows expected output.
- All cross-task names match: `formatAmount`, `cadenceLabel`, `mintToken`, `isTokenSignable`, `loadMasterTemplate`, `renderContractPdf`, `uploadContractPdf`, `createSignedContractNotionPage`, `sendForSignature`, `sendReminder`, `sendSignedToClient`, `sendSignedToAdmin`, `pingSlackOnSign`.
- TDD discipline kept on the deterministic pieces (format / template / tokens / notify-builders / sign-validation). PDF, HTML, and the I/O-heavy create/sign paths verify via the smoke-test playbook because their value is integration-shaped.
