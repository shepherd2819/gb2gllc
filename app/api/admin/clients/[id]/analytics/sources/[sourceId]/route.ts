// app/api/admin/clients/[id]/analytics/sources/[sourceId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { decryptSecret, encryptSecret, secretLast4 } from "@/lib/analytics/crypto";
import { recordEvent } from "@/lib/analytics/store";
import { validateSourcePatch } from "@/lib/analytics/admin-validation";
import type { DataSourceRow } from "@/lib/analytics/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; sourceId: string }> };

function sanitizeSource(row: DataSourceRow) {
  const { secret_enc, ...rest } = row;
  const isOAuth = row.config?.authMode === "oauth";
  let secretHint: string | null = null;
  // See sources/route.ts's sanitizeSource for why OAuth bundles must never
  // be decrypted for display: secret_enc holds a JSON token bundle
  // ({codeVerifier?, clientSecret?, tokens?}), not a raw static secret, and
  // this route is reachable via ordinary Pause/Resume/allowlist PATCHes.
  if (secret_enc && !isOAuth) {
    try {
      secretHint = `····${secretLast4(decryptSecret(secret_enc))}`;
    } catch {
      secretHint = "····";
    }
  }
  return { ...rest, has_secret: secret_enc !== null, secretHint };
}

// Scoped by client_id AND source id: a valid sourceId belonging to a
// different client returns null → 404 (no cross-tenant probing). Deliberately
// NOT store.ts's unscoped getSource(sourceId) — that would let a sourceId
// from any tenant be read/patched/deleted via this client's [id] URL.
async function findScoped(clientId: string, sourceId: string): Promise<DataSourceRow | null> {
  const { data } = await supabaseAdmin
    .from("client_data_sources")
    .select("*")
    .eq("id", sourceId)
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as DataSourceRow | null) ?? null;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id, sourceId } = await params;

  const body = await req.json().catch(() => null);
  const v = validateSourcePatch(body);
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 });

  const existing = await findScoped(id, sourceId);
  if (!existing) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.value.label !== undefined) patch.label = v.value.label;
  if (v.value.config !== undefined) patch.config = v.value.config;
  if (v.value.status !== undefined) patch.status = v.value.status;
  if (v.value.chat_tool_allowlist !== undefined) patch.chat_tool_allowlist = v.value.chat_tool_allowlist;
  // secret omitted from the patch body → existing secret_enc is left untouched
  // (no key here means no update, not a wipe).
  if (v.value.secret !== undefined) patch.secret_enc = encryptSecret(v.value.secret);

  const { data, error } = await supabaseAdmin
    .from("client_data_sources")
    .update(patch)
    .eq("id", sourceId)
    .eq("client_id", id)
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 500 });
  }

  const kind = v.value.status === "paused" ? "source.paused" : "source.updated";
  await recordEvent(id, kind, guard.user.email, {
    sourceId,
    fields: Object.keys(patch)
      .filter((k) => k !== "updated_at")
      .map((k) => (k === "secret_enc" ? "secret" : k)), // never log the value
  });

  return NextResponse.json({ source: sanitizeSource(data as DataSourceRow) });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id, sourceId } = await params;

  const existing = await findScoped(id, sourceId);
  if (!existing) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  const { error } = await supabaseAdmin
    .from("client_data_sources")
    .delete()
    .eq("id", sourceId)
    .eq("client_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordEvent(id, "source.removed", guard.user.email, { sourceId, label: existing.label });
  return NextResponse.json({ ok: true });
}
