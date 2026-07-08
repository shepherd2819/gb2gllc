// lib/analytics/oauth-core.ts
//
// PURE half of the MCP "Connect" OAuth flow (see ./oauth.ts for the
// DB-touching half). No import of "@/lib/supabase" anywhere in this file's
// dependency graph — that mirrors store.ts/store-builders.ts (see
// store.test.ts's header comment: importing @/lib/supabase throws at import
// time without env, so anything unit-tested must not pull it in). Everything
// here is exercised by oauth.test.ts fully offline.
//
// Built on the MCP SDK's OAuth client (@modelcontextprotocol/sdk 1.29.0,
// "./client/auth.js" + "./shared/auth.js" — verified by reading
// node_modules/@modelcontextprotocol/sdk/dist/esm/{client,shared}/auth.*).
// The SDK's `auth()` orchestrator (client/auth.js) drives discovery (RFC
// 9728 protected-resource metadata + RFC 8414 authorization-server
// metadata), Dynamic Client Registration (RFC 7591), PKCE, and the
// authorization_code exchange; it consumes an `OAuthClientProvider` for all
// persistence. SourceOAuthProvider below implements that interface, backed
// by an INJECTED SourcePersistence (not store.ts directly) so it stays
// testable with an in-memory fake. oauth.ts supplies the real
// store.ts-backed persistence for production use.
//
// Deliberate deviation from the brief: getValidAccessToken's REFRESH
// decision does NOT go through the SDK's top-level `auth()` orchestrator.
// Reason: authInternal() only checks `tokens?.refresh_token` truthiness to
// decide whether to attempt a refresh — it does not check the *current*
// access token's expiry at all, so a naive `auth()` call would refresh on
// every single call, defeating the whole point of caching an access token.
// Worse, if a refresh attempt fails with anything other than a recognized
// OAuthError subtype, authInternal silently falls through to "start a new
// authorization flow" and calls `redirectToAuthorization` — fine in a
// browser, but there is no browser in a headless cron sync. So this module
// does its own expiry-with-skew check first, and — only when a refresh is
// actually needed — calls the SDK's lower-level, directly-exported
// `refreshAuthorization()` (RFC 6749 §6 token endpoint request, client-auth
// method selection, response validation) instead of the full orchestrator.
// `refreshAuthorization` takes an injectable `fetchFn`, which is exactly the
// seam the offline tests use.

import { createHmac, timingSafeEqual } from "node:crypto";
import { refreshAuthorization, selectResourceURL } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { decryptSecret, encryptSecret } from "@/lib/analytics/crypto";
import type { DataSourceRow, Err, Result } from "@/lib/analytics/types";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";
export const OAUTH_REDIRECT_URI = `${ADMIN_URL}/api/admin/analytics/oauth/callback`;

// ── Token bundle (the JSON payload encrypted into secret_enc) ──────────────

export type StoredTokens = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number | null; // epoch ms; null/undefined = unknown/non-expiring
  token_type: string;
  scope?: string;
};

export type TokenBundle = {
  codeVerifier?: string;
  clientSecret?: string;
  tokens?: StoredTokens;
};

export function encodeBundle(bundle: TokenBundle): string {
  return encryptSecret(JSON.stringify(bundle));
}

// Throws on a corrupt/undecryptable blob — callers that need a fail-soft
// boolean should use hasStoredTokens() instead.
export function decryptBundleOrThrow(secretEnc: string | null): TokenBundle {
  if (!secretEnc) return {};
  const parsed: unknown = JSON.parse(decryptSecret(secretEnc));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("decryptBundleOrThrow: stored OAuth bundle is not a JSON object");
  }
  return parsed as TokenBundle;
}

// Display-only: never throws, never exposes token material. Used by the
// sources list route + admin client page to render "Connected"/"Needs
// login" without ever sending the bundle itself to the browser.
export function hasStoredTokens(secretEnc: string | null): boolean {
  if (!secretEnc) return false;
  try {
    const bundle = decryptBundleOrThrow(secretEnc);
    return typeof bundle.tokens?.access_token === "string" && bundle.tokens.access_token.length > 0;
  } catch {
    return false;
  }
}

// ── config.oauth (non-secret) ───────────────────────────────────────────────

