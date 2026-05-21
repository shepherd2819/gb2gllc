import { NextRequest } from "next/server";
import { anthropic, HERALD_MODEL, HERALD_MAX_TOKENS, buildIntakeSystemPrompt, buildGoalsInsightPrompt } from "@/lib/anthropic";

// Rate limit: 30 requests / hour per session (in-memory; swap for Redis in prod)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(sessionId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(sessionId);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(sessionId, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 30) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.message || !body?.mode) {
    return new Response(JSON.stringify({ error: "message and mode required" }), { status: 400 });
  }

  const { sessionId, mode, message, context } = body as {
    sessionId: string;
    mode: "intake-assist" | "goals-insight" | "homepage-demo";
    message: string;
    context?: {
      stage?: string;
      contactName?: string;
      company?: string;
      selectedGoals?: string[];
    };
  };

  if (sessionId && !checkRateLimit(sessionId)) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429 });
  }

  let systemPrompt: string;
  let userMessage: string = message;

  if (mode === "goals-insight") {
    systemPrompt = "";
    userMessage = buildGoalsInsightPrompt(message);
  } else {
    systemPrompt = buildIntakeSystemPrompt(
      context?.stage ?? "unknown",
      context?.contactName ?? "",
      context?.company ?? "",
      context?.selectedGoals ?? []
    );
  }

  const stream = await anthropic.messages.stream({
    model: HERALD_MODEL,
    max_tokens: HERALD_MAX_TOKENS,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: [{ role: "user", content: userMessage }],
  });

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            const data = `data: ${JSON.stringify({ token: chunk.delta.text })}\n\n`;
            controller.enqueue(encoder.encode(data));
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        console.error("Herald stream error:", err);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
