// The 5 Claude tool/function schemas Hollis exposes during a call, plus the
// dispatch() executor. Each tool returns a short, spoken-form-normalized string
// the agent can say. Reads (FAQ) hit Supabase; capture/delivery side-effects are
// recorded on the call context and delivered post-call (never block the turn).

import { toSpokenForm } from "./normalize";
import { normalizeCallerNumber } from "./phone";
import {
  loadSpiroCtx as realLoadSpiroCtx, findAgentByPhone as realFindByPhone, findAgentByEmail as realFindByEmail,
  findAgentById as realFindById, findOrderByTracking as realFindByTracking, getOrderDetail as realGetOrderDetail,
  resolveOrder as realResolveOrder,
} from "./spiro";
import { postEscalation as realPostEscalation } from "./escalation";
import type { EscalationInput, OrderCard, SpiroAgent, SpiroCtx } from "./types";

export type ToolSchema = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
};

const str = (description: string) => ({ type: "string", description });

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "book_appointment",
    description: "Capture a request to book an appointment/shoot. The business confirms it afterward; do not promise a confirmed time.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "phone", "service", "preferred_times"],
      properties: {
        name: str("Caller's full name"),
        phone: str("Best callback phone number"),
        email: str("Caller's email, if given"),
        service: str("Which service they want (e.g. listing photos, video, drone)"),
        preferred_times: str("Preferred day(s)/time window for the appointment"),
        location: str("Property address or location, if relevant"),
        notes: str("Any extra details (access, square footage, deadline)"),
      },
    },
  },
  {
    name: "qualify_lead",
    description: "Capture a new sales lead and qualifying details when the caller is a prospect.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "phone", "intent"],
      properties: {
        name: str("Caller's full name"),
        phone: str("Best callback phone number"),
        email: str("Caller's email, if given"),
        intent: str("What the caller is looking for"),
        notes: str("Context about the opportunity"),
        budget: str("Budget, if mentioned"),
        timeline: str("Timeline, if mentioned"),
      },
    },
  },
  {
    name: "take_message",
    description: "Take a message for the business when no booking or transfer is needed.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "phone", "message"],
      properties: {
        name: str("Caller's full name"),
        phone: str("Best callback phone number"),
        message: str("The message to pass along"),
      },
    },
  },
  {
    name: "lookup_faq",
    description: "Look up an answer from the business's knowledge base (hours, pricing, services, policies). Use before guessing.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: { query: str("The caller's question, paraphrased for search") },
    },
  },
  {
    name: "transfer_to_human",
    description: "Warm-transfer the call to a human when the caller asks or the request is out of scope.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["reason"],
      properties: { reason: str("Why the call is being transferred") },
    },
  },
];

export const ORDER_TOOL_SCHEMAS = [
  {
    name: "lookup_order",
    description: "Look up the caller's photography order in Spiro to answer status/schedule/photographer questions. Requires the caller to confirm a property address or order tracking code.",
    input_schema: { type: "object", additionalProperties: false, properties: {
      tracking_code: { type: "string", description: "Order tracking code if the caller has it." },
      property_address: { type: "string", description: "Property address on the order, to verify + locate it." },
      agent_email: { type: "string", description: "Email on the account, used only if the caller's phone doesn't match." },
    }, required: [] },
  },
  {
    name: "request_reschedule",
    description: "Submit a request to reschedule an existing, verified order to a new time. Does not change Spiro directly.",
    input_schema: { type: "object", additionalProperties: false, properties: {
      tracking_code: { type: "string" }, property_address: { type: "string" }, agent_email: { type: "string" },
      desired_window: { type: "string", description: "Caller's requested new date/time or window." },
      reason: { type: "string" },
    }, required: ["desired_window"] },
  },
  {
    name: "request_cancellation",
    description: "Submit a request to cancel an existing, verified order. Does not cancel in Spiro directly.",
    input_schema: { type: "object", additionalProperties: false, properties: {
      tracking_code: { type: "string" }, property_address: { type: "string" }, agent_email: { type: "string" }, reason: { type: "string" },
    }, required: [] },
  },
  {
    name: "request_new_order",
    description: "Capture a full request for a NEW shoot order for staff to create. Does not create in Spiro directly.",
    input_schema: { type: "object", additionalProperties: false, properties: {
      property_address: { type: "string" }, package_or_services: { type: "string" },
      preferred_datetime: { type: "string" }, access_notes: { type: "string" }, agent_email: { type: "string" },
    }, required: ["property_address", "package_or_services", "preferred_datetime"] },
  },
] as const;

