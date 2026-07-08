// lib/analytics/oauth.test.ts
// Tests the PURE half of the MCP OAuth connect flow, lib/analytics/
// oauth-core.ts — never ./oauth.ts directly. oauth.ts pulls in store.ts →
// @/lib/supabase, which throws at import time without Supabase env vars set
// (see store.test.ts's header comment); oauth-core.ts deliberately has no
// such dependency so this file stays fully offline, mirroring the
// store.ts / store-builders.ts split already used in this module.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encryptSecret } from "./crypto";
import {
  OAUTH_REDIRECT_URI,
  SourceOAuthProvider,
  decideAccessToken,
  decryptBundleOrThrow,
  encodeBundle,
  hasStoredTokens,
  mapOAuthError,
  readEndpointUrl,
  signState,
  validateState,
  type SourcePersistence,
  type TokenBundle,
} from "./oauth-core";
import type { DataSourceRow } from "./types";

let _originalKey: string | undefined;
before(() => {
  _originalKey = process.env.ANALYTICS_SECRET_KEY;
  process.env.ANALYTICS_SECRET_KEY = randomBytes(32).toString("base64");
});
after(() => {
  if (_originalKey === undefined) delete process.env.ANALYTICS_SECRET_KEY;
  else process.env.ANALYTICS_SECRET_KEY = _originalKey;
});

function makeSource(overrides: Partial<DataSourceRow> = {}): DataSourceRow {
  return {
    id: "src-1",
    client_id: "client-1",
    kind: "mcp",
    provider: "spiro_mcp",
    label: "Spiro MCP",
    config: { endpointUrl: "https://mcp.spiro.test/mcp", authMode: "oauth" },
    secret_enc: null,
    chat_tool_allowlist: [],
    status: "active",
    last_sync_at: null,
    last_sync_error: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

const throwingFetch: typeof fetch = (async () => {
  throw new Error("fetch should not have been called");
}) as typeof fetch;

// A discovery+clientInformation config block that decideAccessToken needs to
// attempt a refresh (everything short of the token bundle itself).
function oauthConfigBlock(): Record<string, unknown> {
  return {
    endpointUrl: "https://mcp.spiro.test/mcp",
    authMode: "oauth",
    oauth: {
      clientInformation: {
        client_id: "client-abc",
        redirect_uris: [OAUTH_REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
      },
      discovery: {
        authorizationServerUrl: "https://auth.spiro.test",
        authorizationServerMetadata: {
          issuer: "https://auth.spiro.test",
          authorization_endpoint: "https://auth.spiro.test/authorize",
          token_endpoint: "https://auth.spiro.test/token",
          response_types_supported: ["code"],
        },
      },
    },
  };
}

// ── state param: sign/validate roundtrip + tamper/expiry rejection ─────────

test("signState/validateState roundtrips clientId+sourceId", () => {
  const state = signState({ clientId: "c1", sourceId: "s1" });
  const result = validateState(state);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.clientId, "c1");
    assert.equal(result.sourceId, "s1");
  }
});

test("validateState rejects a missing or malformed state", () => {
  const missing = validateState(null);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.kind, "auth");

  const malformed = validateState("not-a-signed-state");
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.match(malformed.reason, /malformed/i);
});

test("validateState rejects a state with a tampered signature", () => {
  const state = signState({ clientId: "c1", sourceId: "s1" });
  const [b64] = state.split(".");
  const r = validateState(`${b64}.${"a".repeat(20)}`);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /signature mismatch/i);
});

test("validateState rejects a state with a tampered payload (signature no longer matches)", () => {
  const state = signState({ clientId: "c1", sourceId: "s1" });
  const [, sig] = state.split(".");
  const forgedPayload = Buffer.from(JSON.stringify({ clientId: "attacker", sourceId: "s1", ts: Date.now() })).toString(
    "base64url",
  );
  const r = validateState(`${forgedPayload}.${sig}`);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /signature mismatch/i);
});

