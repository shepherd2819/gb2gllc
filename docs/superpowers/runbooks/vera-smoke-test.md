# Vera Smoke Test (post-merge, against a test client)

Run this after merging `feat/vera` and completing the post-merge operational tasks (see spec Phasing section).

## Pre-flight

1. Confirm migration applied:
   ```bash
   psql "$DATABASE_URL" -c "select count(*) from contracts;"
   ```
   Expect 0 rows, no error.

2. Confirm Supabase Storage bucket exists: `vera` (private).

3. Confirm Vercel env vars set: `NOTION_CONTRACT_TEMPLATE_PAGE_ID`, `NOTION_CONTRACTS_DATABASE_ID`, `VERA_SLACK_CHANNEL` (or `SUPPORT_SLACK_CHANNEL`), optionally `VERA_RESEND_FROM`.

4. Confirm Notion master template page exists with the 9 H2-section headings exactly as named in `lib/vera/master-template-defaults.ts:SECTION_TITLES`. The "GB2GLLC Contracts" DB exists with properties: Name (title), Product (select), Amount (text), Status (select), Signed by (text), Signed at (date), Contract ID (text), Signed PDF (files).

## Generate

1. In admin: pick or create a test client with email `john+veratest@gb2gllc.com` (or any inbox you control).
2. Open `https://admin.gb2gllc.com/clients/<id>` → scroll to **Contracts** → Product=Herald, Amount=2400, Cadence=per month, Scope notes blank.
3. Click **Generate Contract**.
4. Expect the page to reload with one entry in the History table showing status=sent, today's date.

## Verify generation

- Email `john+veratest@gb2gllc.com` should have a "Your GB2GLLC Herald contract is ready to sign" email with a link to `https://gb2gllc.com/sign/<token>`.
- `admin.gb2gllc.com/agents/vera/<contract_id>` should show: status=sent, unsigned PDF downloadable, "View signing page" link.

## Sign

5. Click the signing-page link.
6. Page should render the contract content inline. Read it.
7. Form at bottom: fill name "Test Signer", representing "CEO at Test Co", check the authority box, click **Sign contract**.
8. Page should show "Signed." confirmation.

## Verify signing

- Email `john+veratest@gb2gllc.com`: "Thanks for signing — your GB2GLLC contract" with attached PDF.
- Email `john@gb2gllc.com`: "[Vera] Test Co signed the Herald contract" with PDF attached and Notion link.
- Slack admin channel: ✅ pop-up message naming signer + product + amount.
- Notion "GB2GLLC Contracts" DB: new row with Status=Signed and the PDF property populated (7-day signed URL).
- `admin.gb2gllc.com/agents/vera/<contract_id>`: status=signed, Signer captured, Signer IP/UA captured, signed PDF downloadable, "Open in Notion" link works.

## Negative paths (optional, can be tested by editing rows directly in Supabase)

- **Expired link:** set `expires_at` to past, visit `/sign/<token>` → "This contract link has expired."
- **Voided:** click Void on a sent contract in `/agents/vera/<id>` → status=voided. Visit signing page → "This contract has been voided."
- **Already signed:** revisit a signed contract's signing page → "Already signed by …".
- **Notion failure:** clear `NOTION_CONTRACTS_DATABASE_ID`, sign a fresh contract. PDF + emails + Slack should still go out; the detail page shows "not synced". Click "Retry Notion sync" after restoring the env var.

## Cron (manual trigger)

- Push a contract's `sent_at` to 4 days ago:
  ```sql
  UPDATE contracts SET sent_at = NOW() - INTERVAL '4 days' WHERE id = '<id>';
  ```
- Trigger cron:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://admin.gb2gllc.com/api/cron/vera-followups
  ```
- Expect: `{ "reminded": 1, "expired": 0 }`. A reminder email should arrive at the test address.

- Push the same row's `expires_at` to past:
  ```sql
  UPDATE contracts SET expires_at = NOW() - INTERVAL '1 day' WHERE id = '<id>';
  ```
- Trigger cron again. Expect: `{ "reminded": 0, "expired": 1 }` and the row's status=expired.
