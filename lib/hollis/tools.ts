// The 5 Claude tool/function schemas Hollis exposes during a call, plus the
// dispatch() executor. Each tool returns a short, spoken-form-normalized string
// the agent can say. Reads (FAQ) hit Supabase; capture/delivery side-effects are
// recorded on the call context and delivered post-call (never block the turn).

import { toSpokenForm } from "./normalize";

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

export type ToolCtx = {
  line: { id: string; client_id: string; booking_mode?: string; escalation_number?: string | null };
  callId: string;
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

    default:
      return "I'm sorry, I didn't quite catch that — let me take a message so the team can help.";
  }
}