type OAuthConfigBlock = {
  clientInformation?: Record<string, unknown>; // OAuthClientInformationFull minus client_secret
  discovery?: OAuthDiscoveryState;
};

function readOAuthConfig(config: Record<string, unknown>): OAuthConfigBlock {
  const raw = config.oauth;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as OAuthConfigBlock) : {};
}

// Duplicated (not imported) from providers/generic-mcp.ts's endpointFromConfig
// on purpose: generic-mcp.ts imports getValidAccessToken from ./oauth, and
// ./oauth imports this module, so importing generic-mcp.ts back into this
// file would create a cycle. It's 3 lines; not worth the coupling.
export function readEndpointUrl(config: Record<string, unknown>): string | null {
  const url = config.endpointUrl;
  return typeof url === "string" && url.trim().length > 0 ? url.trim() : null;
}

// ── state param (CSRF-bound clientId+sourceId) ──────────────────────────────
//
// Signed (HMAC-SHA256), not encrypted — clientId/sourceId are not secret,
// but the callback must not accept a state it didn't itself mint (forged or
// misrouted state would let one tenant's callback complete against another
// tenant's source). Keyed off ANALYTICS_SECRET_KEY (already required by this
// module for token-bundle encryption) via a fixed-context HMAC derivation,
// rather than requiring a second secret (e.g. AUDIT_HMAC_KEY) to be
// provisioned just for this.

export type StatePayload = { clientId: string; sourceId: string };

const STATE_MAX_AGE_MS = 15 * 60 * 1000; // 15 min — generous for an interactive login+approve flow

function stateHmacKey(): Buffer {
  const raw = process.env.ANALYTICS_SECRET_KEY;
  if (!raw) throw new Error("ANALYTICS_SECRET_KEY is not set (required for OAuth state signing)");
  return createHmac("sha256", raw).update("gb2g-analytics-oauth-state-v1").digest();
}

export function signState(payload: StatePayload): string {
  const body = JSON.stringify({ clientId: payload.clientId, sourceId: payload.sourceId, ts: Date.now() });
  const b64 = Buffer.from(body, "utf8").toString("base64url");
  const sig = createHmac("sha256", stateHmacKey()).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

export function validateState(state: string | null | undefined): Result<StatePayload> {
  if (!state) return { ok: false, kind: "auth", reason: "Missing OAuth state parameter" };
  const dot = state.indexOf(".");
  if (dot < 0) return { ok: false, kind: "auth", reason: "Malformed OAuth state parameter" };
  const b64 = state.slice(0, dot);
  const sig = state.slice(dot + 1);

  let expectedSig: Buffer;
  let actualSig: Buffer;
  try {
    expectedSig = createHmac("sha256", stateHmacKey()).update(b64).digest();
    actualSig = Buffer.from(sig, "base64url");
  } catch {
    return { ok: false, kind: "auth", reason: "Malformed OAuth state signature" };
  }
  if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
    return { ok: false, kind: "auth", reason: "OAuth state signature mismatch — possible CSRF" };
  }

  let parsed: { clientId?: unknown; sourceId?: unknown; ts?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, kind: "auth", reason: "OAuth state payload is not valid JSON" };
  }
  if (typeof parsed.clientId !== "string" || typeof parsed.sourceId !== "string" || typeof parsed.ts !== "number") {
    return { ok: false, kind: "auth", reason: "OAuth state payload missing required fields" };
  }
  if (Date.now() - parsed.ts > STATE_MAX_AGE_MS) {
    return { ok: false, kind: "auth", reason: "OAuth state has expired — please retry connecting" };
  }
  return { ok: true, clientId: parsed.clientId, sourceId: parsed.sourceId };
}

