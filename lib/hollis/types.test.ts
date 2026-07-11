import { test } from "node:test";
import assert from "node:assert/strict";
import type { OrderCard, EscalationInput, SpiroCtx } from "./types";

test("types compile and shape as expected", () => {
  const card: OrderCard = {
    orderId: "o1", trackingCode: "abc", status: "confirmed", addressText: "15 Oak Dr, Mount Pleasant, SC",
    arrivalWindowStart: null, arrivalWindowEnd: null, photographerName: null, agentId: "a1",
  };
  assert.equal(card.trackingCode, "abc");
  const ctx: SpiroCtx = { baseUrl: "https://api.spiro.media", apiKey: "k", authScheme: "bearer" };
  assert.equal(ctx.authScheme, "bearer");
});
