const BASE = "https://api.gateway.attomdata.com/propertyapi/v1.0.0";

function authHeaders() {
  const key = process.env.ATTOM_API_KEY;
  if (!key) throw new Error("ATTOM_API_KEY not set");
  return { apikey: key, Accept: "application/json" };
}

export type AttomPropertyDetail = {
  // raw shape from ATTOM /property/detail
  status: { code: number; msg: string };
  property?: Array<{
    address?: { oneline?: string; line1?: string; locality?: string; countrySubd?: string; postal1?: string };
    summary?: { yearbuilt?: number; proptype?: string; propclass?: string; propsubtype?: string };
    building?: {
      size?: { universalsize?: number; livingsize?: number; bldgsize?: number; grosssize?: number };
      rooms?: { beds?: number; bathstotal?: number; bathsfull?: number; bathshalf?: number };
    };
    lot?: { lotsize1?: number; lotsize2?: number };
  }>;
};

export type SqftLookup =
  | {
      ok: true;
      source: "attom" | "rentcast";
      normalizedAddress: string;
      sqft: number | null;
      beds: number | null;
      baths: number | null;
      yearBuilt: number | null;
      propertyType: string | null;
    }
  | {
      ok: false;
      kind: "not_found" | "error";
      reason: string;
    };

function parseAddress(input: string): { address1: string; address2: string } | null {
  // Accept "123 Main St, Denver, CO 80202" or "123 Main St Denver CO 80202".
  // ATTOM wants: address1 = street, address2 = "<city>, <state> <zip>" (or similar).
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;

  // If a comma separates street from rest, use that.
  if (trimmed.includes(",")) {
    const [street, ...rest] = trimmed.split(",");
    return { address1: street.trim(), address2: rest.join(",").trim() };
  }

  // Otherwise try to split at a 5-digit ZIP or at the state code.
  const zipMatch = trimmed.match(/\b(\d{5})(-\d{4})?$/);
  const stateMatch = trimmed.match(/\b([A-Z]{2})\b/);
  if (zipMatch && stateMatch) {
    const idx = stateMatch.index ?? 0;
    // assume city = word(s) immediately before the state code; street = everything before that
    // crude but works for common cases like "123 Main St Denver CO 80202"
    const before = trimmed.slice(0, idx).trim();
    const after = trimmed.slice(idx).trim();
    const parts = before.split(" ");
    // assume city is the last 1-2 words of `before`
    const city = parts.slice(-2).join(" ");
    const street = parts.slice(0, -2).join(" ") || parts.join(" ");
    return { address1: street, address2: `${city} ${after}`.trim() };
  }

  // Fallback: send whole thing as address1
  return { address1: trimmed, address2: "" };
}

export async function lookupProperty(address: string): Promise<SqftLookup> {
  const parsed = parseAddress(address);
  if (!parsed) return { ok: false, kind: "error", reason: "Could not parse address" };

  const url = new URL(`${BASE}/property/detail`);
  url.searchParams.set("address1", parsed.address1);
  if (parsed.address2) url.searchParams.set("address2", parsed.address2);

  console.log("[attom] GET", url.toString());

  let res: Response;
  try {
    res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  } catch (e) {
    return { ok: false, kind: "error", reason: `Network error reaching ATTOM: ${(e as Error).message}` };
  }

  const text = await res.text();

  // Try to parse JSON regardless of HTTP status — ATTOM uses 400 for "no result"
  // alongside a structured body, which is a "not found" not an error.
  let json: AttomPropertyDetail | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }

  // Auth/key issues: 401/403 with no parseable body
  if (!json) {
    console.error("[attom] non-JSON error", res.status, text.slice(0, 300));
    return { ok: false, kind: "error", reason: `ATTOM ${res.status}: ${text.slice(0, 200)}` };
  }

  const code = json.status?.code;
  const msg = json.status?.msg ?? "";

  // ATTOM "no result" signals:
  //   - status.msg === "SuccessWithoutResult"
  //   - or status.code !== 0 and property array missing/empty
  if (msg === "SuccessWithoutResult" || msg === "no results" || (code !== 0 && !json.property?.[0])) {
    return {
      ok: false,
      kind: "not_found",
      reason: "No property found at that address in the public records",
    };
  }

  if (code !== 0 || !json.property?.[0]) {
    return { ok: false, kind: "error", reason: msg || `ATTOM status code ${code ?? "?"}` };
  }

  const p = json.property[0];
  const size = p.building?.size;
  const sqft = size?.universalsize ?? size?.livingsize ?? size?.bldgsize ?? null;
  const beds = p.building?.rooms?.beds ?? null;
  const baths = p.building?.rooms?.bathstotal ?? null;
  const yearBuilt = p.summary?.yearbuilt ?? null;
  const propertyType = p.summary?.proptype ?? p.summary?.propsubtype ?? null;
  const normalizedAddress = p.address?.oneline ?? address;

  return {
    ok: true,
    source: "attom",
    normalizedAddress,
    sqft,
    beds,
    baths,
    yearBuilt,
    propertyType,
  };
}

export function formatSqftReply(
  lookup: SqftLookup,
  originalInput?: string,
  recentNotFoundCount = 0,
): string {
  if (!lookup.ok) {
    if (lookup.kind === "not_found") {
      const addr = originalInput ? ` *${originalInput}*` : "";
      // 3rd+ not-found from this user in a short window → give up gracefully
      if (recentNotFoundCount >= 3) {
        return `🛑 Couldn't find${addr} after ${recentNotFoundCount} tries.\nThis address doesn't appear in public-record data. It may be a new build, off-market, or in an area with sparse records. If you're sure it's right, the sqft may simply not be available.`;
      }
      const attemptHint = recentNotFoundCount === 2 ? " (try #2)" : "";
      return `🤔 No match for${addr}${attemptHint}.\nPlease double-check the spelling and full address (street, city, state, ZIP) and try again.`;
    }
    return `⚠️ ${lookup.reason}`;
  }
  const lines: string[] = [];
  lines.push(`📍 *${lookup.normalizedAddress}*`);
  const facts: string[] = [];
  if (lookup.sqft != null) facts.push(`${lookup.sqft.toLocaleString()} sqft`);
  if (lookup.beds != null) facts.push(`${lookup.beds} bd`);
  if (lookup.baths != null) facts.push(`${lookup.baths} ba`);
  if (lookup.yearBuilt != null) facts.push(`built ${lookup.yearBuilt}`);
  if (lookup.propertyType) facts.push(lookup.propertyType.toLowerCase());
  if (facts.length) lines.push(facts.join(" · "));
  else lines.push("_(no building details on record)_");
  lines.push(`_source: ${lookup.source}_`);
  return lines.join("\n");
}
