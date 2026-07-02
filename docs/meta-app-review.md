# Meta App Review — Maya (GB2G social agent)

Copy-paste source for the App Review submission at developers.facebook.com → My Apps → [your app] → App Review → Permissions and Features.

App: GB2G Maya
Use case: AI customer-engagement agent for small businesses. Agency-managed.

**Use Cases selected in App Dashboard (App Review → Use Cases):**
1. **Manage messaging & content on Instagram** — covers IG DMs and IG comments.
   Scopes: `instagram_business_manage_messages`, `instagram_business_basic`, `public_profile`, `instagram_manage_comments`, `pages_show_list`, `business_management`
2. **Engage with customers on Messenger from Meta** — covers Facebook Page DMs.
   Scopes: `pages_manage_metadata`, `public_profile`, `pages_messaging`, `pages_show_list`, `business_management`
3. **Manage Page comments on Facebook** — covers Facebook Page comment replies and private-reply DMs.
   Scopes: `pages_manage_engagement`, `pages_messaging`, `pages_show_list`, `business_management`

*(Note: we deliberately do NOT request `pages_read_engagement`. We read FB comment text directly from the webhook payload, never via Graph API GETs, so this scope isn't needed and skipping it shortens the review.)*

**Clear the "0 of 1 API call(s) required" markers FIRST.** Meta gates the Submit button on having made one real API call per gated permission. Use `docs/meta-test-calls.sh` — fill in the four token/ID values at the top, then run each block in your terminal. The dashboard updates within a few minutes.

Live endpoints (must respond 200 before submitting):
- Privacy policy: https://gb2gllc.com/privacy
- Data deletion: https://gb2gllc.com/data-deletion
- Terms of service: https://gb2gllc.com/terms
- Webhook: https://admin.gb2gllc.com/api/meta/webhook (HMAC SHA-256 verified, supports GET challenge)
- OAuth redirect: https://admin.gb2gllc.com/api/meta/oauth/callback

--------------------------------------------------------------------
## 1. App description (App Settings → Basic → "Display name" + "Description")
--------------------------------------------------------------------

Display name: **GB2G Maya**

Description (paste verbatim):

> GB2G Maya is a customer-engagement assistant for small businesses. Business owners (our clients) connect their Facebook Page and Instagram Business account so that Maya can respond to incoming Direct Messages and comments on their behalf using a per-business voice and link library that the business owner configures in our admin portal.
>
> When a person messages or comments on a connected page, Maya replies in the brand's voice using Claude (Anthropic) and routes the customer to the business's own configured website, booking link, or ordering page. Sensitive messages (refund/legal/medical/hostile) are not answered automatically — they are escalated to the business owner's Slack workspace for a human to handle.
>
> Maya is operated by GloryBe2God LLC, a U.S. agency. Each connected page belongs to a separately verified small-business client (real estate brokerages, professional services firms, local retailers). Maya is not a consumer product and is not installed by end users on their own accounts — only by the page owner or an authorized GB2G admin.

--------------------------------------------------------------------
## 2. Per-permission justifications
--------------------------------------------------------------------

For each permission below, paste the "Tell us how you're using this permission" answer and follow Meta's prompt structure: **Step 1: what feature** → **Step 2: how the user benefits** → **Step 3: how data is used and stored**.

### `pages_show_list`

Step 1 — Feature: After the page owner clicks "Connect Meta" in our admin portal, we call `/me/accounts` to display the list of Pages they manage so they can confirm which page(s) to enable Maya on.

Step 2 — User benefit: Page owners who manage multiple pages (common for agencies and multi-location businesses) can pick the correct page rather than us assuming or asking them to copy/paste an ID.

Step 3 — Data: We store only the Page ID, page name, and the long-lived page access token for each page the owner explicitly connects. We do not retain the list of pages they chose not to connect.

### `pages_messaging`

Step 1 — Feature: Replying to Direct Messages sent to a connected Facebook Page via Messenger. When a webhook event for an inbound `messages` event arrives, Maya drafts a reply with Claude Haiku and posts it via the Send API as `messaging_type: RESPONSE` within the 24-hour standard messaging window.

Step 2 — User benefit: People who DM a small business get an immediate, accurate reply with the right link (booking, ordering, or website) instead of waiting hours or being ghosted. This is the primary value: fast, on-brand customer service for businesses that can't afford a 24/7 social media manager.

Step 3 — Data: We store the inbound and outbound text, the sender PSID (used only to scope the reply to the same conversation), platform metadata, and our reply. Retained 12 months, then auto-deleted. We never send promotional messages outside the 24-hour window; Maya only replies in response to a user-initiated message.

### `pages_manage_metadata`

Step 1 — Feature: After OAuth completes, we call `POST /{page-id}/subscribed_apps` with `subscribed_fields=messages,messaging_postbacks,feed` so our app starts receiving webhook events for the page.

Step 2 — User benefit: Without this subscription the page owner would receive no replies — Maya can't react to a DM or comment it never sees. This is a one-time setup step the page owner does not have to do manually.

Step 3 — Data: No additional user data collected via this permission. We store nothing beyond confirmation that the subscription succeeded.

### `pages_manage_engagement`

Step 1 — Feature: Posting Maya's reply as a comment reply on the page's own post, and (when appropriate) sending a private follow-up DM with a booking/order link via `private_replies`.

Step 2 — User benefit: When a customer comments "how do I book?" on a Facebook post, Maya posts a short public reply ("Glad you're interested! DMing you now") and then privately sends the booking link. This pattern is more respectful of other people viewing the post than dumping a marketing link in public.

Step 3 — Data: Same as above — we store the outbound reply text and the comment ID it was attached to. We never reply to the page's own comments (to avoid loops) and never hide, delete, or moderate user comments without explicit human action.

### `instagram_business_basic`

Step 1 — Feature: Resolving the Instagram Business Account linked to a connected Facebook Page so we know which IG account to associate with the page (one IG handle per page in our database).

Step 2 — User benefit: Users connect their FB Page once and Maya automatically picks up the linked Instagram Business account too, so they don't have to do a separate Instagram OAuth.

Step 3 — Data: We store the IG Business Account ID and the IG @username, which we display in our admin portal so the page owner can confirm they connected the right Instagram. No follower lists, no media, no profile info beyond username and ID.

### `instagram_business_manage_messages`

Step 1 — Feature: Replying to Instagram Direct Messages received by a connected Instagram Business account, using the same flow as `pages_messaging` (24-hour standard messaging window, RESPONSE-typed reply).

Step 2 — User benefit: Same as Messenger DMs — fast, accurate replies to customer inquiries that come in through Instagram. For most of our clients (e.g. interior designers, fitness studios) Instagram DMs are the primary inbound channel.

Step 3 — Data: Identical handling to Facebook DMs. Inbound text, sender IGSID, outbound text retained 12 months and then auto-deleted. Maya never initiates a message — it only replies in response to a user-initiated DM.

### `instagram_manage_comments`

Step 1 — Feature: Reading inbound comments on the Instagram Business account's posts and posting Maya's replies. Same flow as Facebook comments but on the Instagram API surface.

Step 2 — User benefit: Customers commenting questions on Instagram posts get the same warm acknowledgment as Facebook commenters. We do not delete or hide user comments.

Step 3 — Data: Same handling as Facebook comments — message text, comment ID, commenter username retained 12 months, then auto-deleted.

### `business_management`

Step 1 — Feature: This is required by Meta's policy when an app reads from Pages owned by a Business in Business Manager (which is true for every client we onboard — they are all small-business owners with Business Manager accounts). The permission lets the OAuth flow surface those business-owned Pages in the `/me/accounts` response.

Step 2 — User benefit: Without `business_management`, page owners whose Pages live inside Business Manager (the vast majority of professional small businesses) cannot connect their Pages to Maya at all.

Step 3 — Data: We do not query any other Business endpoints. We only use this scope to ensure Business-Manager-owned Pages appear in the OAuth Page list.

--------------------------------------------------------------------
## 3. Screencast script
--------------------------------------------------------------------

Record a single ~3-minute screencast that walks Meta's reviewers through one end-to-end install + reply flow. Save as MP4, upload in the App Review submission. Narration suggestions in [brackets].

**Scene 1 (0:00–0:30): Admin starts the connection.**

1. Sign in to `https://admin.gb2gllc.com` as the admin user.
2. Open a client detail page that has the "Maya (Meta)" card visible.
3. Click "Install Meta workspace →".

   *[Narrate: "This is the GB2G admin portal where an authorized admin connects a client's Meta Page on their behalf. We are now redirecting to Facebook's OAuth dialog."]*

**Scene 2 (0:30–1:15): OAuth consent.**

4. Sign in to Facebook as the test user (provide test credentials in the "App Review" form).
5. Show the Facebook permissions screen listing every scope.
6. Tap "Continue" and on the page-selection screen pick the test Page.

   *[Narrate: "The page owner sees every permission requested. We have selected the test Page. Maya will now subscribe to webhooks for only this page."]*

7. Show the redirect back to `admin.gb2gllc.com/clients/[id]?meta_install=connected`.
8. Show the Maya card now displays the connected page name and Instagram @username.

**Scene 3 (1:15–2:00): Configure Maya.**

9. Type a Website URL, Booking URL, and Business hours into the Maya card.
10. Click Save.

    *[Narrate: "The page owner provides the destination links Maya will route customers to. Maya never invents URLs or makes up information."]*

**Scene 4 (2:00–2:45): Test the reply (DM).**

11. From a second Facebook account (the "customer" persona), open Messenger and send the connected Page a question: "Hi, are you open tomorrow? How do I book?"
12. Show the inbound message appearing in your admin portal's interactions log within a few seconds.
13. Show Maya's reply appearing in the customer's Messenger window, including the booking link.

    *[Narrate: "Maya replied within the 24-hour standard messaging window. The reply uses only the links the business configured. We log the inbound and outbound text for audit; both are auto-deleted after 12 months."]*

**Scene 5 (2:45–3:00): Test the reply (comment).**

14. From the customer persona, comment on a Page post: "How do I book?"
15. Show Maya's short public reply and the private DM with the link.

    *[Narrate: "On comments Maya posts a short acknowledgment publicly and sends the actual link in a private DM, to keep the public post clean."]*

**Scene 6 (3:00+): Escalation demonstration (optional but strongly recommended).**

16. From the customer persona, send a sensitive message: "I want a refund — this is going to my lawyer."
17. Show that Maya does NOT post a reply. Instead, show the escalation appearing in the connected Slack channel.

    *[Narrate: "Refund, legal, hostile, and medical messages are never answered by Maya. They are routed to the business owner's Slack for a human response."]*

--------------------------------------------------------------------
## 4. Test user instructions (App Review → "Instructions for app reviewer")
--------------------------------------------------------------------

Paste this into the reviewer instructions box. Replace bracketed values with real ones before submitting.

```
TEST CREDENTIALS
================
Admin portal (where Pages are connected):
  URL: https://admin.gb2gllc.com
  Email: [reviewer-only-test-admin@gb2gllc.com]
  Password: [generate one and rotate after review closes]

Facebook test user (Page owner persona):
  Email: [test-fb-owner@gb2gllc.com]
  Password: [...]
  This account owns the Page "GB2G Demo Co" and the linked Instagram @gb2gdemoco.

Facebook test user (Customer persona):
  Email: [test-fb-customer@gb2gllc.com]
  Password: [...]
  Use this account to send the test DM and comment.

STEPS TO REPRODUCE THE FULL FLOW
================================
1. Sign in to https://admin.gb2gllc.com as the admin test user.
2. Open https://admin.gb2gllc.com/clients/[demo-client-id] and find the "Maya (Meta)" card.
3. Click "Install Meta workspace". You will be redirected to Facebook OAuth.
4. Sign in as the Page owner test user and approve the requested permissions, selecting the Page "GB2G Demo Co".
5. After redirect, the Maya card will show "GB2G Demo Co / @gb2gdemoco" as connected.
6. Fill in the Website URL, Booking URL, and Business Hours fields and click Save.
7. From a second browser, sign in to Facebook as the Customer test user and send a DM to the "GB2G Demo Co" page asking "Are you open tomorrow?". Maya will reply within ~5 seconds.
8. From the Customer test user, comment "How do I book?" on the latest post by GB2G Demo Co. Maya will post a short public reply and send a private DM with the booking link.

DATA HANDLING
=============
- Privacy policy: https://gb2gllc.com/privacy (12-month retention for AI conversation transcripts).
- Data deletion: https://gb2gllc.com/data-deletion (Meta users can email hello@gb2gllc.com to remove their DM and comment data; 30-day SLA).
- Webhook signature: every POST to /api/meta/webhook is verified against X-Hub-Signature-256 using META_APP_SECRET; requests with invalid signatures return 401.
- Page access tokens are stored in Supabase Postgres with TLS in transit and at rest. Access is restricted to service-role credentials.

CONTACT
=======
Engineering contact: john@gb2gllc.com
We respond to App Review questions within one business day.
```

--------------------------------------------------------------------
## 5. Pre-submission checklist
--------------------------------------------------------------------

Verify each of these before clicking "Submit for review":

- [ ] **Business Verification complete.** Meta requires this before approving most of these permissions. If it's not done, start at Meta Business Suite → Settings → Business Info → Verify (need EIN, business address, ownership docs).
- [ ] App is in **Live mode**, not Development. (Settings → Basic → App Mode toggle.)
- [ ] `App Domains` includes `gb2gllc.com` (Settings → Basic).
- [ ] `Privacy Policy URL`, `Terms of Service URL`, and `Data Deletion Instructions URL` are filled in on Settings → Basic and each returns HTTP 200.
- [ ] `Valid OAuth Redirect URIs` includes `https://admin.gb2gllc.com/api/meta/oauth/callback` (Facebook Login → Settings).
- [ ] Webhook URL is verified — the GET challenge handshake at `/api/meta/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=foo` must echo `foo`. Meta tests this when you subscribe.
- [ ] `META_VERIFY_TOKEN` is set in Vercel prod env and matches what you put in Meta's webhook config.
- [ ] App icon (1024×1024 PNG) uploaded — required for Live mode.
- [ ] Three test users created via the App Dashboard → Roles → Test Users (one admin, one page owner, one customer).
- [ ] The "GB2G Demo Co" test Page has at least one published post so the comment test scene works.
- [ ] Screencast is unlisted (or accessible without login) and the link is pasted into "Instructions for app reviewer".

--------------------------------------------------------------------
## 6. Common rejection reasons and how to head them off
--------------------------------------------------------------------

- **"We could not reproduce the use case."** → This is the #1 rejection cause. The reviewer instructions above include exact credentials and click-by-click steps; missing any of those almost guarantees rejection.
- **"Permission scope exceeds need."** → If you are not actually using `pages_manage_metadata` to do anything besides subscribe webhooks, say exactly that. Meta is suspicious of unused scopes.
- **"Privacy policy is missing X."** → Your `/privacy` already names Meta as a sub-processor, lists retention, and links to `/data-deletion`. Don't change this — it's complete.
- **"Webhook is not responding."** → Make sure the production deployment is up at submission time. Meta pings the webhook during review.
- **"Test credentials don't work."** → Test the credentials yourself in an incognito window the day you submit.