// ── Error mapping ────────────────────────────────────────────────────────────
//
// Duck-typed rather than importing the SDK's OAuthError subclasses (mirrors
// mcp.ts's mapMcpError, which does the same for the same reason: stays
// robust to SDK internals changing). The SDK's token-endpoint errors
// (server/auth/errors.js, re-thrown by client/auth.js's parseErrorResponse)
// set `this.name = this.constructor.name` (e.g. "InvalidGrantError") and a
// stable per-class `.errorCode` getter (the RFC 6749 §5.2 wire value, e.g.
// "invalid_grant") — both far more reliable than `.message`, which is
// server-controlled free text (error_description) and can't be pattern-
// matched safely.
export function mapOAuthError(e: unknown): Err {
  const msg = e instanceof Error ? e.message : String(e);
  const errLike = e as { errorCode?: unknown; name?: unknown } | null | undefined;
  const code = typeof errLike?.errorCode === "string" ? errLike.errorCode : "";
  const name = typeof errLike?.name === "string" ? errLike.name : "";

  if (
    code === "invalid_grant" ||
    code === "invalid_client" ||
    code === "unauthorized_client" ||
    /invalid(grant|client|token)|unauthorized/i.test(name)
  ) {
    return { ok: false, kind: "auth", reason: `OAuth error: ${msg.slice(0, 300)}` };
  }
  if (/timeout|timed out|fetch failed|network|econnrefused|enotfound|socket/i.test(msg)) {
    return { ok: false, kind: "network", reason: `OAuth network failure: ${msg.slice(0, 300)}` };
  }
  if (/unauthorized|forbidden|\b401\b|\b403\b/i.test(msg)) {
    return { ok: false, kind: "auth", reason: `OAuth error: ${msg.slice(0, 300)}` };
  }
  return { ok: false, kind: "error", reason: `OAuth error: ${msg.slice(0, 300)}` };
}

// ── SourceOAuthProvider (OAuthClientProvider impl, injectable persistence) ─

export type SourcePersistence = {
  saveConfig(config: Record<string, unknown>): Promise<void>;
  saveSecretBundle(bundle: TokenBundle): Promise<void>;
};

export class SourceOAuthProvider implements OAuthClientProvider {
  private config: Record<string, unknown>;
  private bundle: TokenBundle;
  private capturedAuthorizationUrl: URL | null = null;

  constructor(
    private readonly source: Pick<DataSourceRow, "id" | "client_id" | "config" | "secret_enc">,
    private readonly persistence: SourcePersistence,
    opts: { dropExistingTokens?: boolean } = {},
  ) {
    this.config = { ...source.config };
    this.bundle = decryptBundleOrThrow(source.secret_enc);
    if (opts.dropExistingTokens && this.bundle.tokens) {
      const { tokens: _tokens, ...rest } = this.bundle;
      this.bundle = rest;
    }
  }

  get redirectUrl(): string {
    return OAUTH_REDIRECT_URI;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "GB2G Analytics",
      redirect_uris: [OAUTH_REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // Requests a refresh token where the server supports the OIDC-style
      // offline_access scope; harmless (ignored) on servers that don't.
      scope: "offline_access",
    };
  }

  state(): string {
    return signState({ clientId: this.source.client_id, sourceId: this.source.id });
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const { clientInformation } = readOAuthConfig(this.config);
    if (!clientInformation || typeof clientInformation.client_id !== "string") return undefined;
    const full = { ...clientInformation } as OAuthClientInformationFull;
    if (this.bundle.clientSecret) full.client_secret = this.bundle.clientSecret;
    return full;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    const { client_secret, ...rest } = info as OAuthClientInformationFull;
    this.config = { ...this.config, oauth: { ...readOAuthConfig(this.config), clientInformation: rest } };
    await this.persistence.saveConfig(this.config);
    if (client_secret) {
      this.bundle = { ...this.bundle, clientSecret: client_secret };
      await this.persistence.saveSecretBundle(this.bundle);
    }
  }

  tokens(): OAuthTokens | undefined {
    const t = this.bundle.tokens;
    if (!t?.access_token) return undefined;
    return { access_token: t.access_token, refresh_token: t.refresh_token, token_type: t.token_type, scope: t.scope };
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const expiresAt = typeof tokens.expires_in === "number" ? Date.now() + tokens.expires_in * 1000 : null;
    this.bundle = {
      ...this.bundle,
      tokens: {
        access_token: tokens.access_token,
        // Servers commonly omit refresh_token on refresh responses, meaning
        // "unchanged" (RFC 6749 doesn't mandate re-issuing it) — preserve
        // the prior one rather than dropping it.
        refresh_token: tokens.refresh_token ?? this.bundle.tokens?.refresh_token,
        expires_at: expiresAt,
        token_type: tokens.token_type,
        scope: tokens.scope,
      },
    };
    await this.persistence.saveSecretBundle(this.bundle);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // Server-side context: there is no browser attached to this process to
    // redirect. Capture the URL; the /oauth/start route handler reads it
    // back via consumeAuthorizationUrl() and 302s the ADMIN'S browser there.
    this.capturedAuthorizationUrl = authorizationUrl;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.bundle = { ...this.bundle, codeVerifier };
    await this.persistence.saveSecretBundle(this.bundle);
  }

