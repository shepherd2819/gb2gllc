// app/api/admin/clients/[id]/hubspot-sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { inngest } from "@/lib/inngest/client";
import { decryptSecret } from "@/lib/analytics/crypto";
import { updateSourceConfig } from "@/lib/analytics/store";
import { listObjectSchemas, introspectAssociationTypeId } from "@/lib/hubspot-sync/hubspot-client";
import type { DataSourceRow } from "@/lib/analytics/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const HUBSPOT_BASE_URL = "https://api.hubapi.com";
const ORDER_ID_PROPERTY = "spiro_order_id";

async function findHubspotSource(clientId: string): Promise<DataSourceRow | null> {
  const { data } = await supabaseAdmin
    .from("client_data_sources")
    .select("*")
    .eq("client_id", clientId)
    .eq("provider", "hubspot")
    .maybeSingle();
  return (data as DataSourceRow | null) ?? null;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const source = await findHubspotSource(id);
  if (!source) return NextResponse.json({ error: "Add a HubSpot source first (Analytics section)" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  if (body.action === "introspect") {
    if (!source.secret_enc) return NextResponse.json({ error: "No HubSpot token configured yet" }, { status: 400 });
    const schemas = await listObjectSchemas(HUBSPOT_BASE_URL, decryptSecret(source.secret_enc));
    if (!schemas.ok) return NextResponse.json({ error: schemas.message }, { status: 502 });
    return NextResponse.json({ schemas: schemas.value });
  }

  if (body.action === "select_schema") {
    if (!source.secret_enc) return NextResponse.json({ error: "No HubSpot token configured yet" }, { status: 400 });
    const objectTypeId = body.objectTypeId;
    if (typeof objectTypeId !== "string" || objectTypeId.length === 0) {
      return NextResponse.json({ error: "objectTypeId is required" }, { status: 400 });
    }
    const token = decryptSecret(source.secret_enc);

    const schemas = await listObjectSchemas(HUBSPOT_BASE_URL, token);
    if (!schemas.ok) return NextResponse.json({ error: schemas.message }, { status: 502 });
    const picked = schemas.value.find((s) => s.objectTypeId === objectTypeId);
    if (!picked) return NextResponse.json({ error: "That object was not found on re-check" }, { status: 404 });
    if (!picked.properties.includes(ORDER_ID_PROPERTY)) {
      return NextResponse.json(
        { error: `Add a "${ORDER_ID_PROPERTY}" (single-line text) property to the ${picked.labelSingular} object in HubSpot first, then try again.` },
        { status: 400 },
      );
    }

    const assoc = await introspectAssociationTypeId(HUBSPOT_BASE_URL, token, objectTypeId, "contacts");
    if (!assoc.ok) return NextResponse.json({ error: assoc.message }, { status: 502 });

    const config = { ...source.config, hubspot_object_type: objectTypeId, hubspot_id_property: ORDER_ID_PROPERTY, association_type_id: assoc.value };
    await updateSourceConfig(source.id, config);
    return NextResponse.json({ ok: true, config });
  }

  // Plain pairing update.
  const config: Record<string, unknown> = { ...source.config };
  if ("spiro_source_id" in body) {
    if (typeof body.spiro_source_id !== "string" || body.spiro_source_id.length === 0) {
      return NextResponse.json({ error: "spiro_source_id must be a non-empty string" }, { status: 400 });
    }
    config.spiro_source_id = body.spiro_source_id;
  }
  if ("cutoff_date" in body) {
    if (typeof body.cutoff_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.cutoff_date)) {
      return NextResponse.json({ error: "cutoff_date must be YYYY-MM-DD" }, { status: 400 });
    }
    config.cutoff_date = body.cutoff_date;
  }
  await updateSourceConfig(source.id, config);
  return NextResponse.json({ ok: true, config });
}

export async function POST(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const source = await findHubspotSource(id);
  if (!source) return NextResponse.json({ error: "No HubSpot source configured" }, { status: 400 });

  await inngest.send({ name: "crm/hubspot.sync_requested", data: { clientId: id, sourceId: source.id } });
  return NextResponse.json({ ok: true, queued: true });
}
