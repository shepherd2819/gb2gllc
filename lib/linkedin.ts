const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";
export const LINKEDIN_REDIRECT_URI = `${ADMIN_URL}/api/linkedin/oauth/callback`;

const OAUTH_BASE = "https://www.linkedin.com/oauth/v2";
const API_BASE   = "https://api.linkedin.com";

// ── OAuth scopes ────────────────────────────────────────────────────────
// w_member_social  → post on the signed-in member's personal profile
// openid + profile → read the member's name + LinkedIn URN (needed for posting)
// email            → optional, useful for matching to client records
// (Company-page posting requires `w_organization_social` which only unlocks
// after LinkedIn Marketing Developer Platform approval — we add it later.)
const SCOPES = ["openid", "profile", "email", "w_member_social"];

// ─── OAuth start ────────────────────────────────────────────────────────
export function linkedinInstallUrl(state: string): string {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) throw new Error("LINKEDIN_CLIENT_ID not set");
  const url = new URL(`${OAUTH_BASE}/authorization`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", LINKEDIN_REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", SCOPES.join(" "));
  return url.toString();
}

// ─── OAuth code exchange ────────────────────────────────────────────────
export type LinkedInTokenResponse = {
  access_token: string;
  expires_in: number;           // seconds, typically 60 days
  scope?: string;
  token_type?: string;
  id_token?: string;            // OpenID id token
  refresh_token?: string;       // LinkedIn doesn't issue these on standard apps
};

export async function exchangeLinkedinCode(code: string): Promise<LinkedInTokenResponse> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET not set");

  const res = await fetch(`${OAUTH_BASE}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: LINKEDIN_REDIRECT_URI,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LinkedIn token exchange ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// ─── Get the signed-in member's profile (URN is needed for posting) ─────
export type LinkedInUserInfo = {
  sub: string;            // urn fragment, e.g. "abc-DefGhi"
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
};

export async function getLinkedinUserInfo(accessToken: string): Promise<LinkedInUserInfo> {
  const res = await fetch(`${API_BASE}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LinkedIn /v2/userinfo ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export function memberUrn(sub: string): string {
  return `urn:li:person:${sub}`;
}

// ─── Publish a UGC text post on the member's profile ────────────────────
export type PublishResult =
  | { ok: true; urn: string; url: string }
  | { ok: false; error: string };

export async function publishLinkedinTextPost(opts: {
  accessToken: string;
  authorUrn: string;            // e.g. urn:li:person:abc
  text: string;
  visibility?: "PUBLIC" | "CONNECTIONS";
}): Promise<PublishResult> {
  const body = {
    author: opts.authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: opts.text },
        shareMediaCategory: "NONE",
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": opts.visibility ?? "PUBLIC",
    },
  };

  const res = await fetch(`${API_BASE}/v2/ugcPosts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error("[linkedin publish]", res.status, text.slice(0, 400));
    return { ok: false, error: `LinkedIn ${res.status}: ${text.slice(0, 200)}` };
  }
  // The URN comes back in the x-restli-id header on success
  const urn = res.headers.get("x-restli-id") ?? safeJsonField(text, "id") ?? "";
  const shareId = urn.split(":").pop() ?? "";
  const url = shareId ? `https://www.linkedin.com/feed/update/${urn}` : "";
  return { ok: true, urn, url };
}

// Pulls engagement metrics for a published post. Best-effort: the LinkedIn
// social-actions endpoint returns counts; impressions require a separate
// analytics product that needs MDP approval. We surface what's available.
export async function fetchLinkedinPostMetrics(opts: {
  accessToken: string;
  postUrn: string;             // urn:li:share:... or urn:li:ugcPost:...
}): Promise<{
  likes: number | null;
  comments: number | null;
  shares: number | null;
}> {
  try {
    const encoded = encodeURIComponent(opts.postUrn);
    const res = await fetch(`${API_BASE}/v2/socialActions/${encoded}`, {
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
    if (!res.ok) return { likes: null, comments: null, shares: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = await res.json();
    return {
      likes:    j?.likesSummary?.totalLikes ?? null,
      comments: j?.commentsSummary?.aggregatedTotalComments ?? null,
      shares:   null, // not in v2 social-actions; needs analytics product
    };
  } catch {
    return { likes: null, comments: null, shares: null };
  }
}

function safeJsonField(text: string, field: string): string | null {
  try {
    const j = JSON.parse(text);
    return typeof j?.[field] === "string" ? j[field] : null;
  } catch {
    return null;
  }
}
