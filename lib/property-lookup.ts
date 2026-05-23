import { lookupProperty as lookupAttom, type SqftLookup } from "./attom";
import { lookupPropertyRentcast, isRentcastConfigured } from "./rentcast";

/**
 * Try ATTOM first (best for owned single-family / condos), fall back to
 * RentCast (better rental + apartment coverage) when ATTOM doesn't have it.
 * Returns the first successful result, or the RentCast result if it was the
 * last one tried. Auth/network errors short-circuit and are returned as-is.
 */
export async function lookupPropertyAll(address: string): Promise<SqftLookup> {
  const attom = await lookupAttom(address);
  if (attom.ok) return attom;
  // If ATTOM blew up (auth/network), don't mask the real problem behind RentCast.
  if (attom.kind === "error") return attom;

  // ATTOM said not_found. Try RentCast if it's configured.
  if (!isRentcastConfigured()) return attom;

  const rc = await lookupPropertyRentcast(address);
  if (rc.ok) return rc;

  // Both not_found → return ATTOM's not_found so the user-facing message is the same shape.
  // If RentCast errored, prefer ATTOM's not_found to keep the message simple.
  return attom;
}
