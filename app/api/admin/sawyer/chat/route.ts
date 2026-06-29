// app/api/admin/sawyer/chat/route.ts
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getClientContext, buildProspectContext } from "@/lib/sawyer/context";
import { buildSawyerSystemPrompt } from "@/lib/sawyer/prompt";
import { streamSawyerTurn, validateFinalizePayload } from "@/lib/sawyer/chat";
import { createProposal, updateProposal, getProposal, appendMessage, getMessages } from "@/lib/sawyer/store";
import type { ChatMessage, SawyerContext } from "@/lib/sawyer/types";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  if (!body?.message) {
    return new Response(JSON.stringify({ error: "message required" }), { status: 400 });
  }
  const { proposalId, clientId, prospect, message } = body as {
    proposalId?: string;
    clientId?: string;
    prospect?: { name: string; company?: string; notes?: string };
    message: string;
  };

  // Resolve context: existing proposal's client, an explicit clientId, or a prospect.
  let ctx: SawyerContext | null = null;
  let resolvedClientId: string | null = null;
  let prospectName: string | null = null;
  if (clientId) {
    ctx = await getClientContext(clientId);
    resolvedClientId = clientId;
  }
  if (!ctx && prospect?.name) {
    ctx = buildProspectContext(prospect);
    prospectName = ctx.name;
  }
  if (!ctx && proposalId) {
    const existing = await getProposal(proposalId);
    if (existing?.client_id) {
      ctx = await getClientContext(existing.client_id);
      resolvedClientId = existing.client_id;
    } else if (existing) {
      ctx = buildProspectContext({ name: existing.prospect_name ?? "Prospect" });
      prospectName = existing.prospect_name;
    }
  }
  if (!ctx) {
    return new Response(JSON.stringify({ error: "client or prospect context required" }), { status: 400 });
  }

  const history: ChatMessage[] = proposalId ? await getMessages(proposalId) : [];
  const messages: ChatMessage[] = [...history, { role: "user", content: message }];
  const system = buildSawyerSystemPrompt(ctx);
  const stream = streamSawyerTurn({ system, messages });

  const encoder = new TextEncoder();
  let assistantText = "";

  const readable = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            assistantText += chunk.delta.text;
            send({ token: chunk.delta.text });
          }
        }
        const final = await stream.finalMessage();

        // Persist conversation turns under a proposal (create one on first finalize).
        let activeProposalId = proposalId ?? null;
        const toolUse = final.content.find((b) => b.type === "tool_use" && b.name === "finalize_proposal");
        if (toolUse && toolUse.type === "tool_use") {
          const v = validateFinalizePayload(toolUse.input);
          if (v.ok) {
            if (activeProposalId) {
              const saved = await updateProposal(activeProposalId, { title: v.title, sections: v.sections, pricing: v.pricing });
              send({ proposal: { id: saved.id, public_token: saved.public_token } });
            } else {
              const saved = await createProposal({
                client_id: resolvedClientId,
                prospect_name: prospectName,
                title: v.title,
                sections: v.sections,
                pricing: v.pricing,
                created_by: guard.user.email,
              });
              activeProposalId = saved.id;
              send({ proposal: { id: saved.id, public_token: saved.public_token } });
            }
          } else {
            send({ warning: `Draft not saved: ${v.error}` });
          }
        }
        if (activeProposalId) {
          await appendMessage(activeProposalId, "user", message);
          if (assistantText) await appendMessage(activeProposalId, "assistant", assistantText);
        }
        send("[DONE]");
      } catch (err) {
        console.error("[sawyer] stream error:", err);
        send({ error: "Stream error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
