// Loads a line + its FAQ and assembles the Retell `dynamic_variables` object
// injected per call. The pure assembly is unit-tested; the DB reads use
// supabaseAdmin and are scoped by client_id (no DB-level tenant isolation).

import { composeGreeting } from "./greeting";
import type { HollisLine } from "./types";

export type KbEntry = { question: string; answer: string };

export type DynamicVariables = {
  business_name: string;
  agent_name: string;
  greeting: string;
  hours: string;
  services: string;
  faq: string;
  escalation_number: string;
  booking_mode: string;
};

type ConfigLine = Pick<
  HollisLine,
  "agent_name" | "recording_enabled" | "greeting_override" | "services" | "hours" | "escalation_number" | "booking_mode"
>;

function formatHours(hours: Record<string, unknown>): string {
  return Object.entries(hours ?? {})
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`)
    .join("; ");
}

export function assembleDynamicVariables(line: ConfigLine, businessName: string, kb: KbEntry[]): DynamicVariables {
  return {
    business_name: businessName,
    agent_name: line.agent_name,
    greeting: composeGreeting({
      businessName,
      agentName: line.agent_name,
      recordingEnabled: line.recording_enabled,
      override: line.greeting_override,
    }),
    hours: formatHours(line.hours),
    services: (line.services ?? []).join(", "),
    faq: (kb ?? []).map((e) => `Q: ${e.question}\nA: ${e.answer}`).join("\n\n"),
    escalation_number: line.escalation_number ?? "",
    booking_mode: line.booking_mode,
  };
}

// Column list for the tool route's explicit line fetch (Task 14). loadLineConfig
// below delegates to loadLineByNumber, which already `.select("*")`s, so these
// order-desk columns load automatically there — this helper is not used by it.
export function hollisLineColumns(): string {
  return "id, client_id, phone_number, retell_agent_id, voice_profile, agent_name, voice_id, greeting_override, persona, hours, services, escalation_number, booking_mode, booking_email, recording_enabled, status, order_ops_enabled, spiro_source_id, slack_channel_id";
}

export async function loadLineByNumber(toNumber: string): Promise<HollisLine | null> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin
    .from("hollis_lines")
    .select("*")
    .eq("phone_number", toNumber)
    .maybeSingle<HollisLine>();
  return data ?? null;
}

export async function loadLineConfig(
  toNumber: string,
): Promise<{ line: HollisLine; dynamicVariables: DynamicVariables } | null> {
  const line = await loadLineByNumber(toNumber);
  if (!line) return null;

  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("company, name")
    .eq("id", line.client_id)
    .maybeSingle<{ company: string | null; name: string | null }>();
  const businessName = client?.company || client?.name || "our office";

  const { data: kb } = await supabaseAdmin
    .from("hollis_kb")
    .select("question, answer")
    .eq("client_id", line.client_id);

  return { line, dynamicVariables: assembleDynamicVariables(line, businessName, (kb as KbEntry[]) ?? []) };
}
