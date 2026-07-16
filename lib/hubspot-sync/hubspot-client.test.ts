import { test } from "node:test";
import assert from "node:assert/strict";
import {
  searchContactByEmail,
  upsertOrder,
  createAssociation,
  listObjectSchemas,
  introspectAssociationTypeId,
} from "./hubspot-client";
import type { HubspotCtx } from "./types";

const ctx: HubspotCtx = {
  baseUrl: "https://api.hubapi.test",
  token: "test-token",
  objectType: "2-12345",
  idProperty: "spiro_order_id",
  associationTypeId: 99,
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

test("createAssociation PUTs the association type id", async () => {
  let body: unknown = null;
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const r = await createAssociation(ctx, "obj-1", "c1", fetchImpl);
  assert.equal(r.ok, true);
  assert.equal((body as { associationTypeId: number }[])[0].associationTypeId, 99);
});

test("listObjectSchemas returns every custom object with its properties, so the admin can pick 'Orders' from a list", async () => {
  const r = await listObjectSchemas(
    "https://api.hubapi.test",
    "test-token",
    fakeFetch(200, {
      results: [
        { objectTypeId: "2-12345", name: "orders", labels: { singular: "Order", plural: "Orders" }, properties: [{ name: "spiro_order_id" }, { name: "status" }] },
        { objectTypeId: "2-99999", name: "shoots", labels: { singular: "Shoot", plural: "Shoots" }, properties: [] },
      ],
    }) as unknown as typeof fetch,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.length, 2);
    assert.equal(r.value[0].objectTypeId, "2-12345");
    assert.equal(r.value[0].labelSingular, "Order");
    assert.deepEqual(r.value[0].properties, ["spiro_order_id", "status"]);
  }
});

test("introspectAssociationTypeId returns the first labeled association type", async () => {
  const r = await introspectAssociationTypeId(
    "https://api.hubapi.test",
    "test-token",
    "2-12345",
    "contacts",
    fakeFetch(200, { results: [{ typeId: 99, label: "Associated Orders" }] }) as unknown as typeof fetch,
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 99);
});
