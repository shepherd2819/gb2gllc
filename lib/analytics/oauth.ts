// lib/analytics/oauth.ts
//
// MCP OAuth "Connect" flow — login once (interactively, in the admin's
// browser), then sync headlessly forever via a stored refresh token. Built
// on @modelcontextprotocol/sdk's client OAuth support (client/auth.js
// `auth()` orchestrator: discovery, Dynamic Client Registration, PKCE, code
// exchange). See ./oauth-core.ts's header for the exact SDK API surface and
// a documented deviation (getValidAccessToken's refresh path).
//
// This file is the THIN, DB-touching half of the module. All persistence-
// free logic (state signing/validation, token-bundle codec, the
// OAuthClientProvider implementation, and getValidAccessToken's refresh
// DECISION) lives in ./oauth-core, which does not import "@/lib/supabase" —
// so it's unit-testable offline (see oauth.test.ts). This file wires that
// core to lib/analytics/store.ts and is intentionally left untested
// directly, mirroring the store.ts / store-builders.ts split already used
// in this module (store.test.ts's header comment explains why).

import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  SourceOAuthProvider,
  decideAccessToken,
  decryptBundleOrThrow,
  encodeBundle,
  hasStoredTokens,
  mapOAuthError,
  readEndpointUrl,
  validateState,
  type SourcePersistence,
  type TokenBundle,
} from "@/lib/analytics/oauth-core";
import { getSource, setSourceStatus, updateSourceConfig, updateSourceSecret } from "@/lib/analytics/store";
import type { DataSourceRow, Result } from "@/lib/analytics/types";

export { hasStoredTokens, validateState };

function realPersistence(sourceId: string): SourcePersistence {
  return {
    saveConfig: (config) => updateSourceConfig(sourceId, config),
    saveSecretBundle: (bundle) => updateSourceSecret(sourceId, encodeBundle(bundle)),
  };
}

// Starts the interactive flow: discovery + DCR + PKCE, persisting client
// info / discovery state / code verifier as the SDK's auth() produces them.
// Returns the authorization URL for the ROUTE to 302 the admin's browser to
// — this function never redirects anything itself (no browser here).
export async function beginConnect(
  sourceId: string,
  tenantClientId: string,
  mcpEndpointUrl: string,
): Promise<Result<{ authorizationUrl: string }>> {
  try {
    const source = await getSource(sourceId);
    if (!source || source.client_id !== tenantClientId) {
      return { ok: false, kind: "config", reason: "Source not found for this client" };
    }

    const config: Record<string, unknown> = { ...source.config, authMode: "oauth", endpointUrl: mcpEndpointUrl };
    await updateSourceConfig(sourceId, config);

    // dropExistingTokens: clicking "Connect / Log in" always starts a fresh
    // interactive login (e.g. reconnecting as a different Spiro user) rather
    // than silently refreshing whatever tokens happen to be on file — the
    // SDK's auth() only takes the "start new authorization" branch when
    // tokens() returns undefined.
    const provider = new SourceOAuthProvider({ ...source, config }, realPersistence(sourceId), {
      dropExistingTokens: true,
    });
    const result = await auth(provider, { serverUrl: mcpEndpointUrl });
    const authorizationUrl = provider.consumeAuthorizationUrl();
    if (result !== "REDIRECT" || !authorizationUrl) {
      return { ok: false, kind: "error", reason: `Unexpected OAuth start result: ${result}` };
    }
    return { ok: true, authorizationUrl: authorizationUrl.toString() };
  } catch (e) {
    return mapOAuthError(e);
  }
}

// Completes the flow after the authorization-server redirect delivers a
// `code`: exchanges it for tokens (persisted via provider.saveTokens() as
// part of the SDK's auth() call), then clears the now-spent PKCE verifier
// and marks the source active.
// Result<{}> mirrors the brief's spec exactly: ok:true with no extra fields
// (Record<string, never> is unusable here — its index signature conflicts
// with the literal `ok: true` property).
export async function completeConnect(
  sourceId: string,
  tenantClientId: string,
  code: string,
): Promise<Result<{}>> {
  try {
    const source = await getSource(sourceId);
    if (!source || source.client_id !== tenantClientId) {
      return { ok: false, kind: "config", reason: "Source not found for this client" };
    }
    const mcpEndpointUrl = readEndpointUrl(source.config);
    if (!mcpEndpointUrl) {
      return { ok: false, kind: "config", reason: "Source is missing endpointUrl" };
    }

    const provider = new SourceOAuthProvider(source, realPersistence(sourceId));
    const result = await auth(provider, { serverUrl: mcpEndpointUrl, authorizationCode: code });
    if (result !== "AUTHORIZED") {
      return { ok: false, kind: "auth", reason: `OAuth code exchange did not complete (result=${result})` };
    }

    // Tokens are already persisted (provider.saveTokens ran inside auth()).
    // Re-read so we drop the now-unneeded PKCE verifier without racing/
    // clobbering the tokens saveTokens() just wrote.
    const fresh = await getSource(sourceId);
    const bundle: TokenBundle = decryptBundleOrThrow(fresh?.secret_enc ?? null);
    delete bundle.codeVerifier;
    await updateSourceSecret(sourceId, encodeBundle(bundle));
    await setSourceStatus(sourceId, "active");

    return { ok: true };
  } catch (e) {
    return mapOAuthError(e);
  }
}

// Returns a bearer usable right now: the cached access token if still valid
// (skew-aware), otherwise refreshes via the stored refresh token and
// persists the result. Never throws.
export async function getValidAccessToken(
  source: DataSourceRow,
  fetchFn: typeof fetch = fetch,
): Promise<Result<{ accessToken: string }>> {
  const decision = await decideAccessToken(source, fetchFn);
  if (!decision.ok) return decision;
  if (decision.updatedBundle) {
    try {
      await updateSourceSecret(source.id, encodeBundle(decision.updatedBundle));
    } catch (e) {
      // The fresh access token is still good for THIS call — don't fail the
      // caller's sync over a persistence hiccup — but log loudly, since the
      // next call will otherwise refresh again needlessly (or worse, race).
      console.error(`[analytics/oauth] failed to persist refreshed tokens for source ${source.id}`, e);
    }
  }
  return { ok: true, accessToken: decision.accessToken };
}
