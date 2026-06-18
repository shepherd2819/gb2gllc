// Thin Retell REST client. ALL Retell HTTP lives here so a future swap to
// Vapi/LiveKit touches one file (the portability commitment in the spec).
//
// ⚠️ CONFIRM AGAINST docs.retellai.com AT BUILD TIME: exact endpoint paths,
// request/response bodies, and the number-provisioning flow. Response types are
// intentionally loose (unknown) so we don't over-commit to shapes we haven't
// verified against the live API.

import { getHollisSecrets } from "./env";

const RETELL_BASE = process.env.RETELL_BASE_URL ?? "https://api.retellai.com";

function authHeader(): string {
  const s = getHollisSecrets();
  if (!s.ok) throw new Error(`Retell secrets missing in env: ${s.missing.join(", ")}`);
  return `Bearer ${s.retellApiKey}`;
}

async function retellFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${RETELL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Retell ${path} failed ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return res.json() as Promise<T>;
}

export type RetellCall = {
  call_id: string;
  to_number?: string;
  from_number?: string;
  transcript?: unknown;
  recording_url?: string;
  duration_ms?: number;
  disconnection_reason?: string;
  [k: string]: unknown;
};

export type ProvisionedNumber = {
  phone_number: string;
  phone_number_id?: string;
  [k: string]: unknown;
};

export function getCall(callId: string): Promise<RetellCall> {
  return retellFetch<RetellCall>(`/v2/get-call/${callId}`, { method: "GET" });
}

export function buyNumber(opts: { areaCode?: number; inboundAgentId?: string }): Promise<ProvisionedNumber> {
  return retellFetch<ProvisionedNumber>(`/create-phone-number`, {
    method: "POST",
    body: JSON.stringify({
      ...(opts.areaCode ? { area_code: opts.areaCode } : {}),
      ...(opts.inboundAgentId ? { inbound_agent_id: opts.inboundAgentId } : {}),
    }),
  });
}

export function bindNumberWebhooks(numberId: string, opts: { inboundAgentId?: string }): Promise<unknown> {
  return retellFetch(`/update-phone-number/${numberId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(opts.inboundAgentId ? { inbound_agent_id: opts.inboundAgentId } : {}),
    }),
  });
}

export function releaseNumber(numberId: string): Promise<unknown> {
  return retellFetch(`/delete-phone-number/${numberId}`, { method: "DELETE" });
}

// Warm-transfer an in-progress call to a human. Confirm the exact endpoint/body.
export function transferCall(callId: string, toNumber: string): Promise<unknown> {
  return retellFetch(`/transfer-call`, {
    method: "POST",
    body: JSON.stringify({ call_id: callId, transfer_to: toNumber }),
  });
}
