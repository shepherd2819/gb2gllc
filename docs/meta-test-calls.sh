#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Meta App Review — clears the "0 of 1 API call(s) required" markers.
# Fill in the four values below, then run each block.
#
# How to get the tokens:
#   USER_TOKEN  → https://developers.facebook.com/tools/explorer/
#                 Choose your app, click "Get User Access Token",
#                 grant ALL scopes listed in lib/meta.ts SCOPES.
#   PAGE_TOKEN  → Same tool: switch the access-token dropdown to your
#                 test Page. (Or call /me/accounts and copy access_token.)
#   PAGE_ID     → Numeric ID of your test Facebook Page.
#   IG_USER_ID  → IG Business Account ID linked to the page:
#                   curl "https://graph.facebook.com/v21.0/$PAGE_ID?fields=instagram_business_account&access_token=$PAGE_TOKEN"
# ─────────────────────────────────────────────────────────────────────

USER_TOKEN="EAAG..."          # short-lived user token (Graph Explorer)
PAGE_TOKEN="EAAG..."          # long-lived page token
PAGE_ID="100000000000000"
IG_USER_ID="17841400000000000"

G="https://graph.facebook.com/v21.0"

# Helper: pretty-print result + show whether call succeeded
run() {
  echo "──── $1 ────"
  shift
  RESPONSE=$("$@")
  echo "$RESPONSE" | head -c 600
  echo -e "\n"
}

# ─── 1. business_management ──────────────────────────────────────────
# Required by BOTH use cases. List the businesses the user manages.
run "business_management — GET /me/businesses" \
  curl -s "$G/me/businesses?access_token=$USER_TOKEN"

# ─── 2. pages_show_list ──────────────────────────────────────────────
# Returns the list of Pages the user manages (also returns page tokens).
run "pages_show_list — GET /me/accounts" \
  curl -s "$G/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=$USER_TOKEN"

# ─── 3. pages_manage_metadata ────────────────────────────────────────
# Subscribe your app to the page's webhook events. This is the call your
# OAuth callback already makes (lib/meta.ts → subscribePageToApp).
run "pages_manage_metadata — POST /$PAGE_ID/subscribed_apps" \
  curl -s -X POST "$G/$PAGE_ID/subscribed_apps" \
    -d "access_token=$PAGE_TOKEN" \
    -d "subscribed_fields=messages,messaging_postbacks,feed"

# ─── 4. pages_messaging ──────────────────────────────────────────────
# Send a Messenger DM. To satisfy the API-call requirement you can send
# yourself a message — start by DMing the page from your personal FB
# account (this gives the page a valid PSID for you), then run this with
# RECIPIENT_PSID set to your PSID.
#
# Get your PSID after DMing the page:
#   curl "$G/me/conversations?platform=messenger&access_token=$PAGE_TOKEN"
#
RECIPIENT_PSID="0000000000000000"
run "pages_messaging — POST /me/messages (Send API)" \
  curl -s -X POST "$G/me/messages?access_token=$PAGE_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"recipient\":{\"id\":\"$RECIPIENT_PSID\"},\"message\":{\"text\":\"Hello from Maya (test call for App Review)\"},\"messaging_type\":\"RESPONSE\"}"

# ─── 5. pages_manage_engagement ──────────────────────────────────────
# Reply to a comment. Find one via:
#   curl "$G/$PAGE_ID/posts?fields=id&limit=5&access_token=$PAGE_TOKEN"
#   curl "$G/{post-id}/comments?access_token=$PAGE_TOKEN"
COMMENT_ID="0000000000000_0000000000000"
run "pages_manage_engagement — POST /$COMMENT_ID/replies" \
  curl -s -X POST "$G/$COMMENT_ID/replies" \
    -d "access_token=$PAGE_TOKEN" \
    -d "message=Thanks for commenting — DMing you now with details."

# ─── 7. instagram_business_basic ─────────────────────────────────────
# Fetch the IG Business Account's basic profile.
run "instagram_business_basic — GET /$IG_USER_ID" \
  curl -s "$G/$IG_USER_ID?fields=id,username,name,profile_picture_url&access_token=$PAGE_TOKEN"

# ─── 8. instagram_business_manage_messages ───────────────────────────
# Send an IG DM. As with FB Messenger, the recipient must have messaged
# the IG account first (within the 24h window). Get the IGSID by:
#
#   curl "$G/$IG_USER_ID/conversations?platform=instagram&access_token=$PAGE_TOKEN"
#
IG_RECIPIENT_IGSID="0000000000000000"
run "instagram_business_manage_messages — POST /$IG_USER_ID/messages" \
  curl -s -X POST "$G/$IG_USER_ID/messages?access_token=$PAGE_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"recipient\":{\"id\":\"$IG_RECIPIENT_IGSID\"},\"message\":{\"text\":\"Hello from Maya (IG test call for App Review)\"}}"

# ─── 9. instagram_manage_comments ────────────────────────────────────
# Reply to an Instagram comment. Get one from a recent IG post:
#
#   curl "$G/$IG_USER_ID/media?fields=id,caption&limit=5&access_token=$PAGE_TOKEN"
#   curl "$G/{media-id}/comments?access_token=$PAGE_TOKEN"
#
IG_COMMENT_ID="17000000000000000"
run "instagram_manage_comments — POST /$IG_COMMENT_ID/replies" \
  curl -s -X POST "$G/$IG_COMMENT_ID/replies" \
    -d "access_token=$PAGE_TOKEN" \
    -d "message=Thanks for the comment — DMing now."

# ─── public_profile ──────────────────────────────────────────────────
# Auto-granted to every Login. No explicit test call needed.

echo "Done. Reload the Meta App Dashboard → each row should now show 1 successful API test call."
