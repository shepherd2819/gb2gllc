import { NextResponse } from "next/server";
import { getHollisSecrets } from "@/lib/hollis/env";
import { verifyRetellSignature } from "@/lib/hollis/webhook";
import { dispatch, type ToolCtx } from "@/lib/hollis/tools";
import { recordToolUse } from "@/lib/hollis/calls";

export const dynamic = "force-dynamic";

// Retell custom-function (in-call tool) webhook. Synchronous — on the latency
// critical path, so keep it light. Body: { name, args, call }. The line/client
// is carried in call.metadata (set by the inbound webhook); falls back to a
// to_number lookup.
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
    call?: { call_id?: string; to_number?: string; metadata?: { line_id?: string; client_id?: string } };
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const name = payload.name ?? "";
  const args = payload.args ?? {};
  const call = payload.call ?? {};
  const meta = call.metadata ?? {};

  let line: { id: string; client_id: string; escalation_number: string | null } | null = null;
  if (meta.line_id && meta.client_id) {
    line = { id: meta.line_id, client_id: meta.client_id, escalation_number: null };
  } else if (call.to_number) {
    const { supabaseAdmin } = await import("@/lib/supabase");
    const { data } = await supabaseAdmin
      .from("hollis_lines")
      .select("id, client_id, escalation_number")
      .eq("phone_number", call.to_number)
      .maybeSingle<{ id: string; client_id: string; escalation_number: string | null }>();
    line = data ?? null;
  }

  if (!line) {
    return NextResponse.json({ result: "Let me take a message and have the team follow up with you." });
  }

  const ctx: ToolCtx = {
    line: { id: line.id, client_id: line.client_id, escalation_number: line.escalation_number },
    callId: call.call_id ?? "",
    record: async (entry) => {
      if (call.call_id) {
        await recordToolUse({
          lineId: line!.id,
          clientId: line!.client_id,
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
