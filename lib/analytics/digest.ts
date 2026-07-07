// Weekly analytics digest email. The pure pieces (digestEligibility,
// escapeHtml, renderDigestHtml) import no runtime dependencies so they are
// unit-testable without env vars; the send path lazy-imports supabase /
// resend / store / logger (hollis-function pattern). Every interpolated
// string in the HTML goes through escapeHtml — herald lesson.

import type { SnapshotPayload } from "./snapshot";
import type { InsightCard } from "./insights";

export type DigestOutcome = { status: "sent" | "skipped" | "failed"; reason?: string };

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A null status counts as active — herald-digest precedent.
export function digestEligibility(
  client: { status: string | null; analytics_digest_enabled: boolean },
  activeSourceCount: number,
): { eligible: true } | { eligible: false; reason: string } {
  if (client.status && client.status !== "active") {
    return { eligible: false, reason: "client not active" };
  }
  if (!client.analytics_digest_enabled) {
    return { eligible: false, reason: "digest disabled for client" };
  }
  if (activeSourceCount < 1) {
    return { eligible: false, reason: "no active data sources" };
  }
  return { eligible: true };
}

function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtMoM(r: number | null): string {
  if (r === null) return "";
  return `${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}% MoM`;
}

// Email HTML uses the brand's inline hex palette exactly as
// lib/email-templates/herald-digest.ts does — mail clients have no
// stylesheet context, so the app's semantic-CSS-variable rule cannot apply
// to email bodies.
export function renderDigestHtml(opts: {
  companyName: string;
  payload: SnapshotPayload;
  insights: InsightCard[];
  portalUrl: string;
}): string {
  const { companyName, payload, insights, portalUrl } = opts;
  const k = payload.kpis;
  const asOf = new Date(payload.generatedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const kpiRow = (label: string, value: string, delta: string) => `
            <tr>
              <td style="padding:8px 0;font-size:13px;color:#6B6E66;">${escapeHtml(label)}</td>
              <td style="padding:8px 0;font-size:14px;color:#1C1E1B;text-align:right;font-family:'JetBrains Mono',monospace;"><span>${escapeHtml(value)}</span>${
                delta
                  ? ` <span style="font-size:11px;color:#8A8C85;">${escapeHtml(delta)}</span>`
                  : ""
              }</td>
            </tr>`;

  const insightsSection = insights.length
    ? `
          <tr>
            <td style="padding:8px 32px 8px;">
              <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8A8C85;margin-bottom:8px;">What moved</div>${insights
                .map(
                  (card) => `
              <div style="border:1px solid rgba(28,30,27,0.06);border-radius:12px;padding:12px 16px;margin-bottom:8px;">
                <div style="font-size:13px;font-weight:600;color:#1C1E1B;">${escapeHtml(card.title)}</div>
                <div style="font-size:13px;color:#6B6E66;line-height:1.5;margin-top:2px;">${escapeHtml(card.body)}</div>
              </div>`,
                )
                .join("")}
              <div style="font-size:11px;color:#8A8C85;">AI-generated · ${escapeHtml(asOf)}</div>
            </td>
          </tr>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Analytics digest</title>
</head>
<body style="margin:0;padding:0;background:#FAF6EC;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#1C1E1B;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6EC;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid rgba(28,30,27,0.06);">

          <tr>
            <td style="padding:32px 32px 8px;">
              <div style="font-size:22px;font-weight:500;letter-spacing:-0.04em;color:#1C1E1B;">
                gb<em style="font-family:'EB Garamond',Georgia,serif;font-style:italic;color:#C9A961;">2</em>g
              </div>
              <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8A8C85;margin-top:4px;">
                Analytics · Weekly Digest
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 32px 8px;">
              <h1 style="font-family:'EB Garamond',Georgia,serif;font-size:28px;font-weight:400;line-height:1.2;color:#1C1E1B;margin:0 0 8px;">
                Your numbers, ${escapeHtml(companyName)}.
              </h1>
              <p style="font-size:14px;color:#6B6E66;margin:0;line-height:1.5;">
                Here is where the business stands this month.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 32px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${kpiRow(
                "Revenue this month",
                fmtMoney(k.revenueThisMonth),
                fmtMoM(k.revenueMoM),
              )}${kpiRow("Orders this month", String(k.ordersThisMonth), fmtMoM(k.ordersMoM))}${kpiRow(
                "Average order value",
                fmtMoney(k.avgOrderValue),
                "",
              )}${kpiRow("Active customers", String(k.activeCustomers), "")}
              </table>
            </td>
          </tr>
${insightsSection}
          <tr>
            <td style="padding:16px 32px 8px;">
              <a href="${escapeHtml(portalUrl)}/analytics" style="display:inline-block;background:#1C1E1B;color:#FFFFFF;font-size:13px;padding:10px 20px;border-radius:8px;text-decoration:none;">Open your dashboard</a>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 32px 32px;">
              <div style="font-size:11px;color:#8A8C85;">Data as of ${escapeHtml(asOf)}.</div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Top-level try/catch guarantees the "never throw" contract even though
// store.ts helpers (listActiveSources, readSnapshot) throw on DB error —
// callers (the Inngest step and sendAnalyticsDigestForAllActiveClients)
// must always get a DigestOutcome back, never an exception.
export async function sendAnalyticsDigestForClient(clientId: string): Promise<DigestOutcome> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { listActiveSources, readSnapshot, recordEvent } = await import("@/lib/analytics/store");
  const { logEvent } = await import("@/lib/logger");

  try {
    const { data: client, error: lookupErr } = await supabaseAdmin
      .from("clients")
      .select("id, email, name, company, status, analytics_digest_enabled")
      .eq("id", clientId)
      .single<{
        id: string;
        email: string | null;
        name: string | null;
        company: string | null;
        status: string | null;
        analytics_digest_enabled: boolean;
      }>();
    if (lookupErr || !client) {
      return { status: "failed", reason: lookupErr?.message ?? "client not found" };
    }

    const sources = await listActiveSources(clientId);
    const eligibility = digestEligibility(client, sources.length);
    if (!eligibility.eligible) return { status: "skipped", reason: eligibility.reason };

    const snapshot = await readSnapshot(clientId);
    if (!snapshot) return { status: "skipped", reason: "no snapshot computed yet" };

    if (!process.env.RESEND_API_KEY) {
      const reason = "RESEND_API_KEY env var is not set";
      await logEvent({ clientId, category: "analytics", level: "error", message: `Digest failed: ${reason}` });
      return { status: "failed", reason };
    }

    const { data: members } = await supabaseAdmin
      .from("client_members")
      .select("email")
      .eq("client_id", clientId);
    const recipients = [
      ...new Set(
        [client.email, ...(members ?? []).map((m: { email: string | null }) => m.email)]
          .filter((e): e is string => typeof e === "string" && e.length > 0)
          .map((e) => e.toLowerCase()),
      ),
    ];
    if (recipients.length === 0) return { status: "skipped", reason: "no recipient emails" };

    const now = new Date();
    const periodEnd = now;
    const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const companyName = client.company || client.name || "your business";
    const portalUrl = process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com";
    const insights = snapshot.insights ?? [];
    const html = renderDigestHtml({ companyName, payload: snapshot.payload, insights, portalUrl });

    const { resend, DEFAULT_FROM } = await import("@/lib/resend");
    const sent = await resend().emails.send({
      from: DEFAULT_FROM,
      to: recipients,
      subject: `${companyName} — weekly analytics digest`,
      html,
    });
    if (sent.error) {
      const reason = `Resend error: ${sent.error.message ?? JSON.stringify(sent.error)}`;
      await logEvent({ clientId, category: "analytics", level: "error", message: `Digest failed: ${reason}` });
      return { status: "failed", reason };
    }
    const resendId = sent.data?.id ?? null;

    const { error: persistErr } = await supabaseAdmin.from("analytics_digests").insert({
      client_id: clientId,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      metrics_json: {
        kpis: snapshot.payload.kpis,
        generated_at: snapshot.payload.generatedAt,
        insight_count: insights.length,
      },
      html,
      resend_id: resendId,
      sent_at: new Date().toISOString(),
    });
    if (persistErr) {
      await logEvent({
        clientId,
        category: "analytics",
        level: "error",
        message: `Digest sent but analytics_digests persist failed: ${persistErr.message}`,
      });
    }
    await recordEvent(clientId, "digest.sent", "system", {
      resend_id: resendId,
      recipients: recipients.length,
    });
    await logEvent({
      clientId,
      category: "analytics",
      message: `Weekly analytics digest sent to ${recipients.length} recipient(s)`,
      metadata: { resend_id: resendId },
    });
    return { status: "sent" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await logEvent({ clientId, category: "analytics", level: "error", message: `Digest failed: ${reason}` });
    return { status: "failed", reason };
  }
}

export async function sendAnalyticsDigestForAllActiveClients(): Promise<
  Array<{ clientId: string; status: string; reason?: string }>
> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("analytics_digest_enabled", true)
    .or("status.is.null,status.eq.active");

  const outcomes = await Promise.allSettled(
    ((clients ?? []) as Array<{ id: string }>).map(async (c) => {
      const outcome = await sendAnalyticsDigestForClient(c.id);
      return { clientId: c.id, ...outcome };
    }),
  );

  return outcomes.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          clientId: ((clients ?? []) as Array<{ id: string }>)[i].id,
          status: "failed",
          reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
        },
  );
}
