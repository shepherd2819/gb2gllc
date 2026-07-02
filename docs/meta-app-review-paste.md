# Meta App Review — Paste-ready Allowed Usage answers

Paste each block into Meta's permission form. The three answers per scope map to the three questions Meta currently asks:

  Q1. **How will your app use this permission?**
  Q2. **How does someone using your app see this feature in action?**
  Q3. **Why is this permission necessary?** (or "Data handling")

Each answer is sized for Meta's ~1000-char limit. If Meta only shows one big text area, paste all three answers separated by line breaks.

────────────────────────────────────────────────────────────────────

## `public_profile`

**Q1 — How will your app use this permission?**
> The page owner signs into our admin portal (admin.gb2gllc.com) using Facebook Login to authorize Maya, our customer-engagement assistant. We use public_profile to display the signed-in user's name and avatar in the portal so they can confirm they completed login with the correct Facebook account before connecting their Page(s).

**Q2 — How does someone using your app see this feature in action?**
> After clicking "Connect Meta" in our admin portal, the user is redirected to Facebook's OAuth consent screen and approves the requested permissions. On return, their name appears in the confirmation header (e.g. "Signed in as Jane Doe") above the Page-selection step.

**Q3 — Why is this permission necessary?**
> Required by Facebook Login to identify the authenticated user. Without it we cannot acknowledge the user back to themselves after the OAuth handshake.

────────────────────────────────────────────────────────────────────

## `pages_show_list`

**Q1 — How will your app use this permission?**
> Immediately after Facebook Login, we call GET /me/accounts to list the Pages the authenticated user manages. We render that list inside our admin portal so the owner can confirm which Page(s) Maya should be enabled on. Only Pages the owner explicitly selects are enrolled — we do not auto-enable any Page.

**Q2 — How does someone using your app see this feature in action?**
> After signing in with Facebook, the owner sees a checkbox list of every Page they administer (e.g. "Acme Realty", "Acme Studio Downtown"). They tick the Pages they want Maya to manage and click "Enable". A confirmation screen shows the enabled Pages plus their linked Instagram Business accounts.

**Q3 — Why is this permission necessary?**
> Many of our clients manage multiple Pages (one per business location or service line). Without pages_show_list we cannot present a selectable list and would have to ask owners to copy/paste Page IDs manually, which is error-prone.

────────────────────────────────────────────────────────────────────

## `pages_manage_metadata`

**Q1 — How will your app use this permission?**
> Once a Page is selected, we call POST /{page-id}/subscribed_apps with subscribed_fields=messages,messaging_postbacks,feed so the app begins receiving webhook events for that Page. This is a one-time call per Page made automatically as part of the connection flow. We do not modify any other Page metadata.

**Q2 — How does someone using your app see this feature in action?**
> Invisible to end customers. The page owner sees the Page's status in the admin portal change to "Active" once subscription succeeds. This happens within ~1 second of completing the OAuth flow.

**Q3 — Why is this permission necessary?**
> Without subscribing the app to the Page's webhook events, our app would never receive the DMs and comments Maya is designed to respond to. This permission is used only to subscribe to webhook events — never to edit Page settings, profile fields, or any other Page metadata.

────────────────────────────────────────────────────────────────────

## `pages_messaging`

**Q1 — How will your app use this permission?**
> When a customer sends a DM to a connected Facebook Page, our webhook receives the message event. Maya, our AI assistant powered by Claude (Anthropic), drafts a contextual reply using the page owner's pre-configured links (website, booking calendar, ordering page, business hours) and sends that reply via the Messenger Send API: POST /me/messages with messaging_type=RESPONSE. Replies are sent only within the 24-hour standard messaging window and only in direct response to a user-initiated inbound message. We do NOT send promotional, marketing, or unsolicited messages, and we do NOT use any messaging tags that would extend beyond the 24-hour window.

**Q2 — How does someone using your app see this feature in action?**
> A customer DMs a connected Page: "Hi, do you have appointments next Tuesday?" Within seconds the customer receives a reply from the Page in Messenger: "Hi! Yes — we have openings Tuesday afternoon. You can book here: https://calendar.acmerealty.com/" The reply uses only links the page owner configured in advance. If the customer's message contains sensitive content (refund requests, legal threats, medical conditions, hostile tone), Maya does NOT reply — instead the message is escalated to the page owner via Slack so a human can handle it.