// On an order-desk line the generic booking/lead tools are REPLACED by the order tools (spec §4).
const ORDER_LINE_DROP = new Set(["book_appointment", "qualify_lead"]);
export function toolsForLine(line: { order_ops_enabled?: boolean }) {
  if (!line.order_ops_enabled) return [...TOOL_SCHEMAS];
  const base = TOOL_SCHEMAS.filter((t) => !ORDER_LINE_DROP.has(t.name));
  return [...base, ...ORDER_TOOL_SCHEMAS]; // do NOT annotate the return type — let TS infer the union (ORDER_TOOL_SCHEMAS is `as const`)
}

export type ToolCtx = {
  line: {
    id: string;
    client_id: string;
    booking_mode?: string;
    escalation_number?: string | null;
    agent_name?: string | null;
    booking_email?: string | null;
    order_ops_enabled?: boolean;
    spiro_source_id?: string | null;
    slack_channel_id?: string | null;
  };
  callId: string;
  callerNumber?: string | null;
  record: (entry: { tool: string; fields: Record<string, unknown> }) => Promise<void>;
};

async function lookupFaq(clientId: string, query: string): Promise<string | null> {
  if (!query.trim()) return null;
  const { supabaseAdmin } = await import("@/lib/supabase");
  // Keyword match v1 (embeddings later). Take the first reasonable hit.
  const { data } = await supabaseAdmin
    .from("hollis_kb")
    .select("question, answer")
    .eq("client_id", clientId)
    .ilike("question", `%${query.slice(0, 60)}%`)
    .limit(1);
  const row = (data as { answer: string }[] | null)?.[0];
  return row?.answer ?? null;
}

export async function dispatch(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  switch (name) {
    case "take_message":
      await ctx.record({ tool: "take_message", fields: args });
      return "Got it — I'll pass that along to the team.";

    case "book_appointment":
      await ctx.record({ tool: "book_appointment", fields: args });
      return "Perfect — the team will confirm and reach out to lock that in.";

    case "qualify_lead":
      await ctx.record({ tool: "qualify_lead", fields: args });
      return "Thanks — I've got your details and someone will follow up shortly.";

    case "lookup_faq": {
      const answer = await lookupFaq(ctx.line.client_id, String(args.query ?? ""));
      return answer
        ? toSpokenForm(answer)
        : "I'm not totally sure on that one — let me take a message and have the team get back to you.";
    }

    case "transfer_to_human":
      await ctx.record({ tool: "transfer_to_human", fields: args });
      return "Sure — let me connect you with someone who can help. One moment.";

    case "lookup_order":
    case "request_reschedule":
    case "request_cancellation":
    case "request_new_order": {
      if (!ctx.line.order_ops_enabled) return "Let me take a message and have the team follow up with you.";
      if (name === "lookup_order") return handleLookupOrder(args as any, ctx);
      if (name === "request_reschedule") return handleRescheduleRequest(args as any, ctx);
      if (name === "request_cancellation") return handleCancellationRequest(args as any, ctx);
      return handleNewOrderRequest(args as any, ctx);
    }

    default:
      return "I'm sorry, I didn't quite catch that — let me take a message so the team can help.";
  }
}

// --- Order desk: lookup_order ------------------------------------------------
// Reads live order data from Spiro. Tracking-code lookups resolve globally
// (no phone match required); everything else resolves the caller's agent
// record first (phone, then email fallback) and matches their order by address.

export type OrderToolDeps = {
  loadSpiroCtx: typeof realLoadSpiroCtx;
  findAgentByPhone: typeof realFindByPhone;
  findAgentByEmail: typeof realFindByEmail;
  findAgentById: typeof realFindById;
  findOrderByTracking: typeof realFindByTracking;
  getOrderDetail: typeof realGetOrderDetail;
  resolveOrder: typeof realResolveOrder;
  postEscalation: typeof realPostEscalation;
};
const REAL_DEPS: OrderToolDeps = {
  loadSpiroCtx: realLoadSpiroCtx, findAgentByPhone: realFindByPhone, findAgentByEmail: realFindByEmail,
  findAgentById: realFindById, findOrderByTracking: realFindByTracking, getOrderDetail: realGetOrderDetail,
  resolveOrder: realResolveOrder, postEscalation: realPostEscalation,
};

const CANT_HELP = "I'm having trouble reaching our order system right now — let me take a message and have the team follow up with you.";
const ASK_VERIFY = "To pull up your order I just need to confirm the property address or the order tracking code — which do you have handy?";

