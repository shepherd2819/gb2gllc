import { NextResponse } from "next/server";
import { getHollisSecrets } from "@/lib/hollis/env";
import { verifyRetellSignature } from "@/lib/hollis/webhook";
import { dispatch, type ToolCtx } from "@/lib/hollis/tools";
import { recordToolUse } from "@/lib/hollis/calls";
import { hollisLineColumns } from "@/lib/hollis/config";
import type { HollisLine } from "@/lib/hollis/types";

export const dynamic = "force-dynamic";

// Retell custom-function (in-call tool) webhook. Synchronous — on the latency
// critical path, so keep it light. Body: { name, args, call }. The line id is
// carried in call.metadata (set by the inbound webhook); falls back to a
// to_number lookup. Always loads the FULL hollis_lines row (not just the id)
// so order-desk fields (order_ops_enabled, spiro_source_id, slack_channel_id)
// are populated for the dispatch gate — never synthesize a partial line.
// ⚠️ CONFIRM the exact response field Retell expects from a custom function
// (we return { result } — verify at smoke test against docs.retellai.com).
export async function POST(req: Request) {
  const raw = await req.text();
  const secrets = getHollisSecrets();
  if (!secrets.ok || !verifyRetellSignature(raw, req.headers.get("x-retell-signature"), secrets.retellApiKey)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let payload: {
    name?: string;
    args?: Record<string, unknown>;
    call?: {
      call_id?: string;
      to_number?: string;
      from_number?: string;
      metadata?: { line_id?: string; client_id?: string; caller_number?: string };
    };
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const name = payload.name ?? "";
  const args = payload.args ?? {};
  const call = payload.call ?? {};

  const { supabaseAdmin } = await import("@/lib/supabase");
  let lineId = call.metadata?.line_id ?? null;
  if (!lineId && call.to_number) {
    const { data: byNum } = await supabaseAdmin
      .from("hollis_lines")
      .select("id")
      .eq("phone_number", call.to_number)
      .maybeSingle();
    lineId = (byNum?.id as string | undefined) ?? null;
  }
  const { data: line } = lineId
    ? await supabaseAdmin.from("hollis_lines").select(hollisLineColumns()).eq("id", lineId).maybeSingle<HollisLine>()
    : { data: null };

  if (!line) {
    return NextResponse.json({ result: "Let me take a message and have the team follow up with you." });
  }

  const ctx: ToolCtx = {
    line: {
      id: line.id,
      client_id: line.client_id,
      booking_mode: line.booking_mode,
      booking_email: line.booking_email,
      escalation_number: line.escalation_number,
      agent_name: line.agent_name,
      order_ops_enabled: line.order_ops_enabled ?? false,
      spiro_source_id: line.spiro_source_id ?? null,
      slack_channel_id: line.slack_channel_id ?? null,
    },
    callId: call.call_id ?? "",
    callerNumber: call.metadata?.caller_number ?? call.from_number ?? null,
    record: async (entry) => {
      if (call.call_id) {
        await recordToolUse({
          lineId: line.id,
          clientId: line.client_id,
          retellCallId: call.call_id,
          tool: entry.tool,
          fields: entry.fields,
        });
      }
    },
  };

  const result = await dispatch(name, args, ctx);
  return NextResponse.json({ result });
}