**Q3 — Why is this permission necessary?**
> The core feature of Maya on Facebook is responding to inbound Page DMs on behalf of the business owner. pages_messaging is the only API path to send those replies through the Messenger platform. Without it, the app has no way to deliver Maya's responses.

────────────────────────────────────────────────────────────────────

## `pages_manage_engagement`

**Q1 — How will your app use this permission?**
> When a customer comments on a connected Facebook Page post, our webhook receives the comment event. Maya posts a short, friendly acknowledgment reply on the comment via POST /{comment-id}/replies (e.g. "Thanks for asking — DMing you now with details"), then sends the actual booking or website link as a private follow-up DM via POST /{comment-id}/private_replies. This pattern keeps marketing links out of public threads and routes the customer into a private conversation. We never hide, delete, or moderate the customer's own comments.

**Q2 — How does someone using your app see this feature in action?**
> A customer comments "How do I book?" on a Page post. Within seconds a brief reply appears under their comment: "Hi! DMing you the link now." A Messenger DM then arrives in the customer's inbox containing the booking URL. The customer's original comment is left untouched on the post.

**Q3 — Why is this permission necessary?**
> Required to post comment replies and to use the private_replies endpoint on the Page. Without this permission Maya cannot complete the public-acknowledge + private-link pattern that converts FB comment engagement into website/booking traffic for the business owner.

────────────────────────────────────────────────────────────────────

## `business_management`

**Q1 — How will your app use this permission?**
> Many of our small-business clients (real estate brokerages, professional services firms, local retailers) own their Facebook Pages inside Meta Business Suite / Business Manager rather than as personal Pages. business_management makes those Business-owned Pages visible in the /me/accounts response during the OAuth flow so the owner can select them in our connection screen. We do not call any other Business endpoints — this scope is used solely to ensure all eligible Pages appear in the connection list.

**Q2 — How does someone using your app see this feature in action?**
> A page owner whose business is registered in Business Manager sees ALL of their Pages — including those owned by the Business — in the connection step, instead of only personal Pages. Without this scope, business-owned Pages would silently be absent from the list and the owner could not connect them to Maya.

**Q3 — Why is this permission necessary?**
> Required so that Business-owned Pages appear in the OAuth Page-selection list. The majority of professional small businesses we serve operate via Business Manager, so without this permission the app would be unable to onboard them.

────────────────────────────────────────────────────────────────────

## `instagram_business_basic`

**Q1 — How will your app use this permission?**
> After the page owner selects a Facebook Page that has a linked Instagram Business account, we call GET /{ig-business-account-id}?fields=id,username,name,profile_picture_url to retrieve the Instagram handle. We store the IG account ID and @username so the system can route inbound Instagram webhook events to the correct client account. We do not access follower lists, media library, insights, or any other Instagram data.

**Q2 — How does someone using your app see this feature in action?**
> When the page owner completes the OAuth flow, our admin portal displays the connected Facebook Page name alongside the linked Instagram @username (e.g. "Acme Realty / @acmerealtyhomes"). This lets the owner confirm at a glance that the correct Instagram Business account is paired with the Page they connected.

**Q3 — Why is this permission necessary?**
> Required to read the IG Business Account's basic identity (ID + @username). Without it we cannot resolve which Instagram is linked to a connected Page, so we cannot route inbound IG DM and comment webhook events to the correct business account in our database.

────────────────────────────────────────────────────────────────────

## `instagram_business_manage_messages`

**Q1 — How will your app use this permission?**
> When a customer sends a DM to a connected Instagram Business account, our webhook receives the message event. Maya drafts a contextual reply using Claude AI and the business owner's pre-configured links (website, booking calendar, ordering page), then sends that reply via POST /{ig-business-account-id}/messages within the 24-hour standard messaging window, in direct response to the user-initiated inbound message. We never initiate conversations and never send marketing/promotional content.

**Q2 — How does someone using your app see this feature in action?**
> A customer sends an Instagram DM to a connected business (e.g. "Do you have any openings this Saturday?"). Within seconds the customer receives a personalized reply in their Instagram inbox from the business including the booking link. Sensitive messages — refund disputes, legal threats, medical questions, hostile tone — are NOT auto-answered; they route to the business owner's Slack for a human to handle.