test("validateState rejects a state older than 15 minutes", () => {
  const realNow = Date.now;
  let state = "";
  try {
    Date.now = () => realNow() - 20 * 60 * 1000; // sign as if 20 minutes ago
    state = signState({ clientId: "c1", sourceId: "s1" });
  } finally {
    Date.now = realNow;
  }
  const r = validateState(state);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /expired/i);
});

// ── token bundle: encrypt/decrypt roundtrip + has_tokens derivation ────────

test("encodeBundle/decryptBundleOrThrow roundtrips a full token bundle", () => {
  const bundle: TokenBundle = {
    clientSecret: "shh",
    tokens: {
      access_token: "at1",
      refresh_token: "rt1",
      expires_at: 12345,
      token_type: "Bearer",
      scope: "offline_access",
    },
  };
  assert.deepEqual(decryptBundleOrThrow(encodeBundle(bundle)), bundle);
});

test("decryptBundleOrThrow returns {} for a null secret_enc", () => {
  assert.deepEqual(decryptBundleOrThrow(null), {});
});

test("decryptBundleOrThrow throws on a non-object JSON payload", () => {
  assert.throws(() => decryptBundleOrThrow(encryptSecret("42")), /not a JSON object/);
  assert.throws(() => decryptBundleOrThrow(encryptSecret("[]")), /not a JSON object/);
});

test("hasStoredTokens never throws and only reports true for a real access_token", () => {
  assert.equal(hasStoredTokens(null), false);
  assert.equal(hasStoredTokens(encodeBundle({})), false);
  assert.equal(hasStoredTokens(encodeBundle({ tokens: { access_token: "", token_type: "Bearer" } })), false);
  assert.equal(hasStoredTokens(encodeBundle({ tokens: { access_token: "at1", token_type: "Bearer" } })), true);
  assert.equal(hasStoredTokens("not-a-valid-encrypted-blob"), false);
});

// ── readEndpointUrl ──────────────────────────────────────────────────────────

test("readEndpointUrl requires a non-empty string endpointUrl", () => {
  assert.equal(readEndpointUrl({ endpointUrl: "https://mcp.example.com/mcp" }), "https://mcp.example.com/mcp");
  assert.equal(readEndpointUrl({ endpointUrl: "  " }), null);
  assert.equal(readEndpointUrl({}), null);
  assert.equal(readEndpointUrl({ endpointUrl: 42 }), null);
});

// ── mapOAuthError ────────────────────────────────────────────────────────────

test("mapOAuthError classifies SDK OAuthError subclasses by errorCode/name, not free-text message", () => {
  const invalidGrant = Object.assign(new Error("refresh token revoked"), {
    name: "InvalidGrantError",
    errorCode: "invalid_grant",
  });
  assert.equal(mapOAuthError(invalidGrant).kind, "auth");

  const invalidClient = Object.assign(new Error("who are you"), { name: "InvalidClientError", errorCode: "invalid_client" });
  assert.equal(mapOAuthError(invalidClient).kind, "auth");
});

test("mapOAuthError classifies network failures from the message", () => {
  assert.equal(mapOAuthError(new Error("fetch failed")).kind, "network");
  assert.equal(mapOAuthError(new Error("connect ECONNREFUSED 127.0.0.1:443")).kind, "network");
});

test("mapOAuthError falls back to kind 'error' for unrecognized failures, and never throws", () => {
  assert.equal(mapOAuthError(new Error("something exploded")).kind, "error");
  assert.equal(mapOAuthError("plain string failure").kind, "error");
  assert.equal(mapOAuthError(new Error("boom")).ok, false);
});

// ── decideAccessToken: the refresh-decision logic behind getValidAccessToken ─

