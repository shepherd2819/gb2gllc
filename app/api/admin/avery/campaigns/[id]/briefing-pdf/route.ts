import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { extractPdfText } from "@/lib/avery/extract-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

// POST a PDF (multipart form-data) → extracted text saved as briefing_pdf.
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
  let extracted;
  try {
    extracted = await extractPdfText(buf);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "PDF extraction failed" },
      { status: 500 }
    );
  }
  if (!extracted.text || extracted.text.length < 50) {
    return NextResponse.json({ error: "Couldn't pull readable text from this PDF" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("avery_campaigns")
    .update({
      briefing_pdf: extracted.text,
      briefing_pdf_filename: file.name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, pages: extracted.pages, chars: extracted.text.length, filename: file.name });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const { error } = await supabaseAdmin
    .from("avery_campaigns")
    .update({ briefing_pdf: null, briefing_pdf_filename: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
