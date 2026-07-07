// app/api/portal/analytics/chat/route.ts
import { NextRequest } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getPortalClientId } from "@/lib/portal-auth";
import { buildChatTools, contextFromSnapshot, runChatTurn, DAILY_MESSAGE_CAP } from "@/lib/analytics/chat";
import {
  appendMessage,
  countMessagesToday,
  getOrCreateConversation,
  listActiveSources,
  listMessages,
  readSnapshot,
  recordEvent,
  toSourceCtx,
} from "@/lib/analytics/store";
import type { SourceCtx } from "@/lib/analytics/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { user } = await withAuth();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Tenant isolation: clientId derives from the session, NEVER the body.
  const clientId = await getPortalClientId(user.id);
  if (!clientId) return Response.json({ error: "No client" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { conversationId?: unknown; message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (message.length < 1 || message.length > 2000) {
    return Response.json({ error: "message must be 1-2000 characters" }, { status: 400 });
  }
  const requestedConversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;

  // DB-backed daily cap (in-memory maps reset per instance — not enough here).
  if ((await countMessagesToday(clientId)) >= DAILY_MESSAGE_CAP) {
    return Response.json({ error: "Daily chat limit reached. Try again tomorrow." }, { status: 429 });
  }

  // getOrCreateConversation verifies ownership against clientId — a stolen
  // conversationId from another tenant yields a fresh conversation, not access.
  const { id: conversationId } = await getOrCreateConversation(clientId, user.id, requestedConversationId);
  const history = await listMessages(conversationId, clientId);

  const sources = await listActiveSources(clientId);
  const ctxs: SourceCtx[] = [];
  for (const source of sources) {
    try {
      ctxs.push(toSourceCtx(source));
    } catch {
      // Undecryptable secret: skip this source, keep chat alive (fail-soft).
    }
  }
  const tools = await buildChatTools(clientId, ctxs);
  const snapshot = await readSnapshot(clientId).catch(() => null);
  const context = contextFromSnapshot(snapshot, new Date());

  await appendMessage({ conversationId, clientId, role: "user", content: message });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        send({ conversationId }); // lets a fresh panel adopt the new conversation
        const result = await runChatTurn(
          { clientId, conversationId, userText: message, history, tools },
          (token) => send({ token }),
          undefined, // default shared anthropic client
          context,
        );
        await appendMessage({
          conversationId,
          clientId,
          role: "assistant",
          content: result.content,
          toolCalls: result.toolCalls,
          model: result.model,
          tokensUsed: result.tokensUsed,
        });
        await recordEvent(clientId, "chat.query", user.id, {
          conversationId,
          tools: result.toolCalls.map((t) => ({ name: t.name, ms: t.ms, ok: t.ok })),
          tokensUsed: result.tokensUsed,
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        console.error("[analytics/chat] stream error:", err);
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
