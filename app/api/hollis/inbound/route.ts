import { NextResponse } from "next/server";
import { loadLineConfig } from "@/lib/hollis/config";
import { resolveVoice } from "@/lib/hollis/voices";

export const dynamic = "force-dynamic";

// Retell inbound-call webhook. Resolves the dialed number to a client line and
// returns per-call overrides (agent, voice, greeting, dynamic variables). To
// REJECT a call, return 200 WITHOUT call_inbound.override_agent_id. Must answer
// within 10s. Confirmed shape: docs.retellai.com/features/inbound-call-webhook.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    call_inbound?: { to_number?: string; from_number?: string };
  };
  const toNumber = body.call_inbound?.to_number;
  const fromNumber = body.call_inbound?.from_number;
  if (!toNumber) return NextResponse.json({});

  const cfg = await loadLineConfig(toNumber);
  if (!cfg || cfg.line.status !== "active") return NextResponse.json({});

  const overrideAgentId = cfg.line.retell_agent_id ?? process.env.HOLLIS_RETELL_AGENT_ID;
  if (!overrideAgentId) return NextResponse.json({}); // no agent → reject rather than dead air

  const voiceId = cfg.line.voice_id ?? resolveVoice(cfg.line.voice_profile).voiceId;

  return NextResponse.json({
    call_inbound: {
      override_agent_id: overrideAgentId,
      agent_override: {
        agent: { voice_id: voiceId },
        retell_llm: { begin_message: cfg.dynamicVariables.greeting },
      },
      dynamic_variables: cfg.dynamicVariables,
      metadata: { line_id: cfg.line.id, client_id: cfg.line.client_id, caller_number: fromNumber ?? "" },
    },
  });
}