**Q3 — Why is this permission necessary?**
> The core function of Maya on Instagram is responding to inbound DMs on behalf of the business. instagram_business_manage_messages is the required API path to send those replies through the Instagram Messaging surface.

────────────────────────────────────────────────────────────────────

## `instagram_manage_comments`

**Q1 — How will your app use this permission?**
> When a customer comments on a connected Instagram Business account's post or reel, our webhook receives the comment event. Maya posts a brief, friendly public reply via POST /{ig-comment-id}/replies acknowledging the customer and inviting them to DM for details (e.g. "So glad you asked! DM us and we'll send the info right over"). We do NOT hide, delete, edit, or moderate the customer's own comments — replies are additive only.

**Q2 — How does someone using your app see this feature in action?**
> A customer comments "Is this still available?" on an Instagram post by a connected business. Within seconds the business's reply appears under their comment: "Hi! Yes — DM us and we'll share the details." The customer is then prompted into a DM where Maya can share specific links. The original comment from the customer is preserved as-is.

**Q3 — Why is this permission necessary?**
> Required to post replies under customer comments on Instagram. For many of our clients — retail, fitness studios, interior designers, restaurants — Instagram comments are the primary inbound channel from social, and without this permission Maya cannot engage at all on that surface.

────────────────────────────────────────────────────────────────────

## Data handling — paste anywhere Meta asks how you process the data

> When a user DMs or comments on a connected Page or Instagram Business account, our webhook receives: the message text, the platform-issued sender ID (PSID for Messenger, IGSID for Instagram), the sender's public display name where Meta provides it, the Page or Post ID, and a timestamp.
>
> Message text is transmitted to Anthropic (Claude) over an authenticated TLS connection to generate Maya's reply. Anthropic operates under a contract that prohibits training on our customer data, and Anthropic discards the request after the response is returned.
>
> We persist the inbound text, our reply text, sender IDs (used only to scope replies to the same conversation), and platform metadata in our Supabase Postgres database. Data is encrypted in transit (TLS 1.3) and at rest. Access is restricted to service-role credentials held only by our application code. Records are retained for 12 months for audit and customer-support purposes, then automatically and permanently deleted.
>
> We do not sell user data. We do not share user data with any third party other than the sub-processors named in our privacy policy at https://gb2gllc.com/privacy. Users can request deletion of their data at any time by emailing hello@gb2gllc.com — see https://gb2gllc.com/data-deletion.

────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────

# App Access Instructions section (reviewer-onboarding fields)

Before pasting, fill in the bracketed placeholders. Create the test users in the App Dashboard → Roles → Test Users, and the admin portal user in your WorkOS dashboard. Rotate all passwords after the review closes.

────────────────────────────────────────────────────────────────────

## Field 1 — "Provide instructions for accessing the app…" (REQUIRED)

