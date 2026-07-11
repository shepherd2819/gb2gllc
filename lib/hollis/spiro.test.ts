import { test } from "node:test";
import assert from "node:assert/strict";
import { toOrderCard, toAgent } from "./spiro";

const rawOrder = {
  orderId: "o1", trackingCode: "r2m360pl1", status: "confirmed",
  address: { streetAddress: "15 Oak Dr", fullAddress: "15 Oak Dr, Mount Pleasant, SC 29466", city: "Mount Pleasant", stateOrProvince: "SC", postalCode: "29466" },
  client: { agentId: "a1", agentName: "Vanessa B", companyName: "Unassigned" },
  primaryAppointment: { appointmentId: "ap1", arrivalWindowStart: "2026-07-14T14:30:00-04:00", arrivalWindowEnd: "2026-07-14T14:30:00-04:00", photographer: { photographerId: "p1", name: "Taylor Thurber" } },
};

test("toOrderCard flattens the verified order shape", () => {
  const c = toOrderCard(rawOrder);
  assert.equal(c.trackingCode, "r2m360pl1");
  assert.equal(c.status, "confirmed");
  assert.equal(c.addressText, "15 Oak Dr, Mount Pleasant, SC");
  assert.equal(c.arrivalWindowStart, "2026-07-14T14:30:00-04:00");
  assert.equal(c.photographerName, "Taylor Thurber");
  assert.equal(c.agentId, "a1");
});

test("toAgent flattens nested identity/contact/company", () => {
  const a = toAgent({ identity: { agentId: "a1", firstName: "Vanessa", lastName: "Beem" }, contact: { emailAddress: "v@x.com", phoneNumber: "+18435551234" }, company: { companyName: "ACME" } });
  assert.equal(a.agentId, "a1");
  assert.equal(a.phone, "+18435551234");
  assert.equal(a.companyName, "ACME");
});