test("decideAccessToken returns the cached access token as-is when still valid (no network call)", async () => {
  const source = makeSource({
    secret_enc: encodeBundle({
      tokens: { access_token: "at-valid", refresh_token: "rt-1", expires_at: Date.now() + 10 * 60 * 1000, token_type: "Bearer" },
    }),
  });
  const r = await decideAccessToken(source, throwingFetch);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("unreachable");
  assert.equal(r.accessToken, "at-valid");
  assert.equal(r.updatedBundle, undefined);
});

test("decideAccessToken treats a missing expires_at as non-expiring (no network call)", async () => {
  const source = makeSource({
    secret_enc: encodeBundle({ tokens: { access_token: "at-forever", token_type: "Bearer" } }),
  });
  const r = await decideAccessToken(source, throwingFetch);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.accessToken, "at-forever");
});

test("decideAccessToken respects the 60s expiry skew (expiring in 30s counts as expired)", async () => {
  const source = makeSource({
    config: oauthConfigBlock(),
    secret_enc: encodeBundle({
      tokens: { access_token: "at-almost-gone", refresh_token: "rt-1", expires_at: Date.now() + 30_000, token_type: "Bearer" },
    }),
  });
  let called = false;
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    called = true;
    assert.match(String(init?.body ?? ""), /grant_type=refresh_token/);
    return new Response(JSON.stringify({ access_token: "at-refreshed", token_type: "Bearer", expires_in: 3600 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const r = await decideAccessToken(source, fetchFn);
  assert.equal(called, true, "a token within the 60s skew window must trigger a refresh");
  assert.equal(r.ok, true);
});

test("decideAccessToken returns kind 'auth' when there are no tokens at all", async () => {
  const r = await decideAccessToken(makeSource({ secret_enc: null }), throwingFetch);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.kind, "auth");
    assert.match(r.reason, /reconnect required/i);
  }
});

test("decideAccessToken returns kind 'auth' when the access token is expired and there is no refresh token", async () => {
  const source = makeSource({
    secret_enc: encodeBundle({ tokens: { access_token: "at-old", expires_at: Date.now() - 1000, token_type: "Bearer" } }),
  });
  const r = await decideAccessToken(source, throwingFetch);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.kind, "auth");
    assert.match(r.reason, /reconnect required/i);
  }
});

test("decideAccessToken returns kind 'config' when expired-with-refresh but discovery/client state is missing", async () => {
  const source = makeSource({
    config: { endpointUrl: "https://mcp.spiro.test/mcp", authMode: "oauth" }, // no oauth.discovery/clientInformation
    secret_enc: encodeBundle({
      tokens: { access_token: "at-old", refresh_token: "rt-1", expires_at: Date.now() - 1000, token_type: "Bearer" },
    }),
  });
  const r = await decideAccessToken(source, throwingFetch);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, "config");
});

