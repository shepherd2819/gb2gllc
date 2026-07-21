import { test } from "node:test";
import assert from "node:assert/strict";
import {
  searchContactByEmail,
  upsertOrder,
  createAssociation,
  listObjectSchemas,
  introspectAssociationTypeId,
  fetchPipelineStages,
} from "./hubspot-client";
import type { HubspotCtx } from "./types";

const ctx: HubspotCtx = {
  baseUrl: "https://api.hubapi.test",
  token: "test-token",
  objectType: "2-12345",
  idProperty: "spiro_order_id",
  associationTypeId: 99,
  associationCategory: "USER_DEFINED",
};

function fakeFetch(status: number, body: unknown) {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("searchContactByEmail returns matches", async () => {
  const r = await searchContactByEmail(
    ctx,
    "v@x.com",
    fakeFetch(200, { results: [{ id: "c1", properties: { email: "v@x.com" } }] }) as unknown as typeof fetch,
  );
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.value.length, 1); assert.equal(r.value[0].id, "c1"); }
});

test("searchContactByEmail returns an empty array on no matches", async () => {
  const r = await searchContactByEmail(ctx, "nobody@x.com", fakeFetch(200, { results: [] }) as unknown as typeof fetch);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.length, 0);
});

test("searchContactByEmail maps a 401 to auth", async () => {
  const r = await searchContactByEmail(ctx, "v@x.com", fakeFetch(401, {}) as unknown as typeof fetch);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, "auth");
});

test("upsertOrder PATCHes by idProperty when the record already exists", async () => {
  let method = "";
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    method = init?.method ?? "";
    return new Response(JSON.stringify({ id: "obj-1" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const r = await upsertOrder(ctx, "order-123", { status: "confirmed" }, fetchImpl);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.id, "obj-1");
  assert.equal(method, "PATCH");
});

test("upsertOrder falls back to POST create when the PATCH 404s (record doesn't exist yet)", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    calls.push(init?.method ?? "");
    if (init?.method === "PATCH") return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    return new Response(JSON.stringify({ id: "obj-2" }), { status: 201, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const r = await upsertOrder(ctx, "order-456", { status: "pending" }, fetchImpl);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.id, "obj-2");
  assert.deepEqual(calls, ["PATCH", "POST"]);
});

test("upsertOrder does NOT fall back to POST create when the PATCH fails with a non-404 status", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    calls.push(init?.method ?? "");
    return new Response(JSON.stringify({ message: "Property values were not valid" }), { status: 400, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const r = await upsertOrder(ctx, "order-789", { status: "bogus" }, fetchImpl);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.kind, "bad");
    assert.equal(r.status, 400);
  }
  assert.deepEqual(calls, ["PATCH"]);
});

test("searchContactByEmail maps a res.text() rejection to a clean transient result instead of throwing", async () => {
  const fetchImpl = (async () =>
    ({
      status: 200,
      ok: true,
      text: async () => {
        throw new Error("body stream aborted");
      },
    }) as unknown as Response) as unknown as typeof fetch;
  const r = await searchContactByEmail(ctx, "v@x.com", fetchImpl);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.kind, "transient");
    assert.equal(r.message, "body stream aborted");
  }
});

test("createAssociation PUTs the association type id and category from ctx", async () => {
  let body: unknown = null;
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const r = await createAssociation(ctx, "obj-1", "c1", fetchImpl);
  assert.equal(r.ok, true);
  assert.equal((body as { associationTypeId: number }[])[0].associationTypeId, 99);
  assert.equal((body as { associationCategory: string }[])[0].associationCategory, "USER_DEFINED");
});

test("createAssociation sends HUBSPOT_DEFINED when that's the ctx's category — never hardcodes USER_DEFINED", async () => {
  let body: unknown = null;
  const hubspotDefinedCtx: HubspotCtx = { ...ctx, associationCategory: "HUBSPOT_DEFINED" };
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const r = await createAssociation(hubspotDefinedCtx, "obj-1", "c1", fetchImpl);
  assert.equal(r.ok, true);
  assert.equal((body as { associationCategory: string }[])[0].associationCategory, "HUBSPOT_DEFINED");
});

