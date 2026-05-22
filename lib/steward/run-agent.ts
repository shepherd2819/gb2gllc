import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";
import { getAgent } from "./agents/registry";
import { checkScope } from "./constitution";
import { loadMemory, loadPlaybooks } from "./memory";
import { recordAudit, recordEvent } from "./record-run";
import { reflect } from "./reflection";
import type { RunResult, ToolCallRecord, ToolContext } from "./types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_TOOL_LOOPS = 12;
const MODEL = "claude-sonnet-4-6";

export async function runStewardAgent(params: {
  assignmentId: string;
  trigger?: "manual" | "scheduled" | "webhook";
  inputText?: string;
}): Promise<RunResult> {
  const { assignmentId, trigger = "manual", inputText } = params;

  // ── 1. Load assignment ──────────────────────────────────────────
  const { data: assignment } = await supabaseAdmin
    .from("client_steward_assignments")
    .select("*, steward_platform_agents(id, display_name)")
    .eq("id", assignmentId)
    .single();

  if (!assignment) throw new Error("Assignment not found");
  if (!assignment.active) throw new Error("Assignment is paused");

  // ── 2. Load client ──────────────────────────────────────────────
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name, company, email")
    .eq("id", assignment.client_id)
    .single();

  // ── 3. Load platform token ──────────────────────────────────────
  const { data: tokenRow } = await supabaseAdmin
    .from("steward_platform_tokens")
    .select("token_data")
    .eq("client_id", assignment.client_id)
    .eq("platform", assignment.platform_agent_id)
    .maybeSingle();

  if (!tokenRow) {
    throw new Error(
      `No credentials found for ${assignment.steward_platform_agents.display_name}. Connect the platform first in the admin panel.`
    );
  }

  // ── 4. Get agent definition ─────────────────────────────────────
  const agentDef = getAgent(assignment.platform_agent_id);
  if (!agentDef) throw new Error(`No agent built for platform: ${assignment.platform_agent_id}`);

  // ── 5. Create run record ────────────────────────────────────────
  const { data: run } = await supabaseAdmin
    .from("steward_runs")
    .insert({
      client_id: assignment.client_id,
      assignment_id: assignmentId,
      trigger,
      status: "running",
      input: { text: inputText ?? null },
    })
    .select("id")
    .single();

  const runId = run!.id;

  await recordEvent({ clientId: assignment.client_id, runId, type: "run_started", payload: { trigger, assignmentId } });

  try {
    // ── 6. Load memory & playbooks ────────────────────────────────
    const [memoryContext, playbookContext] = await Promise.all([
      loadMemory(assignment.client_id),
      loadPlaybooks(assignment.client_id, assignment.platform_agent_id),
    ]);

    // ── 7. Build system prompt ────────────────────────────────────
    const systemPrompt = agentDef.buildSystemPrompt({
      mission: assignment.mission,
      company: client?.company || client?.name || "the client",
      datetime: new Date().toLocaleString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
      }),
      memoryContext,
      playbookContext,
    });

    // ── 8. Tool context ───────────────────────────────────────────
    const toolCtx: ToolContext = {
      token: tokenRow.token_data as Record<string, string>,
      clientId: assignment.client_id,
      runId,
    };

    const actionScope = (assignment.action_scope ?? []) as string[];

    // ── 9. Initial message ────────────────────────────────────────
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: inputText || `Execute your mission: ${assignment.mission}` },
    ];

    const toolCallRecords: ToolCallRecord[] = [];
    let finalText = "";
    let totalTokens = 0;

    // ── 10. Tool loop ─────────────────────────────────────────────
    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: agentDef.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
        messages,
      });

      totalTokens += response.usage.input_tokens + response.usage.output_tokens;

      const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
      if (textBlocks.length > 0) finalText = textBlocks.map(b => b.text).join("\n");

      if (response.stop_reason === "end_turn") break;
      if (response.stop_reason !== "tool_use") break;

      messages.push({ role: "assistant", content: response.content });

      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      // Execute tool calls in parallel (they're independent API calls)
      await Promise.all(
        toolUseBlocks.map(async (toolUse) => {
          const allowed = checkScope(toolUse.name, actionScope);

          let resultText: string;

          if (!allowed) {
            resultText = `BLOCKED: '${toolUse.name}' is outside the authorized scope for this assignment. Only perform actions related to: ${assignment.mission.slice(0, 100)}`;
            await recordAudit({
              clientId: assignment.client_id, runId, assignmentId,
              toolName: toolUse.name,
              inputSummary: JSON.stringify(toolUse.input).slice(0, 200),
              outcome: "blocked", reason: "out_of_scope",
            });
          } else {
            const tool = agentDef.tools.find(t => t.name === toolUse.name);
            if (!tool) {
              resultText = `ERROR: Unknown tool '${toolUse.name}'`;
            } else {
              try {
                resultText = await tool.execute(toolUse.input as Record<string, unknown>, toolCtx);
                toolCallRecords.push({ toolName: toolUse.name, input: toolUse.input, output: resultText });
                await Promise.all([
                  recordAudit({
                    clientId: assignment.client_id, runId, assignmentId,
                    toolName: toolUse.name,
                    inputSummary: JSON.stringify(toolUse.input).slice(0, 200),
                    outcome: "completed",
                  }),
                  recordEvent({
                    clientId: assignment.client_id, runId, type: "tool_call",
                    payload: { tool: toolUse.name, input: toolUse.input, output: resultText.slice(0, 400) },
                  }),
                ]);
              } catch (err) {
                resultText = `ERROR: ${(err as Error).message}`;
                await recordAudit({
                  clientId: assignment.client_id, runId, assignmentId,
                  toolName: toolUse.name,
                  inputSummary: JSON.stringify(toolUse.input).slice(0, 200),
                  outcome: "failed", reason: (err as Error).message,
                });
              }
            }
          }

          toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: resultText });
        })
      );

      messages.push({ role: "user", content: toolResults });
    }

    // ── 11. Finalize run ──────────────────────────────────────────
    await Promise.all([
      supabaseAdmin.from("steward_runs").update({
        status: "completed",
        summary: finalText.slice(0, 2000) || null,
        tool_calls: toolCallRecords,
        tokens_used: totalTokens,
        completed_at: new Date().toISOString(),
      }).eq("id", runId),

      supabaseAdmin.from("client_steward_assignments").update({
        last_run_at: new Date().toISOString(),
        last_run_status: "completed",
      }).eq("id", assignmentId),

      recordEvent({ clientId: assignment.client_id, runId, type: "run_completed", payload: { toolCount: toolCallRecords.length, tokens: totalTokens } }),
    ]);

    // ── 12. Reflect async (non-blocking) ──────────────────────────
    reflect({
      runId, clientId: assignment.client_id,
      platformAgentId: assignment.platform_agent_id,
      toolCalls: toolCallRecords, summary: finalText,
    }).catch(e => console.error("[steward/reflect]", e));

    return { runId, status: "completed", summary: finalText.slice(0, 500) || null };

  } catch (err) {
    const msg = (err as Error).message;
    await Promise.all([
      supabaseAdmin.from("steward_runs").update({
        status: "failed", error: msg, completed_at: new Date().toISOString(),
      }).eq("id", runId),
      supabaseAdmin.from("client_steward_assignments").update({
        last_run_at: new Date().toISOString(), last_run_status: "failed",
      }).eq("id", assignmentId),
      recordEvent({ clientId: assignment.client_id, runId, type: "run_failed", payload: { error: msg } }),
    ]);
    throw err;
  }
}
