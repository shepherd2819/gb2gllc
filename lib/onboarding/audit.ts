// Append-only onboarding audit. Writes onboarding_events (and, in Phase B, a
// WorkOS Audit Log entry — see workosAudit stub). Never throws: an audit failure
// must not break the provisioning pipeline.

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
  } catch (err) {
    console.error("[onboarding/audit] emitEvent failed:", err instanceof Error ? err.message : err);
  }
  // Phase B: mirror to WorkOS Audit Logs here (organization-scoped, SIEM-streamable).
}
