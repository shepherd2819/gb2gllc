// Thin Retell REST client. ALL Retell HTTP lives here so a future swap to
// Vapi/LiveKit touches one file (the portability commitment in the spec).
//
// Endpoints/params confirmed against docs.retellai.com (2026):
//   POST   /create-phone-number   — provision a Retell-managed (Twilio/Telnyx) number
//   POST   /import-phone-number    — bring a SIP/BYO number
//   PATCH  /update-phone-number/{phone_number}
//   DELETE /delete-phone-number/{phone_number}
// Auth is `Authorization: Bearer <RETELL_API_KEY>`. Numbers are identified by
// their E.164 string in the path. Warm transfer is configured on the agent
// (transfer destination) and triggered by the transfer_to_human tool, so it is
// NOT a REST call here.

import { getHollisSecrets } from "./env";

const RETELL_BASE = process.env.RETELL_BASE_URL ?? "https://api.retellai.com";

function authHeader(): string {
  const s = getHollisSecrets();
  if (!s.ok) throw new Error(`Retell secret missing in env: ${s.missing.join(", ")}`);
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

export type RetellPhoneNumber = {
  phone_number: string;
  phone_number_pretty?: string;
  phone_number_type?: "retell-twilio" | "retell-telnyx" | "custom";
  nickname?: string;
  [k: string]: unknown;
};

export type CreateNumberOpts = {
  areaCode?: number;
  inboundAgentId?: string;
  nickname?: string;
  inboundWebhookUrl?: string;
  numberProvider?: "twilio" | "telnyx";
};

export function createPhoneNumber(opts: CreateNumberOpts): Promise<RetellPhoneNumber> {
  return retellFetch<RetellPhoneNumber>("/create-phone-number", {
    method: "POST",
    body: JSON.stringify({
      ...(opts.areaCode ? { area_code: opts.areaCode } : {}),
      ...(opts.inboundAgentId ? { inbound_agents: [{ agent_id: opts.inboundAgentId }] } : {}),
      ...(opts.nickname ? { nickname: opts.nickname } : {}),
      ...(opts.inboundWebhookUrl ? { inbound_webhook_url: opts.inboundWebhookUrl } : {}),
      ...(opts.numberProvider ? { number_provider: opts.numberProvider } : {}),
    }),
  });
}

export function importPhoneNumber(opts: {
  phoneNumber: string;
  terminationUri: string;
  inboundAgentId?: string;
  inboundWebhookUrl?: string;
}): Promise<RetellPhoneNumber> {
  return retellFetch<RetellPhoneNumber>("/import-phone-number", {
    method: "POST",
    body: JSON.stringify({
      phone_number: opts.phoneNumber,
      termination_uri: opts.terminationUri,
      ...(opts.inboundAgentId ? { inbound_agents: [{ agent_id: opts.inboundAgentId }] } : {}),
      ...(opts.inboundWebhookUrl ? { inbound_webhook_url: opts.inboundWebhookUrl } : {}),
    }),
  });
}

export function updatePhoneNumber(
  phoneNumber: string,
  opts: { inboundAgentId?: string; inboundWebhookUrl?: string },
): Promise<RetellPhoneNumber> {
  return retellFetch<RetellPhoneNumber>(`/update-phone-number/${encodeURIComponent(phoneNumber)}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(opts.inboundAgentId ? { inbound_agents: [{ agent_id: opts.inboundAgentId }] } : {}),
      ...(opts.inboundWebhookUrl ? { inbound_webhook_url: opts.inboundWebhookUrl } : {}),
    }),
  });
}

export function deletePhoneNumber(phoneNumber: string): Promise<unknown> {
  return retellFetch(`/delete-phone-number/${encodeURIComponent(phoneNumber)}`, { method: "DELETE" });
}

export type WebCall = { access_token: string; call_id: string; [k: string]: unknown };

// Browser voice demo: no phone number — the frontend connects with the returned
// access_token via RetellWebClient.startCall(). Token is single-use within 30s.
// docs.retellai.com/deploy/web-call
export function createWebCall(agentId: string, dynamicVariables?: Record<string, string>): Promise<WebCall> {
  return retellFetch<WebCall>("/v2/create-web-call", {
    method: "POST",
    body: JSON.stringify({
      agent_id: agentId,
      ...(dynamicVariables ? { retell_llm_dynamic_variables: dynamicVariables } : {}),
      metadata: { source: "web_demo" },
    }),
  });
}
