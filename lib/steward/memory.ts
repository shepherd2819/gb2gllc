import { supabaseAdmin } from "@/lib/supabase";

export async function loadMemory(clientId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("steward_semantic_facts")
    .select("subject, predicate, object")
    .eq("client_id", clientId)
    .is("valid_to", null)
    .order("created_at", { ascending: false })
    .limit(25);

  if (!data || data.length === 0) return "No prior context on file.";
  return data.map(f => `- ${f.subject}: ${f.predicate} → ${f.object}`).join("\n");
}

export async function loadPlaybooks(clientId: string, platformAgentId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("steward_playbooks")
    .select("task_summary, approach, outcome")
    .eq("client_id", clientId)
    .eq("platform_agent_id", platformAgentId)
    .gte("feedback", 0)
    .order("created_at", { ascending: false })
    .limit(3);

  if (!data || data.length === 0) return "No prior playbooks — this is the first run.";
  return data.map((p, i) =>
    `[Example ${i + 1}]\nTask: ${p.task_summary}\nApproach: ${p.approach}\nOutcome: ${p.outcome}`
  ).join("\n\n");
}

export async function writeSemanticFacts(
  clientId: string,
  facts: { subject: string; predicate: string; object: string }[],
  sourceRunId: string
): Promise<void> {
  if (facts.length === 0) return;
  await supabaseAdmin.from("steward_semantic_facts").insert(
    facts.map(f => ({ client_id: clientId, source_run_id: sourceRunId, ...f }))
  );
}
