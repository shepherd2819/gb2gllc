import type { SqftLookup } from "./attom";

const BASE = "https://api.rentcast.io/v1";

function authHeaders() {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) throw new Error("RENTCAST_API_KEY not set");
  return { "X-Api-Key": key, Accept: "application/json" };
}

export function isRentcastConfigured() {
  return !!process.env.RENTCAST_API_KEY;
}

// Loose typing — RentCast returns a flat-ish object; we only depend on a few fields.
type RentcastProperty = {
  id?: string;
  formattedAddress?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  yearBuilt?: number;
};

export async function lookupPropertyRentcast(address: string): Promise<SqftLookup> {
  const url = new URL(`${BASE}/properties`);
  url.searchParams.set("address", address);

  console.log("[rentcast] GET", url.toString());

  let res: Response;
  try {
    res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  } catch (e) {
    return { ok: false, kind: "error", reason: `Network error reaching RentCast: ${(e as Error).message}` };
  }

  const text = await res.text();

  if (res.status === 401 || res.status === 403) {
    return { ok: false, kind: "error", reason: `RentCast auth error (${res.status}). Check RENTCAST_API_KEY.` };
  }

  if (res.status === 404) {
    return { ok: false, kind: "not_found", reason: "No RentCast match for that address" };
  }

  if (!res.ok) {
    console.error("[rentcast] error", res.status, text.slice(0, 300));
    return { ok: false, kind: "error", reason: `RentCast ${res.status}: ${text.slice(0, 200)}` };
  }

  let body: RentcastProperty | RentcastProperty[];
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, kind: "error", reason: "RentCast returned non-JSON" };
  }

  const first = Array.isArray(body) ? body[0] : body;
  if (!first || (!first.squareFootage && !first.bedrooms && !first.bathrooms)) {
    return { ok: false, kind: "not_found", reason: "RentCast has no record for that address" };
  }

  return {
    ok: true,
    source: "rentcast",
    normalizedAddress: first.formattedAddress
      ?? [first.addressLine1, first.city, first.state, first.zipCode].filter(Boolean).join(", ")
      ?? address,
    sqft: first.squareFootage ?? null,
    beds: first.bedrooms ?? null,
    baths: first.bathrooms ?? null,
    yearBuilt: first.yearBuilt ?? null,
    propertyType: first.propertyType ?? null,
  };
}