function fakeFetchByPath(byPath: Record<string, { status: number; body: unknown }>) {
  return (async (url: unknown) => {
    const path = String(url).replace("https://api.hubapi.test", "");
    const entry = byPath[path] ?? { status: 404, body: { message: "not found" } };
    return new Response(JSON.stringify(entry.body), { status: entry.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

test("listObjectSchemas returns every custom object with its properties, so the admin can pick 'Orders' from a list", async () => {
  const r = await listObjectSchemas(
    "https://api.hubapi.test",
    "test-token",
    fakeFetchByPath({
      "/crm/v3/schemas": {
        status: 200,
        body: {
          results: [
            { objectTypeId: "2-12345", name: "orders", labels: { singular: "Order", plural: "Orders" }, properties: [{ name: "spiro_order_id" }, { name: "status" }] },
            { objectTypeId: "2-99999", name: "shoots", labels: { singular: "Shoot", plural: "Shoots" }, properties: [] },
          ],
        },
      },
      "/crm/v3/schemas/orders": { status: 404, body: { message: "not found" } },
    }),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.length, 2);
    assert.equal(r.value[0].objectTypeId, "2-12345");
    assert.equal(r.value[0].labelSingular, "Order");
    assert.deepEqual(r.value[0].properties, ["spiro_order_id", "status"]);
  }
});

test("listObjectSchemas merges in HubSpot's built-in Commerce Orders object when present, since it never appears in the custom-only list", async () => {
  const r = await listObjectSchemas(
    "https://api.hubapi.test",
    "test-token",
    fakeFetchByPath({
      "/crm/v3/schemas": { status: 200, body: { results: [] } },
      "/crm/v3/schemas/orders": {
        status: 200,
        body: {
          objectTypeId: "0-123",
          name: "orders",
          labels: { singular: "Order", plural: "Orders" },
          properties: [{ name: "spiro_order_id" }, { name: "hs_pipeline_stage" }],
        },
      },
    }),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.length, 1);
    assert.equal(r.value[0].objectTypeId, "0-123");
    assert.equal(r.value[0].labelSingular, "Order");
  }
});

test("listObjectSchemas silently omits the standard Orders object when the portal doesn't have it (e.g. Commerce Hub disabled)", async () => {
  const r = await listObjectSchemas(
    "https://api.hubapi.test",
    "test-token",
    fakeFetchByPath({
      "/crm/v3/schemas": {
        status: 200,
        body: { results: [{ objectTypeId: "2-12345", name: "shoots", labels: { singular: "Shoot", plural: "Shoots" }, properties: [] }] },
      },
      "/crm/v3/schemas/orders": { status: 404, body: { message: "not found" } },
    }),
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.length, 1);
});

test("introspectAssociationTypeId returns the first labeled association type's id and category together", async () => {
  const r = await introspectAssociationTypeId(
    "https://api.hubapi.test",
    "test-token",
    "2-12345",
    "contacts",
    fakeFetch(200, { results: [{ typeId: 99, category: "USER_DEFINED", label: "Associated Orders" }] }) as unknown as typeof fetch,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.typeId, 99);
    assert.equal(r.value.category, "USER_DEFINED");
  }
});

test("introspectAssociationTypeId preserves HUBSPOT_DEFINED for the standard Orders object's built-in association (e.g. 'Billing Contact') — never assumes USER_DEFINED", async () => {
  const r = await introspectAssociationTypeId(
    "https://api.hubapi.test",
    "test-token",
    "orders",
    "contacts",
    fakeFetch(200, { results: [{ typeId: 2694, category: "HUBSPOT_DEFINED", label: "Billing Contact" }] }) as unknown as typeof fetch,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.typeId, 2694);
    assert.equal(r.value.category, "HUBSPOT_DEFINED");
  }
});

test("fetchPipelineStages flattens stages across every pipeline for the object type", async () => {
  const r = await fetchPipelineStages(
    "https://api.hubapi.test",
    "test-token",
    "0-123",
    fakeFetch(200, {
      results: [
        {
          label: "Order Pipeline",
          stages: [
            { label: "Open", id: "s-open" },
            { label: "Processed", id: "s-processed" },
          ],
        },
      ],
    }) as unknown as typeof fetch,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.value, [
      { label: "Open", id: "s-open" },
      { label: "Processed", id: "s-processed" },
    ]);
  }
});
