import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { extractLeadsFromPdf } from "@/lib/avery/extract-leads-from-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

// POST a PDF (multipart form-data) containing a lead list. We parse it,
// ask Claude to pull out distinct contacts, then insert each one as a
// new avery_lead row on the campaign.
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    return NextResponse.json({ error: "Must be a PDF" }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "PDF too large (20 MB max)" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  let leads;
  try {
    leads = await extractLeadsFromPdf(buf);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Extraction failed" },
      { status: 500 }
    );
  }

  if (leads.length === 0) {
    return NextResponse.json({ error: "No leads found in the PDF (need at least one row with email or website)" }, { status: 400 });
  }

  const rows = leads.map((l) => ({
    campaign_id: id,
    name:    l.name    || null,
    email:   l.email   || null,
    company: l.company || null,
    website: l.website || null,
    notes:   l.notes   || null,
    status:  "pending" as const,
  }));

  const { data, error } = await supabaseAdmin.from("avery_leads").insert(rows).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    inserted: data?.length ?? 0,
    found: leads.length,
    filename: file.name,
  });
}