  codeVerifier(): string {
    if (!this.bundle.codeVerifier) throw new Error("No PKCE code verifier saved for this source");
    return this.bundle.codeVerifier;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    this.config = { ...this.config, oauth: { ...readOAuthConfig(this.config), discovery: state } };
    await this.persistence.saveConfig(this.config);
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return readOAuthConfig(this.config).discovery;
  }

  // Consumed once by /oauth/start after auth() returns 'REDIRECT'.
  consumeAuthorizationUrl(): URL | null {
    const url = this.capturedAuthorizationUrl;
    this.capturedAuthorizationUrl = null;
    return url;
  }

  // Test/introspection seam only — never used by production routes.
  currentBundle(): TokenBundle {
    return this.bundle;
  }
}

// ── getValidAccessToken's pure decision logic ───────────────────────────────
//
// Returns the bearer to use, plus (only when a refresh actually happened)
// the updated bundle for the I/O layer (./oauth.ts) to persist. Never
// throws; never touches storage itself.

export type AccessTokenDecision = Result<{ accessToken: string; updatedBundle?: TokenBundle }>;

const ACCESS_TOKEN_SKEW_MS = 60_000;

export async function decideAccessToken(
  source: Pick<DataSourceRow, "config" | "secret_enc">,
  fetchFn: typeof fetch = fetch,
): Promise<AccessTokenDecision> {
  let bundle: TokenBundle;
  try {
    bundle = decryptBundleOrThrow(source.secret_enc);
  } catch (e) {
    return { ok: false, kind: "config", reason: `Failed to decrypt stored OAuth credentials: ${(e as Error).message}` };
  }

  const tokens = bundle.tokens;
  const NEEDS_RECONNECT = "Spiro session expired and no refresh token is available — reconnect required";
  if (!tokens?.access_token) {
    return { ok: false, kind: "auth", reason: NEEDS_RECONNECT };
  }

  const stillValid = tokens.expires_at == null || Date.now() < tokens.expires_at - ACCESS_TOKEN_SKEW_MS;
  if (stillValid) {
    return { ok: true, accessToken: tokens.access_token };
  }

  if (!tokens.refresh_token) {
    return { ok: false, kind: "auth", reason: NEEDS_RECONNECT };
  }

  const oauthCfg = readOAuthConfig(source.config);
  const discovery = oauthCfg.discovery;
  const clientInfoRaw = oauthCfg.clientInformation;
  const mcpEndpointUrl = readEndpointUrl(source.config);
  if (!discovery?.authorizationServerUrl || !clientInfoRaw || typeof clientInfoRaw.client_id !== "string" || !mcpEndpointUrl) {
    return { ok: false, kind: "config", reason: "OAuth discovery/client state missing on source — reconnect required" };
  }

  const clientInformation = {
    ...clientInfoRaw,
    ...(bundle.clientSecret ? { client_secret: bundle.clientSecret } : {}),
  } as OAuthClientInformationFull;

  try {
    const resource = await selectResourceURL(
      mcpEndpointUrl,
      // Only `.validateResourceURL` (optional, unset here) is read by
      // selectResourceURL's default path; a full provider isn't needed for
      // this one pure computation.
      {} as unknown as OAuthClientProvider,
      discovery.resourceMetadata,
    );
    const refreshed = await refreshAuthorization(discovery.authorizationServerUrl, {
      metadata: discovery.authorizationServerMetadata,
      clientInformation,
      refreshToken: tokens.refresh_token,
      resource,
      fetchFn,
    });
    const expiresAt = typeof refreshed.expires_in === "number" ? Date.now() + refreshed.expires_in * 1000 : null;
    const updatedBundle: TokenBundle = {
      ...bundle,
      tokens: {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
        expires_at: expiresAt,
        token_type: refreshed.token_type,
        scope: refreshed.scope,
      },
    };
    return { ok: true, accessToken: refreshed.access_token, updatedBundle };
  } catch (e) {
    return mapOAuthError(e);
  }
}
