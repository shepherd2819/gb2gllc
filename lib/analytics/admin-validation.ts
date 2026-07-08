// lib/analytics/admin-validation.ts
// Pure request-body validation for the admin analytics source routes.
// No I/O here — unit-tested without env vars or network.
import type { SourceKind } from "./types";

export type SourceCreateInput = {
  kind: SourceKind;
  provider: string;
  label: string;
  config: Record<string, unknown>;
  secret?: string;
  chat_tool_allowlist?: string[];
};

export type SourcePatchInput = {
  label?: string;
  config?: Record<string, unknown>;
  status?: "active" | "paused";
  chat_tool_allowlist?: string[];
  secret?: string;
};

export type Validated<T> = { ok: true; value: T } | { ok: false; reason: string };

const KINDS: readonly SourceKind[] = ["mcp", "rest"];

// Authoritative provider whitelist. Deliberately NOT derived from
// getAdapter()'s `REGISTRY[provider] ?? null` lookup: REGISTRY is a plain
// object literal, so REGISTRY["__proto__"] resolves to Object.prototype
// (truthy) and REGISTRY["constructor"] resolves to the inherited Object
// constructor (also truthy) — both would sail through a truthiness check.
// Array#includes has no prototype-chain lookup, so it's safe by construction.
export const KNOWN_PROVIDERS = ["spiro", "spiro_mcp", "generic_mcp"] as const;

export function isKnownProvider(provider: string): boolean {
  return (KNOWN_PROVIDERS as readonly string[]).includes(provider);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseLabel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const label = v.trim();
  if (label.length < 1 || label.length > 80) return null;
  return label;
}

function parseAllowlist(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x): x is string => typeof x === "string")) return null;
  return v;
}

export function validateSourceCreate(
  body: unknown,
  isKnownProvider: (provider: string) => boolean,
): Validated<SourceCreateInput> {
  if (!isPlainObject(body)) return { ok: false, reason: "Body must be a JSON object" };

  if (!KINDS.includes(body.kind as SourceKind)) {
    return { ok: false, reason: "kind must be 'mcp' or 'rest'" };
  }
  if (typeof body.provider !== "string" || !isKnownProvider(body.provider)) {
    return { ok: false, reason: "Unknown provider" };
  }
  const label = parseLabel(body.label);
  if (!label) return { ok: false, reason: "label must be 1-80 characters" };

  const config = body.config === undefined ? {} : body.config;
  if (!isPlainObject(config)) return { ok: false, reason: "config must be a plain object" };

  let secret: string | undefined;
  if (body.secret !== undefined) {
    if (typeof body.secret !== "string" || body.secret.length === 0) {
      return { ok: false, reason: "secret must be a non-empty string" };
    }
    secret = body.secret;
  }

  let chat_tool_allowlist: string[] | undefined;
  if (body.chat_tool_allowlist !== undefined) {
    const parsed = parseAllowlist(body.chat_tool_allowlist);
    if (!parsed) return { ok: false, reason: "chat_tool_allowlist must be an array of strings" };
    chat_tool_allowlist = parsed;
  }

  return {
    ok: true,
    value: { kind: body.kind as SourceKind, provider: body.provider, label, config, secret, chat_tool_allowlist },
  };
}

export function validateSourcePatch(body: unknown): Validated<SourcePatchInput> {
  if (!isPlainObject(body)) return { ok: false, reason: "Body must be a JSON object" };
  const out: SourcePatchInput = {};

  if (body.label !== undefined) {
    const label = parseLabel(body.label);
    if (!label) return { ok: false, reason: "label must be 1-80 characters" };
    out.label = label;
  }
  if (body.config !== undefined) {
    if (!isPlainObject(body.config)) return { ok: false, reason: "config must be a plain object" };
    out.config = body.config;
  }
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "paused") {
      return { ok: false, reason: "status must be 'active' or 'paused'" };
    }
    out.status = body.status;
  }
  if (body.chat_tool_allowlist !== undefined) {
    const parsed = parseAllowlist(body.chat_tool_allowlist);
    if (!parsed) return { ok: false, reason: "chat_tool_allowlist must be an array of strings" };
    out.chat_tool_allowlist = parsed;
  }
  if (body.secret !== undefined) {
    if (typeof body.secret !== "string" || body.secret.length === 0) {
      return { ok: false, reason: "secret must be a non-empty string" };
    }
    out.secret = body.secret;
  }

  if (Object.keys(out).length === 0) return { ok: false, reason: "No valid fields to update" };
  return { ok: true, value: out };
}