test("decideAccessToken refreshes via the token endpoint when expired-with-refresh, returning an updated bundle to persist", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response(
      JSON.stringify({ access_token: "at-new", refresh_token: "rt-new", token_type: "Bearer", expires_in: 3600 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const source = makeSource({
    config: oauthConfigBlock(),
    secret_enc: encodeBundle({
      tokens: { access_token: "at-old", refresh_token: "rt-old", expires_at: Date.now() - 1000, token_type: "Bearer" },
    }),
  });

  const r = await decideAccessToken(source, fetchFn);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("unreachable");
  assert.equal(r.accessToken, "at-new");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://auth.spiro.test/token");
  assert.match(calls[0].body, /grant_type=refresh_token/);
  assert.match(calls[0].body, /refresh_token=rt-old/);
  assert.ok(r.updatedBundle, "a refresh must produce an updated bundle for the caller to persist");
  assert.equal(r.updatedBundle?.tokens?.access_token, "at-new");
  assert.equal(r.updatedBundle?.tokens?.refresh_token, "rt-new");
  assert.ok(typeof r.updatedBundle?.tokens?.expires_at === "number" && r.updatedBundle!.tokens!.expires_at! > Date.now());
});

test("decideAccessToken preserves the prior refresh_token when the server's refresh response omits one", async () => {
  const fetchFn = (async () =>
    new Response(JSON.stringify({ access_token: "at-new2", token_type: "Bearer", expires_in: 3600 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const source = makeSource({
    config: oauthConfigBlock(),
    secret_enc: encodeBundle({
      tokens: { access_token: "at-old", refresh_token: "rt-keep", expires_at: Date.now() - 1000, token_type: "Bearer" },
    }),
  });

  const r = await decideAccessToken(source, fetchFn);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("unreachable");
  assert.equal(r.updatedBundle?.tokens?.refresh_token, "rt-keep");
});

test("decideAccessToken maps a revoked-refresh-token (invalid_grant) response to kind 'auth', never throwing", async () => {
  const fetchFn = (async () =>
    new Response(JSON.stringify({ error: "invalid_grant", error_description: "refresh token revoked" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const source = makeSource({
    config: oauthConfigBlock(),
    secret_enc: encodeBundle({
      tokens: { access_token: "at-old", refresh_token: "rt-revoked", expires_at: Date.now() - 1000, token_type: "Bearer" },
    }),
  });

  const r = await decideAccessToken(source, fetchFn);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, "auth");
});

test("decideAccessToken maps a network failure during refresh to kind 'network', never throwing", async () => {
  const fetchFn = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;

  const source = makeSource({
    config: oauthConfigBlock(),
    secret_enc: encodeBundle({
      tokens: { access_token: "at-old", refresh_token: "rt-1", expires_at: Date.now() - 1000, token_type: "Bearer" },
    }),
  });

  const r = await decideAccessToken(source, fetchFn);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, "network");
});

test("decideAccessToken returns kind 'config' (not a throw) when secret_enc is corrupt", async () => {
  const source = makeSource({ secret_enc: "v1:not:a:real-blob" });
  const r = await decideAccessToken(source, throwingFetch);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, "config");
});

// ── SourceOAuthProvider: OAuthClientProvider implementation ────────────────

function fakePersistence(): SourcePersistence & { configWrites: Record<string, unknown>[]; bundleWrites: TokenBundle[] } {
  const configWrites: Record<string, unknown>[] = [];
  const bundleWrites: TokenBundle[] = [];
  return {
    configWrites,
    bundleWrites,
    async saveConfig(config) {
      configWrites.push(config);
    },
    async saveSecretBundle(bundle) {
      bundleWrites.push(bundle);
    },
  };
}

test("SourceOAuthProvider.redirectUrl is the static admin callback URL", () => {
  const provider = new SourceOAuthProvider(makeSource(), fakePersistence());
  assert.equal(provider.redirectUrl, OAUTH_REDIRECT_URI);
  assert.match(provider.redirectUrl, /\/api\/admin\/analytics\/oauth\/callback$/);
});

test("SourceOAuthProvider.state() signs a state that validates back to this source's ids", () => {
  const provider = new SourceOAuthProvider(makeSource({ client_id: "client-9", id: "src-9" }), fakePersistence());
  const state = provider.state();
  const r = validateState(state);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.clientId, "client-9");
    assert.equal(r.sourceId, "src-9");
  }
});

test("SourceOAuthProvider.clientInformation is undefined until saveClientInformation runs", () => {
  const provider = new SourceOAuthProvider(makeSource(), fakePersistence());
  assert.equal(provider.clientInformation(), undefined);
});

test("SourceOAuthProvider.saveClientInformation persists client_id via saveConfig and client_secret (if any) via saveSecretBundle", async () => {
  const persistence = fakePersistence();
  const provider = new SourceOAuthProvider(makeSource(), persistence);
  await provider.saveClientInformation({
    client_id: "client-xyz",
    client_secret: "topsecret",
    redirect_uris: [OAUTH_REDIRECT_URI],
  });

  const info = provider.clientInformation();
  assert.equal(info?.client_id, "client-xyz");
  assert.equal((info as { client_secret?: string })?.client_secret, "topsecret");

  // client_secret must never land in config (non-secret) writes.
  assert.equal(persistence.configWrites.length, 1);
  const oauthCfg = persistence.configWrites[0].oauth as Record<string, unknown>;
  assert.equal((oauthCfg.clientInformation as Record<string, unknown>).client_id, "client-xyz");
  assert.equal("client_secret" in (oauthCfg.clientInformation as Record<string, unknown>), false);

  assert.equal(persistence.bundleWrites.length, 1);
  assert.equal(persistence.bundleWrites[0].clientSecret, "topsecret");
});

test("SourceOAuthProvider.saveTokens computes expires_at from expires_in and preserves the prior refresh_token when omitted", async () => {
  const persistence = fakePersistence();
  const provider = new SourceOAuthProvider(
    makeSource({ secret_enc: encodeBundle({ tokens: { access_token: "old", refresh_token: "rt-orig", token_type: "Bearer" } }) }),
    persistence,
  );
  const before = Date.now();
  await provider.saveTokens({ access_token: "at-1", token_type: "Bearer", expires_in: 120 });
  const bundle = persistence.bundleWrites.at(-1)!;
  assert.equal(bundle.tokens?.access_token, "at-1");
  assert.equal(bundle.tokens?.refresh_token, "rt-orig");
  assert.ok(bundle.tokens!.expires_at! >= before + 119_000 && bundle.tokens!.expires_at! <= before + 121_000);
});

test("SourceOAuthProvider.tokens()/codeVerifier() reflect what was saved, and codeVerifier() throws when unset", async () => {
  const provider = new SourceOAuthProvider(makeSource(), fakePersistence());
  assert.equal(provider.tokens(), undefined);
  assert.throws(() => provider.codeVerifier(), /No PKCE code verifier/);

  await provider.saveCodeVerifier("verifier-123");
  assert.equal(provider.codeVerifier(), "verifier-123");

  await provider.saveTokens({ access_token: "at-1", token_type: "Bearer" });
  assert.equal(provider.tokens()?.access_token, "at-1");
});

test("SourceOAuthProvider constructed with dropExistingTokens ignores a pre-existing token bundle", () => {
  const source = makeSource({
    secret_enc: encodeBundle({ tokens: { access_token: "stale", refresh_token: "rt-stale", token_type: "Bearer" } }),
  });
  const provider = new SourceOAuthProvider(source, fakePersistence(), { dropExistingTokens: true });
  assert.equal(provider.tokens(), undefined);
});

test("SourceOAuthProvider.redirectToAuthorization captures the URL instead of redirecting, consumable once", () => {
  const provider = new SourceOAuthProvider(makeSource(), fakePersistence());
  assert.equal(provider.consumeAuthorizationUrl(), null);
  const url = new URL("https://auth.spiro.test/authorize?client_id=abc");
  provider.redirectToAuthorization(url);
  assert.equal(provider.consumeAuthorizationUrl(), url);
  assert.equal(provider.consumeAuthorizationUrl(), null, "consuming clears it so a stale URL can't be reused");
});

test("SourceOAuthProvider discoveryState round-trips through saveDiscoveryState via saveConfig", async () => {
  const persistence = fakePersistence();
  const provider = new SourceOAuthProvider(makeSource(), persistence);
  assert.equal(provider.discoveryState(), undefined);
  const state = {
    authorizationServerUrl: "https://auth.spiro.test",
    authorizationServerMetadata: {
      issuer: "https://auth.spiro.test",
      authorization_endpoint: "https://auth.spiro.test/authorize",
      token_endpoint: "https://auth.spiro.test/token",
      response_types_supported: ["code"],
    },
  };
  await provider.saveDiscoveryState(state);
  assert.deepEqual(provider.discoveryState(), state);
  assert.equal(persistence.configWrites.length, 1);
});
