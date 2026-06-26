import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getPortalClientId } from "@/lib/portal-auth";
import { getJourney, getMilestones, completeMilestone } from "@/lib/onboarding/store";

export const dynamic = "force-dynamic";

// POST /api/portal/onboarding/complete  body: { key }
// Lets a client check off one of THEIR OWN pending milestones. Server validates
// ownership against the journey so a client can't complete gb2g-owned steps.
export async function POST(req: Request) {
  const { user } = await withAuth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = await getPortalClientId(user.id);
  if (!clientId) return NextResponse.json({ error: "No client" }, { status: 403 });

  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  const journey = await getJourney(clientId);
  if (!journey) return NextResponse.json({ error: "No journey" }, { status: 404 });

  const milestone = (await getMilestones(journey.id)).find((m) => m.key === key);
  if (!milestone) return NextResponse.json({ error: "Unknown milestone" }, { status: 404 });
  if (milestone.owner !== "client") return NextResponse.json({ error: "Not your milestone to complete" }, { status: 403 });
  if (milestone.status === "done") return NextResponse.json({ ok: true }); // idempotent

  await completeMilestone(clientId, key, user.id);
  return NextResponse.json({ ok: true });
}
