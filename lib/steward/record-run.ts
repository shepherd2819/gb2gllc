import { createHmac } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

function hmac(payload: string): string {
  const key = process.env.AUDIT_HMAC_KEY ?? "dev-no-key";
  return createHmac("sha256", key).update(payload).digest("hex");
}

export async function recordEvent(params: {
  clientId: string;
  runId: string;
  type: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await supabaseAdmin.from("steward_events").insert({
    client_id: params.clientId,
    run_id: params.runId,
    type: params.type,
    payload: params.payload,
  });
}

export async function recordAudit(params: {
  clientId: string;
  runId: string;
  assignmentId: string;
  toolName: string;
  inputSummary: string;
  outcome: "allowed" | "blocked" | "completed" | "failed";
  reason?: string;
}): Promise<void> {
  const { data: last } = await supabaseAdmin
    .from("steward_audit_log")
    .select("id")
    .eq("client_id", params.clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevId = last?.id ?? null;
  const ts = new Date().toISOString();
  const payload = JSON.stringify({ ...params, prevId, ts });

  await supabaseAdmin.from("steward_audit_log").insert({
    client_id: params.clientId,
    run_id: params.runId,
    assignment_id: params.assignmentId,
    tool_name: params.toolName,
    input_summary: params.inputSummary,
    outcome: params.outcome,
    reason: params.reason ?? null,
    hmac: hmac(payload),
    prev_entry_id: prevId,
  });
}
