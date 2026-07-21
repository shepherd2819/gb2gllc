// lib/hubspot-sync/types.ts
// Shared contract for the Elevated Spiro → HubSpot order-attribution sync.
// Leaf module — no repo imports — so anything may depend on it.

export type HubspotResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "auth" | "transient" | "bad"; message: string; status?: number };

// The HubSpot property names this sync writes onto the Orders object (beyond
// the idProperty itself). Both orchestrate.ts (writer) and the admin route
// (select_schema validator) must agree on this exact list.
export const HUBSPOT_ORDER_WRITE_PROPERTIES = [
  "status",
  "tracking_code",
  "address",
  "date_submitted",
  "media_title",
  "photographer",
  "appointment_date",
  "paid",
  "package_details",
] as const;

export interface HubspotCtx {
  baseUrl: string; // always https://api.hubapi.com — kept as a field for testability
  token: string;
  objectType: string; // introspected internal name of the "Orders" custom object
  idProperty: string; // e.g. "spiro_order_id" — the upsert key property
  associationTypeId: number; // introspected association type id for order→contact
}

// Normalized subset of a raw Spiro /api/v1/orders row — the fields this sync
// writes onto HubSpot's Orders object. Superset of lib/hollis/spiro.ts's
// OrderCard (adds dateSubmitted + mediaTitle; drops arrival-window splitting
// in favor of a single appointmentDate string).
export interface SpiroOrderSummary {
  orderId: string;
  trackingCode: string;
  status: string;
  dateSubmitted: string | null;
  addressText: string;
  mediaTitle: string | null;
  photographerName: string | null;
  appointmentDate: string | null;
  agentId: string;
}

export interface HubspotContact {
  id: string;
  email: string | null;
}

export type MatchOutcome =
  | { kind: "matched"; contact: HubspotContact }
  | { kind: "unmatched"; reason: "no_email" | "no_contact" | "ambiguous" };