async function logSpiro(ctx: ToolCtx, res: { kind: string; message: string }): Promise<void> {
  try {
    // Deferred import (like the supabase-backed helpers above) so a missing/unset
    // Supabase env in non-Next.js contexts can't crash module load or the caller flow.
    const { logEvent } = await import("@/lib/logger");
    await logEvent({ clientId: ctx.line.client_id, category: "hollis", level: "error", message: `spiro ${res.kind}: ${res.message}` });
  } catch {
    // Never let logging failures break the caller-facing flow.
  }
}

type ResolveResult = { error?: string; agent?: SpiroAgent | null; order?: OrderCard | null; candidates?: OrderCard[]; spiro?: SpiroCtx };

async function resolveAgentAndOrder(
  args: { tracking_code?: string; property_address?: string; agent_email?: string },
  ctx: ToolCtx, d: OrderToolDeps,
): Promise<ResolveResult> {
  const spiro = await d.loadSpiroCtx(ctx.line.client_id, ctx.line.spiro_source_id ?? null);
  if (!spiro) return { error: CANT_HELP };

  // Tracking-code first — resolves globally, even when the caller's phone doesn't match an agent (spec §3.2).
  if (args.tracking_code) {
    const byTrack = await d.findOrderByTracking(spiro, args.tracking_code);
    if (!byTrack.ok) { await logSpiro(ctx, byTrack); return { error: CANT_HELP, spiro }; }
    if (byTrack.value.order) {
      let agent: SpiroAgent | null = null;
      if (byTrack.value.agentId) { const ar = await d.findAgentById(spiro, byTrack.value.agentId); if (ar.ok) agent = ar.value; }
      return { agent, order: byTrack.value.order, spiro };
    }
  }

  // Otherwise resolve the agent (phone → email), then match their order by address.
  const e164 = normalizeCallerNumber(ctx.callerNumber);
  let agent: SpiroAgent | null = null;
  if (e164) { const r = await d.findAgentByPhone(spiro, e164); if (!r.ok) { await logSpiro(ctx, r); return { error: CANT_HELP, spiro }; } agent = r.value; }
  if (!agent && args.agent_email) { const r = await d.findAgentByEmail(spiro, args.agent_email); if (!r.ok) { await logSpiro(ctx, r); return { error: CANT_HELP, spiro }; } agent = r.value; }
  if (!agent) return { error: "I couldn't find your account from this number — can you give me the email on the order, or the tracking code?", spiro };

  const resolved = await d.resolveOrder(spiro, { agentId: agent.agentId, addressText: args.property_address });
  if (!resolved.ok) { await logSpiro(ctx, resolved); return { error: CANT_HELP, spiro }; }
  return { agent, order: resolved.value.match, candidates: resolved.value.candidates, spiro };
}

function speakOrder(o: OrderCard): string {
  const when = o.arrivalWindowStart ? ` scheduled for ${o.arrivalWindowStart}` : "";
  const who = o.photographerName ? ` with ${o.photographerName}` : "";
  return `Your order for ${o.addressText} is ${o.status}${when}${who}.`;
}

export async function handleLookupOrder(
  args: { tracking_code?: string; property_address?: string; agent_email?: string },
  ctx: ToolCtx, overrides: Partial<OrderToolDeps> = {},
): Promise<string> {
  const d = { ...REAL_DEPS, ...overrides };
  const { error, order, candidates } = await resolveAgentAndOrder(args, ctx, d);
  if (error) return error;
  if (!order) {
    if (candidates && candidates.length > 1) {
      const list = candidates.slice(0, 3).map((c) => c.addressText).filter(Boolean).join("; ");
      return `I see a few orders on your account${list ? ` — ${list}` : ""}. Which property is it, or what's the tracking code?`;
    }
    return ASK_VERIFY;
  }
  await ctx.record({ tool: "lookup_order", fields: { trackingCode: order.trackingCode, status: order.status } });
  return speakOrder(order);
}

// --- Order desk: reschedule / cancel / new order -----------------------------
// These escalate to staff (Slack, falling back to email) rather than acting
// directly against Spiro. The escalation row is always persisted first
// (Task 9), so `deliver` softens its promise — never over-promises — when the
// live delivery channel falls back.

const SENT_MSG = "Perfect — I've sent that to our team and they'll confirm by email shortly. Anything else?";
const SENT_LOGGED = "I've logged that for our team and they'll follow up with you. Anything else?";
const NEED_VERIFY = "Before I can put that request in, I need to confirm the property address or the order tracking code — which do you have?";

