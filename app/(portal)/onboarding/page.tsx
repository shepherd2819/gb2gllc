import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { getPortalClientId } from "@/lib/portal-auth";
import { getJourney, getMilestones } from "@/lib/onboarding/store";
import { progressSummary } from "@/lib/onboarding/milestones";
import { OnboardingChecklist } from "./OnboardingChecklist";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  invited: "Getting started",
  kickoff_scheduled: "Kickoff scheduled",
  provisioning: "Setting things up",
  activated: "Up and running",
  adopted: "Going strong",
  complete: "All set",
  stalled: "Needs your attention",
};

export default async function OnboardingPage() {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/onboarding");
  const clientId = await getPortalClientId(user.id);
  if (!clientId) redirect("/auth/no-account");

  const journey = await getJourney(clientId);

  if (!journey) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "8px 0" }}>
        <h1 style={{ fontFamily: "var(--serif, 'EB Garamond', Georgia, serif)", fontWeight: 400, fontSize: 34 }}>Onboarding</h1>
        <p style={{ color: "var(--ink-soft, #4A4D47)", lineHeight: 1.6 }}>
          Your onboarding plan will appear here as soon as your agreement is signed. We&apos;ll email you the moment it&apos;s ready.
        </p>
      </div>
    );
  }

  const milestones = await getMilestones(journey.id);
  const views = milestones.map((m) => ({ key: m.key, title: m.title, owner: m.owner, status: m.status, sort_order: m.sort_order }));
  const summary = progressSummary(views);

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "8px 0" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontFamily: "var(--serif, 'EB Garamond', Georgia, serif)", fontWeight: 400, fontSize: 34, margin: 0 }}>Welcome aboard</h1>
        <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 12, color: "var(--ink-mute, #8A8C85)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {STAGE_LABEL[journey.stage] ?? journey.stage}
        </span>
      </div>
      <p style={{ color: "var(--ink-soft, #4A4D47)", lineHeight: 1.6, marginTop: 6 }}>
        Here&apos;s everything to get you fully up and running. Check off your steps as you go — we&apos;ll handle ours.
      </p>

      {/* progress bar */}
      <div style={{ margin: "20px 0 28px" }}>
        <div style={{ height: 8, borderRadius: 100, background: "var(--rule, #E4DDCC)", overflow: "hidden" }}>
          <div style={{ width: `${summary.pct}%`, height: "100%", background: "var(--sage, #A6B49B)", transition: "width .4s ease" }} />
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-mute, #8A8C85)", marginTop: 6, fontFamily: "var(--mono, monospace)" }}>
          {summary.done} of {summary.total} done · {summary.pct}%
        </div>
      </div>

      <OnboardingChecklist milestones={views} />

      {journey.tier !== "self_serve" && (
        <div style={{ marginTop: 36, paddingTop: 24, borderTop: "1px solid var(--rule, #E4DDCC)" }}>
          <h2 style={{ fontFamily: "var(--serif, 'EB Garamond', Georgia, serif)", fontWeight: 400, fontSize: 22, margin: "0 0 6px" }}>Enterprise setup</h2>
          <p style={{ color: "var(--ink-soft, #4A4D47)", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            Have your IT team connect single sign-on and automatic user provisioning. These open a secure WorkOS setup page.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            {[
              { href: "/api/portal/workos-portal?intent=sso", label: "Set up SSO →" },
              { href: "/api/portal/workos-portal?intent=dsync", label: "Set up directory sync (SCIM) →" },
            ].map((b) => (
              <a
                key={b.href}
                href={b.href}
                style={{
                  border: "1px solid var(--ink, #1C1E1B)",
                  borderRadius: 100,
                  padding: "8px 16px",
                  fontSize: 13,
                  textDecoration: "none",
                  color: "var(--ink, #1C1E1B)",
                }}
              >
                {b.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
