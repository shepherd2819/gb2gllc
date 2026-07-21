// All HubSpot HTTP lives in this one file (repo convention — see
// lib/analytics/providers/spiro.ts's header comment). Auth: per-client
// Private App token, sent as `Authorization: Bearer <token>` against
// https://api.hubapi.com. Never throws across the module boundary — every
// function returns HubspotResult<T>.
import type { HubspotContact, HubspotCtx, HubspotResult } from "./types";

type FetchImpl = typeof fetch;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hubspotFetch(
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit = {},
  fetchImpl: FetchImpl = fetch,
): Promise<HubspotResult<any>> {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    return { ok: false, kind: "transient", message: (e as Error).message };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, kind: "auth", message: `HubSpot ${res.status}` };
  if (res.status >= 500) return { ok: false, kind: "transient", message: `HubSpot ${res.status}` };
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    return { ok: false, kind: "transient", message: (e as Error).message };
  }
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, kind: "bad", message: "non-JSON response", status: res.status };
    }
  }
  if (!res.ok) return { ok: false, kind: "bad", message: `HubSpot ${res.status}: ${text.slice(0, 200)}`, status: res.status };
  return { ok: true, value: json };
}

export async function searchContactByEmail(
  ctx: HubspotCtx,
  email: string,
  fetchImpl: FetchImpl = fetch,
): Promise<HubspotResult<HubspotContact[]>> {
  const r = await hubspotFetch(
    ctx.baseUrl,
    ctx.token,
    "/crm/v3/objects/contacts/search",
    {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
        properties: ["email"],
        limit: 10,
      }),
    },
    fetchImpl,
  );
  if (!r.ok) return r;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = Array.isArray(r.value?.results) ? (r.value.results as any[]) : [];
  return { ok: true, value: results.map((c) => ({ id: String(c.id), email: c.properties?.email ?? null })) };
}

// Upserts by ctx.idProperty (a unique property on the Orders object holding
// the Spiro order id). HubSpot 404s a PATCH-by-idProperty when no record
// with that key exists yet — that's the create branch, not an error.
export async function upsertOrder(
  ctx: HubspotCtx,
  orderIdValue: string,
  properties: Record<string, string>,
  fetchImpl: FetchImpl = fetch,
): Promise<HubspotResult<{ id: string }>> {
  const patchPath = `/crm/v3/objects/${encodeURIComponent(ctx.objectType)}/${encodeURIComponent(orderIdValue)}?idProperty=${encodeURIComponent(ctx.idProperty)}`;
  const patched = await hubspotFetch(ctx.baseUrl, ctx.token, patchPath, { method: "PATCH", body: JSON.stringify({ properties }) }, fetchImpl);
  if (patched.ok) return { ok: true, value: { id: String(patched.value.id) } };
  if (patched.status !== 404) return patched;

  const created = await hubspotFetch(
    ctx.baseUrl,
    ctx.token,
    `/crm/v3/objects/${encodeURIComponent(ctx.objectType)}`,
    { method: "POST", body: JSON.stringify({ properties: { ...properties, [ctx.idProperty]: orderIdValue } }) },
    fetchImpl,
  );
  if (!created.ok) return created;
  return { ok: true, value: { id: String(created.value.id) } };
}

export async function createAssociation(
  ctx: HubspotCtx,
  orderObjectId: string,
  contactId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<HubspotResult<true>> {
  const r = await hubspotFetch(
    ctx.baseUrl,
    ctx.token,
    `/crm/v4/objects/${encodeURIComponent(ctx.objectType)}/${encodeURIComponent(orderObjectId)}/associations/contacts/${encodeURIComponent(contactId)}`,
    { method: "PUT", body: JSON.stringify([{ associationCategory: "USER_DEFINED", associationTypeId: ctx.associationTypeId }]) },
    fetchImpl,
  );
  if (!r.ok) return r;
  return { ok: true, value: true };
}

export interface ObjectSchemaInfo {
  objectTypeId: string;
  name: string;
  labelSingular: string;
  properties: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSchemaInfo(s: any): ObjectSchemaInfo {
  return {
    objectTypeId: String(s.objectTypeId ?? s.name),
    name: String(s.name ?? ""),
    labelSingular: String(s.labels?.singular ?? s.name ?? ""),
    properties: Array.isArray(s.properties) ? s.properties.map((p: { name: string }) => String(p.name)) : [],
  };
}

// Lists every custom object schema in the portal (operator setup — Task 10's
// admin route) so the admin can PICK "Orders" from a dropdown, rather than
// the system guessing its internal name/id up front — HubSpot's
// schema-by-name endpoint needs a name we don't have until the admin tells us.
//
// Many portals use HubSpot's own built-in Commerce "Orders" object instead of
// a self-defined custom one (custom objects are Enterprise-tier only; the
// built-in Orders object isn't). That object has metaType HUBSPOT and never
// appears in the custom-only list above — /crm/v3/schemas (no type in the
// path) only ever returns custom-defined schemas, by HubSpot's own design.
// So it's looked up separately by its fixed standard type name and merged in
// when present. A failed lookup here (e.g. Commerce Hub not enabled) just
// means it's absent, not a failure of the whole call.
export async function listObjectSchemas(
  baseUrl: string,
  token: string,
  fetchImpl: FetchImpl = fetch,
): Promise<HubspotResult<ObjectSchemaInfo[]>> {
  const r = await hubspotFetch(baseUrl, token, "/crm/v3/schemas", {}, fetchImpl);
  if (!r.ok) return r;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = Array.isArray(r.value?.results) ? (r.value.results as any[]) : [];
  const schemas = results.map(toSchemaInfo);

  const standardOrders = await hubspotFetch(baseUrl, token, "/crm/v3/schemas/orders", {}, fetchImpl);
  if (standardOrders.ok) schemas.push(toSchemaInfo(standardOrders.value));

  return { ok: true, value: schemas };
}

// One-off introspection to find the association type id backing the
// existing "Associated Orders" panel — never guess or use HubSpot's generic
// default association when a specific labeled one already exists.
export async function introspectAssociationTypeId(
  baseUrl: string,
  token: string,
  fromObjectType: string,
  toObjectType: string,
  fetchImpl: FetchImpl = fetch,
): Promise<HubspotResult<number>> {
  const r = await hubspotFetch(
    baseUrl,
    token,
    `/crm/v4/associations/${encodeURIComponent(fromObjectType)}/${encodeURIComponent(toObjectType)}/labels`,
    {},
    fetchImpl,
  );
  if (!r.ok) return r;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = Array.isArray(r.value?.results) ? (r.value.results as any[]) : [];
  const withLabel = results.find((l) => typeof l.label === "string" && l.label.length > 0) ?? results[0];
  if (!withLabel) return { ok: false, kind: "bad", message: `No association label found from ${fromObjectType} to ${toObjectType}` };
  return { ok: true, value: Number(withLabel.typeId) };
}
