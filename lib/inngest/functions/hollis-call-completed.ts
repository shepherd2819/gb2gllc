// lib/inngest/functions/hollis-call-completed.ts
//
// Post-call processing for Hollis. Triggered by app/api/hollis/webhook on
// Retell's call_analyzed event. Concurrency limited per line so re-delivery of
// the same call is serialized. Idempotent on retell_call_id (the hollis_calls
// unique key); finalizeCall upserts.

import { inngest } from "@/lib/inngest/client";
import { logEvent } from "@/lib/logger";
import { loadLineByNumber } from "@/lib/hollis/config";
import { finalizeCall, buildDeliveryRecord } from "@/lib/hollis/calls";
import { deliverToBusiness } from "@/lib/hollis/delivery";
import type { ParsedLifecycle } from "@/lib/hollis/webhook";

export const hollisCallCompleted = inngest.createFunction(
  {
    id: "hollis-call-completed",
    name: "Hollis: post-call processing",
    concurrency: [{ key: "event.data.parsed.toNumber", limit: 3 }],
    triggers: [{ event: "hollis/call.completed" }],
  },
  async ({ event, step }) => {
    const parsed = (event.data as { parsed: ParsedLifecycle }).parsed;
    if (!parsed.toNumber || !parsed.retellCallId) return { skipped: "missing identifiers" };

    const ctx = await step.run("load-line", async () => {
      const { supabaseAdmin } = await import("@/lib/supabase");
      const line = await loadLineByNumber(parsed.toNumber!);
      if (!line) return null;
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("company, name, email")
        .eq("id", line.client_id)
        .maybeSingle<{ company: string | null; name: string | null; email: string | null }>();
      return {
        line,
        businessName: client?.company || client?.name || "our office",
        fallbackEmail: client?.email ?? null,
      };
    });
    if (!ctx) return { skipped: "no line for number" };

    const { outcome, captured } = await step.run("finalize", () => finalizeCall(parsed, ctx.line));

    if (outcome === "booking_request" || outcome === "message" || outcome === "transfer") {
      await step.run("open-ticket", async () => {
        const { supabaseAdmin } = await import("@/lib/supabase");
        const subject = `Hollis call — ${outcome.replace(/_/g, " ")}`;
        const body = JSON.stringify(captured, null, 2);
        const { data: ticket } = await supabaseAdmin
          .from("tickets")
          .insert({ client_id: ctx.line.client_id, subject, body, status: "open", category: "hollis" })
          .select("id")
          .single<{ id: string }>();
        if (ticket?.id) {
          await supabaseAdmin.from("hollis_calls").update({ ticket_id: ticket.id }).eq("retell_call_id", parsed.retellCallId);
        }
      });
    }

    await step.run("deliver", async () => {
      const rec = buildDeliveryRecord(captured, outcome, ctx.businessName, parsed.retellCallId as string, parsed.fromNumber);
      if (rec) await deliverToBusiness(ctx.line, rec, ctx.fallbackEmail);
    });

    await step.run("log", () =>
      logEvent({
        clientId: ctx.line.client_id,
        category: "hollis",
        message: `inbound call — ${outcome}`,
        metadata: { retell_call_id: parsed.retellCallId, outcome, duration_ms: parsed.durationMs },
      }),
    );

    return { outcome };
  },
);
