// app/api/admin/clients/[id]/analytics/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { inngest } from "@/lib/inngest/client";
import { listActiveSources, recordEvent } from "@/lib/analytics/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const sources = await listActiveSources(id);
  if (sources.length === 0) {
    return NextResponse.json({ error: "No active sources to sync" }, { status: 400 });
  }

  // One event per client: the analyticsSync Inngest function fans out over all
  // of the client's sources for an event run (concurrency key = clientId).
  await inngest.send({
    name: "analytics/source.connected",
    data: { clientId: id, sourceId: sources[0].id },
  });
  await recordEvent(id, "sync.requested", guard.user.email, {
    sourceIds: sources.map((s) => s.id),
  });

  return NextResponse.json({ ok: true, queued: sources.length });
}