function agentContact(agent?: SpiroAgent | null): Record<string, unknown> {
  if (!agent) return {};
  const name = `${agent.firstName ?? ""} ${agent.lastName ?? ""}`.trim();
  return { caller_name: name, caller_email: agent.email ?? "" };
}

function baseEscalation(ctx: ToolCtx, agentId: string | null, order: OrderCard | null, type: EscalationInput["type"], fields: Record<string, unknown>, staffContext?: Record<string, unknown>): EscalationInput {
  return {
    type, clientId: ctx.line.client_id, lineId: ctx.line.id,
    slackChannel: ctx.line.slack_channel_id ?? null, staffEmail: ctx.line.booking_email ?? null,
    callId: null, retellCallId: ctx.callId || null, callerNumber: ctx.callerNumber ?? null,
    agentId, order, verified: !!order, fields, staffContext,
  };
}

async function deliver(d: OrderToolDeps, input: EscalationInput): Promise<string> {
  const res = await d.postEscalation(input);
  return res.ok ? SENT_MSG : SENT_LOGGED;
}

export async function handleRescheduleRequest(
  args: { tracking_code?: string; property_address?: string; agent_email?: string; desired_window: string; reason?: string },
  ctx: ToolCtx, overrides: Partial<OrderToolDeps> = {},
): Promise<string> {
  const d = { ...REAL_DEPS, ...overrides };
  const { error, agent, order, spiro } = await resolveAgentAndOrder(args, ctx, d);
  if (error) return error;
  if (!order) return NEED_VERIFY;
  let staffContext: Record<string, unknown> | undefined;
  if (spiro) { const det = await d.getOrderDetail(spiro, order.orderId); if (det.ok) staffContext = { rescheduleAmount: det.value.rescheduleAmount }; }
  await ctx.record({ tool: "request_reschedule", fields: { trackingCode: order.trackingCode, desired_window: args.desired_window } });
  return deliver(d, baseEscalation(ctx, agent?.agentId ?? null, order, "reschedule",
    { desired_window: args.desired_window, reason: args.reason ?? "", ...agentContact(agent) }, staffContext));
}

export async function handleCancellationRequest(
  args: { tracking_code?: string; property_address?: string; agent_email?: string; reason?: string },
  ctx: ToolCtx, overrides: Partial<OrderToolDeps> = {},
): Promise<string> {
  const d = { ...REAL_DEPS, ...overrides };
  const { error, agent, order, spiro } = await resolveAgentAndOrder(args, ctx, d);
  if (error) return error;
  if (!order) return NEED_VERIFY;
  let staffContext: Record<string, unknown> | undefined;
  if (spiro) { const det = await d.getOrderDetail(spiro, order.orderId); if (det.ok) staffContext = { cancellationAmount: det.value.cancellationAmount }; }
  await ctx.record({ tool: "request_cancellation", fields: { trackingCode: order.trackingCode } });
  return deliver(d, baseEscalation(ctx, agent?.agentId ?? null, order, "cancel",
    { reason: args.reason ?? "", ...agentContact(agent) }, staffContext));
}

export async function handleNewOrderRequest(
  args: { property_address: string; package_or_services: string; preferred_datetime: string; access_notes?: string; agent_email?: string },
  ctx: ToolCtx, overrides: Partial<OrderToolDeps> = {},
): Promise<string> {
  const d = { ...REAL_DEPS, ...overrides };
  const spiro = await d.loadSpiroCtx(ctx.line.client_id, ctx.line.spiro_source_id ?? null);
  let agent: SpiroAgent | null = null;
  if (spiro) {
    const e164 = normalizeCallerNumber(ctx.callerNumber);
    if (e164) { const r = await d.findAgentByPhone(spiro, e164); if (r.ok) agent = r.value; }
    if (!agent && args.agent_email) { const r = await d.findAgentByEmail(spiro, args.agent_email); if (r.ok) agent = r.value; }
  }
  await ctx.record({ tool: "request_new_order", fields: { property_address: args.property_address } });
  return deliver(d, baseEscalation(ctx, agent?.agentId ?? null, null, "new_order", {
    property_address: args.property_address, package_or_services: args.package_or_services,
    preferred_datetime: args.preferred_datetime, access_notes: args.access_notes ?? "",
    contact_number: ctx.callerNumber ?? "", contact_email: args.agent_email ?? "", ...agentContact(agent),
  }));
}
