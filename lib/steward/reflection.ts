import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";
import { writeSemanticFacts } from "./memory";
import type { ToolCallRecord } from "./types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function reflect(params: {
  runId: string;
  clientId: string;
  platformAgentId: string;
  toolCalls: ToolCallRecord[];
  summary: string;
}): Promise<void> {
  const { runId, clientId, platformAgentId, toolCalls, summary } = params;
  if (toolCalls.length === 0) return;

  const toolLog = toolCalls
    .map(t => `Tool: ${t.toolName}\nInput: ${JSON.stringify(t.input).slice(0, 250)}\nResult: ${t.output.slice(0, 250)}`)
    .join("\n---\n");

  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    system: "Extract structured learning from an AI agent run. Output only valid JSON, no markdown.",
    messages: [{
      role: "user",
      content: `Agent summary: ${summary.slice(0, 400)}\n\nTool calls:\n${toolLog}\n\nReturn a JSON object:\n{\n  "task_summary": "one sentence — what was attempted",\n  "approach": "1-2 sentences — how the agent solved it",\n  "outcome": "one sentence — what was achieved or failed",\n  "new_facts": [\n    { "subject": "preference:...", "predicate": "...", "object": "..." }\n  ]\n}\nnew_facts is for durable client-specific facts (preferences, patterns). Empty array if none.`,
    }],
  });

  const text = res.content.find(b => b.type === "text")?.text ?? "";

  try {
    const parsed = JSON.parse(text) as {
      task_summary?: string;
      approach?: string;
      outcome?: string;
      new_facts?: { subject: string; predicate: string; object: string }[];
    };

    await supabaseAdmin.from("steward_playbooks").insert({
      client_id: clientId,
      platform_agent_id: platformAgentId,
      task_summary: parsed.task_summary ?? "Task executed",
      approach: parsed.approach ?? "Standard approach",
      outcome: parsed.outcome ?? summary.slice(0, 200),
      run_id: runId,
    });

    if (Array.isArray(parsed.new_facts) && parsed.new_facts.length > 0) {
      await writeSemanticFacts(clientId, parsed.new_facts, runId);
    }
  } catch {
    console.warn("[steward/reflection] parse failed:", text.slice(0, 150));
  }
}
