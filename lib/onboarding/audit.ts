// Append-only onboarding audit. Writes onboarding_events (and, in Phase B, a
// WorkOS Audit Log entry — see workosAudit stub). Never throws: an audit failure
// must not break the provisioning pipeline.

import { emitWorkosAudit, scalarsOnly } from "./workos";

export async function emitEvent(opts: {
  journeyId?: string | null;
  clientId?: string | null;
  kind: string;
  actor?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/lib/supabase");
    await supabaseAdmin.from("onboarding_events").insert({
      journey_id: opts.journeyId ?? null,
      client_id: opts.clientId ?? null,
      kind: opts.kind,
      actor: opts.actor ?? "system",
      payload: opts.payload ?? {},
    });

    // Mirror to WorkOS Audit Logs (org-scoped, SIEM-streamable) when the client
    // has an org. Best-effort: emitWorkosAudit never throws, and the `kind` must
    // be a registered audit-log schema action in the WorkOS dashboard (else 422,
    // which it logs and swallows).
    if (opts.clientId) {
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("workos_org_id")
        .eq("id", opts.clientId)
        .maybeSingle<{ workos_org_id: string | null }>();
      if (client?.workos_org_id) {
        await emitWorkosAudit(client.workos_org_id, opts.kind, {
          actorId: opts.actor,
          clientId: opts.clientId,
          metadata: scalarsOnly(opts.payload),
        });
      }
    }
  } catch (err) {
    console.error("[onboarding/audit] emitEvent failed:", err instanceof Error ? err.message : err);
  }
}
