import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { extractFromBrainDump } from "@/lib/intake/braindump";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ sessionId: string }> };

const MAX_BRAIN_DUMP_LEN = 12_000;

export async function POST(req: NextRequest, { params }: Params) {
  const { sessionId } = await params;

  // Verify session exists, isn't expired or already submitted
  const { data: session, error: sErr } = await supabaseAdmin
    .from("intake_sessions")
    .select("state, submitted_at, expires_at")
    .eq("id", sessionId)
    .single();
  if (sErr || !session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (session.submitted_at) return NextResponse.json({ error: "Session already submitted" }, { status: 409 });
  if (new Date(session.expires_at) < new Date()) return NextResponse.json({ error: "Session expired" }, { status: 410 });

  const body = await req.json().catch(() => null);
  const text: string | undefined = body?.text;
  if (!text || typeof text !== "string" || text.trim().length < 20) {
    return NextResponse.json({ error: "Brain dump must be at least 20 characters" }, { status: 400 });
  }

  const trimmed = text.trim().slice(0, MAX_BRAIN_DUMP_LEN);

  let extracted;
  try {
    extracted = await extractFromBrainDump(trimmed);
  } catch (err) {
    console.error("[braindump] extraction failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Extraction failed" },
      { status: 500 }
    );
  }

  // Merge extracted into session state. Preserves contact fields the welcome
  // stage already collected (extracted contact only fills blanks). For
  // about/goals/software/tasks the extracted data wins because those stages
  // are skipped in the brain-dump path.
  const existing = (session.state as Record<string, unknown>) ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingContact = (existing.contact as any) ?? {};
  const merged = {
    ...existing,
    path: "braindump",
    brain_dump_text: trimmed,
    brain_dump_extracted_at: new Date().toISOString(),
    brain_dump_missing: extracted.missing_fields,
    brain_dump_confidence: extracted.confidence,
    contact: {
      name:    existingContact.name    || extracted.contact.name    || "",
      email:   existingContact.email   || extracted.contact.email   || "",
      company: existingContact.company || extracted.contact.company || "",
      website: existingContact.website || extracted.contact.website || "",
    },
    about: extracted.about,
    goals: extracted.goals,
    software: extracted.software,
    tasks: extracted.tasks,
  };

  const { error: updateErr } = await supabaseAdmin
    .from("intake_sessions")
    .update({ state: merged })
    .eq("id", sessionId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, extracted });
}
