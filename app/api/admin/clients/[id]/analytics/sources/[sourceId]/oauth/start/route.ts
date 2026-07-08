// app/api/admin/clients/[id]/analytics/sources/[sourceId]/oauth/start/route.ts
//
// Full-page GET the admin's browser navigates to when clicking
// "Connect / Log in" on an OAuth-mode MCP source (AnalyticsManager.tsx).
// Verifies ownership, then hands off to lib/analytics/oauth.ts's
// beginConnect (the MCP SDK's auth() orchestrator under the hood) to run
// discovery + Dynamic Client Registration + PKCE and produce the
// authorization URL — then 302s the admin's REAL browser there. This is the
// one place in the whole flow with an actual browser attached; every other
// piece of oauth.ts is deliberately non-redirecting.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { beginConnect } from "@/lib/analytics/oauth";
import type { DataSourceRow } from "@/lib/analytics/types";

export const dynamic = "force-dynamic";
// beginConnect runs RFC 9728 + RFC 8414 discovery and RFC 7591 DCR — several
// sequential network calls to the MCP server — before it can 302; same
// rationale as the sibling sources/[sourceId]/test/route.ts's maxDuration.
export const maxDuration = 60;

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";

type Params = { params: Promise<{ id: string; sourceId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id, sourceId } = await params;

  const landError = () => NextResponse.redirect(`${ADMIN_URL}/clients/${id}?analytics=error`, { status: 302 });

  // Scoped by client_id AND source id — same tenant-isolation rule as the
  // sibling sources routes (sources/[sourceId]/route.ts, .../test/route.ts);
  // no unscoped store.ts getSource() here.
  const { data } = await supabaseAdmin
    .from("client_data_sources")
    .select("*")
    .eq("id", sourceId)
    .eq("client_id", id)
    .maybeSingle();
  if (!data) return landError();
  const row = data as DataSourceRow;

  const endpointUrl = typeof row.config?.endpointUrl === "string" ? row.config.endpointUrl.trim() : "";
  if (!endpointUrl) return landError();

  const result = await beginConnect(sourceId, id, endpointUrl);
  if (!result.ok) {
    console.error(`[analytics/oauth start] beginConnect failed for source ${sourceId}: ${result.reason}`);
    return landError();
  }
  return NextResponse.redirect(result.authorizationUrl, { status: 302 });
}
