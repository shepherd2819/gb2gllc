import { withAuth } from "@workos-inc/authkit-nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { presetById } from "@/lib/steward/presets";
import { getPortalClientId } from "@/lib/portal-auth";

const SLACK_FLASH: Record<string, { tone: "ok" | "warn" | "err"; msg: string }> = {
  connected: { tone: "ok", msg: "Slack workspace connected — Mark is live in your workspace." },
  missing_code: { tone: "err", msg: "Slack didn't return an authorization code. Try again." },
  state_mismatch: { tone: "err", msg: "Sign-in session expired during install. Try again." },
  bad_state: { tone: "err", msg: "Invalid install state. Try again." },
  exchange_failed: { tone: "err", msg: "Slack rejected the install. Email hello@gb2gllc.com." },
};

const META_FLASH: Record<string, { tone: "ok" | "warn" | "err"; msg: string }> = {
  connected: { tone: "ok", msg: "Meta workspace connected — Maya is live on your Facebook Page and Instagram." },
  missing_code: { tone: "err", msg: "Meta didn't return an authorization code. Try again." },
  state_mismatch: { tone: "err", msg: "Sign-in session expired during install. Try again." },
  bad_state: { tone: "err", msg: "Invalid install state. Try again." },
  exchange_failed: { tone: "err", msg: "Meta rejected the install. Email hello@gb2gllc.com." },
  list_pages_failed: { tone: "err", msg: "Couldn't read your Pages from Meta. Try again." },
  no_pages: { tone: "warn", msg: "No Facebook Pages were returned. Make sure you're an admin of at least one Page and that the Page has a linked Instagram Business account." },
};

type Props = { searchParams: Promise<{ slack?: string; meta?: string }> };

export default async function ConnectionsPage({ searchParams }: Props) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/connections");

  const clientId = await getPortalClientId(user.id);
  if (!clientId) redirect("/auth/no-account");
  const { data: client } = await supabaseAdmin
    .from("clients").select("id").eq("id", clientId).single();
  if (!client) redirect("/auth/no-account");

  const [
    { data: session },
    { data: assignments },
    { data: tokens },
    { data: metaPages },
  ] = await Promise.all([
    supabaseAdmin.from("clients").select("intake_sessions(state)").eq("id", clientId).single(),
    supabaseAdmin
      .from("client_steward_assignments")
      .select("preset_id, platform_agent_id, active, steward_platform_agents(display_name, icon)")
      .eq("client_id", client.id)
      .eq("active", true),
    supabaseAdmin
      .from("steward_platform_tokens")
      .select("platform, token_data")
      .eq("client_id", client.id),
    supabaseAdmin
      .from("meta_page_subscriptions")
      .select("page_name, instagram_username")
      .eq("client_id", client.id)
      .eq("active", true),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const intakeState = (session as any)?.intake_sessions?.state ?? {};
  const software: string[] = intakeState.software?.selected ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const access: Record<string, any> = intakeState.access ?? {};

  const connectedPlatforms = new Set((tokens ?? []).map((t) => t.platform));
  if ((metaPages ?? []).length > 0) connectedPlatforms.add("meta");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slackToken = (tokens ?? []).find((t) => t.platform === "slack")?.token_data as any | undefined;
  const metaSummary = (metaPages ?? [])
    .map((p) => `${p.page_name}${p.instagram_username ? ` / @${p.instagram_username}` : ""}`)
    .join(", ");
  const sp = await searchParams;
  const flashSlack = sp.slack ? SLACK_FLASH[sp.slack as string] : undefined;
  const flashMeta = sp.meta ? META_FLASH[sp.meta as string] : undefined;
  const flash = flashMeta ?? flashSlack;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Connections</h1>
        <p className="page-sub">Where your AI agents live, and the platforms you connected during onboarding.</p>
      </div>

      {flash && (
        <div
          style={{
            margin: "0 0 20px",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            background: flash.tone === "ok" ? "rgba(106,142,99,0.10)" : flash.tone === "warn" ? "rgba(201,169,97,0.10)" : "rgba(196,82,75,0.10)",
            color: flash.tone === "ok" ? "var(--sage)" : flash.tone === "warn" ? "var(--gold)" : "var(--red)",
            border: `1px solid ${flash.tone === "ok" ? "rgba(106,142,99,0.30)" : flash.tone === "warn" ? "rgba(201,169,97,0.30)" : "rgba(196,82,75,0.30)"}`,
          }}
        >
          {flash.msg}
        </div>
      )}

      {(assignments ?? []).length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 className="section-title" style={{ marginBottom: 12 }}>Your AI agents</h2>
          <div className="connection-list">
            {(assignments ?? []).map((a, i) => {
              const preset = a.preset_id ? presetById(a.preset_id) : null;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const plat = a.steward_platform_agents as any;
              const isConnected = connectedPlatforms.has(a.platform_agent_id);
              const needsSlack = a.platform_agent_id === "slack" && !isConnected;
              const needsMeta = a.platform_agent_id === "meta" && !isConnected;
              return (
                <div key={i} className={`connection-row ${isConnected ? "granted" : "pending"}`}>
                  <div className="connection-name">
                    {preset?.icon ?? plat?.icon} {preset?.name ?? plat?.display_name}
                    <span style={{ fontSize: 11, color: "var(--text-mute, #8A8C85)", marginLeft: 8, fontFamily: "var(--mono, monospace)" }}>
                      / {plat?.display_name}
                    </span>
                  </div>
                  <div className="connection-status">
                    {isConnected ? (
                      <>
                        <span className="conn-badge granted">Connected</span>
                        {a.platform_agent_id === "slack" && slackToken?.team_name && (
                          <span className="conn-method">{slackToken.team_name}</span>
                        )}
                        {a.platform_agent_id === "meta" && metaSummary && (
                          <span className="conn-method">{metaSummary}</span>
                        )}
                      </>
                    ) : needsSlack ? (
                      <a href="/api/slack/install" className="btn-portal-ghost" style={{ padding: "6px 14px", fontSize: 12 }}>
                        Install in Slack →
                      </a>
                    ) : needsMeta ? (
                      <a href="/api/meta/install" className="btn-portal-ghost" style={{ padding: "6px 14px", fontSize: 12 }}>
                        Connect Meta →
                      </a>
                    ) : (
                      <span className="conn-badge pending">Setup pending</span>
                    )}
                  </div>
                  {preset?.description && <div className="conn-notes">{preset.description}</div>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="section-title" style={{ marginBottom: 12 }}>Platforms on file</h2>
        {software.length === 0 ? (
          <p className="empty-state">No platforms on file. <a href="mailto:hello@gb2gllc.com">Email us</a> to update your stack.</p>
        ) : (
          <div className="connection-list">
            {software.map((id: string) => {
              const a = access[id] ?? {};
              const granted = !!a.granted;
              return (
                <div key={id} className={`connection-row ${granted ? "granted" : "pending"}`}>
                  <div className="connection-name">{id}</div>
                  <div className="connection-status">
                    <span className={`conn-badge ${granted ? "granted" : "pending"}`}>
                      {granted ? "Connected" : "Pending"}
                    </span>
                    {a.method && <span className="conn-method">{a.method}</span>}
                  </div>
                  {a.notes && <div className="conn-notes">{a.notes}</div>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="conn-cta">
        <p>Need to add a platform or revoke access?</p>
        <a href="mailto:hello@gb2gllc.com?subject=Connection%20update" className="btn-portal-ghost">
          Email us →
        </a>
      </div>
    </>
  );
}