> **Confirmation of Facebook Login usage**
> Yes, this app uses Facebook Login. Specifically, we use Facebook Login as the OAuth handshake that allows the business owner to authorize our app to manage their Facebook Page(s) and linked Instagram Business account(s). The permissions requested at the Login step are listed in the App Review submission (public_profile, pages_show_list, pages_messaging, pages_manage_metadata, pages_manage_engagement, business_management, instagram_business_basic, instagram_business_manage_messages, instagram_manage_comments).
>
> The primary identity layer for our client portal is WorkOS Authkit (email + password). Facebook Login is layered on top of that as the mechanism that authorizes Meta API access for a given Page.
>
> **How to navigate to the app**
> Our app is a web application. Use a desktop browser (Chrome or Safari).
>
> 1. Open https://home.gb2gllc.com in an incognito window.
> 2. Sign in with the GB2G client test credentials provided below (email + password). This account is provisioned as a regular client — it walks through the exact flow a real business owner would.
> 3. After sign-in, click **Connections** in the left navigation.
> 4. Locate the row titled **"Maya / Meta (Facebook + Instagram)"** and click **"Connect Meta →"**. This starts the Facebook Login OAuth flow.
> 5. You will be redirected to facebook.com. Sign in as the **Page Owner test user** (credentials below).
> 6. Review the requested permissions and click **Continue**.
> 7. On the Page selection screen, choose the test Page **"GB2G Demo Co"** (which also has a linked Instagram Business account, @gb2gdemoco).
> 8. You will be redirected back to https://home.gb2gllc.com/connections?meta=connected. A green banner will confirm the connection, and the Maya row will now display the connected Page name and Instagram handle (e.g. "GB2G Demo Co / @gb2gdemoco").
>
> **Maya's reply links are pre-configured for this demo account.** The website URL, booking URL, and business hours have already been set so Maya can reply with real content during your test. (In production, page owners configure these themselves; we omit that step in the test to keep the review focused on the Meta API permissions.)
>
> **Testing Maya's reply behavior**
>
> 9. Open a second browser (or incognito window) and sign in to facebook.com as the **Customer test user**.
> 10. Send a Messenger DM to the **"GB2G Demo Co"** Page asking: *"Hi, are you open tomorrow? How do I book?"* Within 5–10 seconds you will receive a personalized reply from the Page including the pre-configured booking link. This exercises `pages_messaging`.
> 11. Send an Instagram DM from the Customer test user to @gb2gdemoco asking the same question. You will receive an Instagram reply within 5–10 seconds. This exercises `instagram_business_manage_messages`.
> 12. From the Customer test user, comment **"How do I book?"** on the most recent post by GB2G Demo Co (Facebook). Within seconds you will see (a) a short public reply on the comment ("DMing you now") and (b) a Messenger DM containing the booking link. This exercises `pages_manage_engagement`.
> 13. From the Customer test user, comment **"Is this still available?"** on the most recent Instagram post by @gb2gdemoco. You will see a short public reply under the comment. This exercises `instagram_manage_comments`.
>
> **Testing the human-escalation safety net**
>
> 14. From the Customer test user, send a sensitive DM to the Page: *"I want a refund — this is going to my lawyer."* Maya will deliberately NOT reply automatically. The message is routed to the business owner's Slack channel for a human to handle. This is an important safety behavior we want reviewers to see.

────────────────────────────────────────────────────────────────────

## Field 2 — "Provide access codes or test credentials" (REQUIRED)

> No payment, subscription, or paid membership is required to access any of the functionality being reviewed. The app is operated by GloryBe2God LLC on behalf of small-business clients; reviewers do not need to purchase anything. All credentials below are reviewer-only and active for one year from the submission date.
>
> **GB2G client portal (WorkOS-authenticated)**
> URL: https://home.gb2gllc.com
> Email: [reviewer-test-client@gb2gllc.com]
> Password: [generate a strong password and paste here]
> This account is provisioned as a regular client (not an admin) so reviewers walk through the same OAuth flow a real business owner would.
>
> **Facebook test user — Page Owner persona (registered to this app via App Dashboard → Roles → Test Users)**
> Email: [page-owner-test@tfbnw.net]
> Password: [paste here]
> This account owns the Facebook test Page **"GB2G Demo Co"** and its linked Instagram Business account **@gb2gdemoco**.
>
> **Facebook test user — Customer persona (registered to this app via App Dashboard → Roles → Test Users)**
> Email: [customer-test@tfbnw.net]
> Password: [paste here]
> Use this account to send the DMs and comments described in the testing steps. This account has already initiated at least one DM with the Page so the 24-hour standard messaging window is open at the time of review.

────────────────────────────────────────────────────────────────────

## Field 3 — "Gift codes for app store downloads"

> Not applicable. This is a web application accessed via desktop browser at https://admin.gb2gllc.com. There is no iOS, Android, or app-store distribution, so no gift codes are required.

────────────────────────────────────────────────────────────────────

## Field 4 — "Geographic restrictions / geo-blocking"

> Not applicable. The app is accessible globally from any region with no geo-blocking, geo-fencing, IP restriction, or VPN requirement. Reviewers may test from any location.

────────────────────────────────────────────────────────────────────

## Quick reminders before submitting

- Privacy policy URL = `https://gb2gllc.com/privacy` (App Settings → Basic)
- Data deletion URL = `https://gb2gllc.com/data-deletion`
- Terms of service URL = `https://gb2gllc.com/terms`
- OAuth redirect URI = `https://admin.gb2gllc.com/api/meta/oauth/callback`
- Webhook URL = `https://admin.gb2gllc.com/api/meta/webhook`
- App icon (1024×1024) uploaded
- App in **Live mode**, not Development
- All 8 "0 of 1 API call(s) required" markers green (use `docs/meta-test-calls.sh`)
- Three test users created (admin + page owner + customer)
- Test page has at least one published post (for the comment-reply demo)
- Screencast recorded against the script in `docs/meta-app-review.md` section 3
