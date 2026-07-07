// app/api/admin/clients/[id]/analytics/sources/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { inngest } from "@/lib/inngest/client";
import { decryptSecret, encryptSecret, secretLast4 } from "@/lib/analytics/crypto";
import { recordEvent } from "@/lib/analytics/store";
import { isKnownProvider, validateSourceCreate } from "@/lib/analytics/admin-validation";
import type { DataSourceRow } from "@/lib/analytics/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Credentials are write-only: the raw value and the encrypted blob never leave
// the server. Admin UI gets has_secret + a "····last4" hint only.
function sanitizeSource(row: DataSourceRow) {
  const { secret_enc, ...rest } = row;
  let secretHint: string | null = null;
  if (secret_enc) {
    try {
      secretHint = `····${secretLast4(decryptSecret(secret_enc))}`;
    } catch {
      secretHint = "····"; // decryption misconfigured — still never expose the blob
    }
  }
  return { ...rest, has_secret: secret_enc !== null, secretHint };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from("client_data_sources")
    .select("*")
    .eq("client_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ sources: ((data ?? []) as DataSourceRow[]).map(sanitizeSource) });
}

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  // isKnownProvider is an explicit whitelist (admin-validation.ts), NOT
  // getAdapter(provider) !== null — REGISTRY[provider] ?? null is a plain
  // object lookup that returns a truthy value for "__proto__"/"constructor".
  const v = validateSourceCreate(body, isKnownProvider);
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("client_data_sources")
    .insert({
      client_id: id,
      kind: v.value.kind,
      provider: v.value.provider,
      label: v.value.label,
      config: v.value.config,
      secret_enc: v.value.secret ? encryptSecret(v.value.secret) : null,
      chat_tool_allowlist: v.value.chat_tool_allowlist ?? [],
      status: "active",
    })
    .select("*")
    .single();
  if (error?.code === "23505") {
    return NextResponse.json({ error: "A source with this provider + label already exists" }, { status: 409 });
  }
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  const row = data as DataSourceRow;
  await recordEvent(id, "source.connected", guard.user.email, {
    sourceId: row.id,
    provider: row.provider,
    label: row.label,
  });
  // Connecting IS activation: kick the first-connect backfill sync.
  await inngest.send({ name: "analytics/source.connected", data: { clientId: id, sourceId: row.id } });

  return NextResponse.json({ source: sanitizeSource(row) }, { status: 201 });
}
