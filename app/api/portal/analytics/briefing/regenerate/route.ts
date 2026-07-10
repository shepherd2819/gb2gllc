// app/api/portal/analytics/briefing/regenerate/route.ts
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getPortalClientId } from "@/lib/portal-auth";
import { readSnapshot, writeSnapshot, recordEvent } from "@/lib/analytics/store";
import { generateBriefing } from "@/lib/analytics/briefing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const { user } = await withAuth();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    // Tenant isolation: clientId derives from the session, NEVER the request.
    const clientId = await getPortalClientId(user.id);
    if (!clientId) return Response.json({ error: "No client" }, { status: 403 });

    const snapshot = await readSnapshot(clientId);
    if (!snapshot) return Response.json({ error: "No snapshot yet" }, { status: 404 });

    const briefing = await generateBriefing(snapshot.payload);
    // Preserve insights (null); persist the freshly generated briefing (even "").
    await writeSnapshot(clientId, snapshot.payload, null, briefing);
    await recordEvent(clientId, "briefing.regenerated", user.id, { ok: briefing.length > 0 });
    return Response.json({ briefing });
  } catch {
    return Response.json({ error: "Could not regenerate briefing" }, { status: 500 });
  }
}
