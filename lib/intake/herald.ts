// Herald-only intake link: pure decision helpers shared by the submit route,
// the admin convert route, the Notion serializer, and the admin submission UI.

export const HERALD_PRODUCT = "herald";
export const HERALD_SOURCE = "herald-link";

// Same permissive regex the intake forms use client-side.
export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && /\S+@\S+\.\S+/.test(email);
}

export type HeraldAnswers = {
  website: { url: string; platform: string; snippetAccess: string };
  knowledge: { services: string; faqs: string; hours: string; policies: string };
  voice: { agentName: string; tone: string; avoid: string };
  leads: { destination: string; contact: string; bookingLink: string };
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function heraldAnswers(state: Rec): HeraldAnswers {
  const h = rec(state.herald);
  const w = rec(h.website);
  const k = rec(h.knowledge);
  const v = rec(h.voice);
  const l = rec(h.leads);
  return {
    website: { url: str(w.url), platform: str(w.platform), snippetAccess: str(w.snippetAccess) },
    knowledge: { services: str(k.services), faqs: str(k.faqs), hours: str(k.hours), policies: str(k.policies) },
    voice: { agentName: str(v.agentName), tone: str(v.tone), avoid: str(v.avoid) },
    leads: { destination: str(l.destination), contact: str(l.contact), bookingLink: str(l.bookingLink) },
  };
}

export type HeraldAutomationPlan = {
  enableProduct: boolean;
  setAgentName: string | null;
  sendInvite: boolean;
};

export function planHeraldAutomation(opts: {
  intendedProduct: string | null;
  email: unknown;
  agentName: string;
  client: { chatbot_agent_name: string | null; invited_at: string | null } | null;
}): HeraldAutomationPlan {
  const off: HeraldAutomationPlan = { enableProduct: false, setAgentName: null, sendInvite: false };
  if (opts.intendedProduct !== HERALD_PRODUCT) return off;
  if (!isValidEmail(opts.email)) return off;
  if (!opts.client) return off;
  const name = opts.agentName.trim();
  return {
    enableProduct: true,
    setAgentName: name && !opts.client.chatbot_agent_name ? name : null,
    sendInvite: !opts.client.invited_at,
  };
}
