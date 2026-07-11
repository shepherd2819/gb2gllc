import type { OrderCard, SpiroAgent, SpiroCtx } from "./types";

export function toOrderCard(o: any): OrderCard {
  const addr = o?.address ?? {};
  const addressText = [addr.streetAddress || addr.fullAddress, addr.city, addr.stateOrProvince].filter(Boolean).join(", ");
  const appt = o?.primaryAppointment ?? {};
  return {
    orderId: String(o?.orderId ?? ""),
    trackingCode: String(o?.trackingCode ?? ""),
    status: o?.status ?? "unknown",
    addressText,
    arrivalWindowStart: appt.arrivalWindowStart ?? null,
    arrivalWindowEnd: appt.arrivalWindowEnd ?? null,
    photographerName: appt?.photographer?.name ?? null,
    agentId: String(o?.client?.agentId ?? o?.agentId ?? ""),
  };
}

export function toAgent(a: any): SpiroAgent {
  return {
    agentId: String(a?.identity?.agentId ?? a?.agentId ?? ""),
    firstName: a?.identity?.firstName ?? a?.firstName ?? "",
    lastName: a?.identity?.lastName ?? a?.lastName ?? "",
    email: a?.contact?.emailAddress ?? a?.emailAddress ?? null,
    phone: a?.contact?.phoneNumber ?? a?.phoneNumber ?? null,
    companyName: a?.company?.companyName ?? null,
  };
}
