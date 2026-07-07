// app/api/admin/clients/[id]/analytics/sources/[sourceId]/test/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdapter } from "@/lib/analytics/adapters";
import { toSourceCtx } from "@/lib/analytics/store";
import type { DataSourceRow, Err, SourceCtx } from "@/lib/analytics/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // MCP transport has a 15s per-call timeout; leave headroom

type Params = { params: Promise<{ id: string; sourceId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id, sourceId } = await params;

  // Scoped by client_id AND source id — same tenant-isolation rule as the
  // sibling PATCH/DELETE route; no unscoped store.ts getSource() here.
  const { data } = await supabaseAdmin
    .from("client_data_sources")
    .select("*")
    .eq("id", sourceId)
    .eq("client_id", id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  const row = data as DataSourceRow;

  // row.provider was validated against the explicit whitelist at write time
  // (admin-validation.ts isKnownProvider); getAdapter here just resolves the
  // adapter instance, it is not doing whitelist validation.
  const adapter = getAdapter(row.provider);
  if (!adapter) {
    const err: Err = { ok: false, kind: "config", reason: `No adapter for provider '${row.provider}'` };
    return NextResponse.json(err);
  }

  let ctx: SourceCtx;
  try {
    ctx = toSourceCtx(row);
  } catch (e) {
    const err: Err = { ok: false, kind: "config", reason: `Secret decryption failed: ${(e as Error).message}` };
    return NextResponse.json(err);
  }

  const result = await adapter.testConnection(ctx);
  return NextResponse.json(result); // Result union JSON — UI branches on .ok/.kind
}
