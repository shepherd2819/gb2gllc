import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { resolveVoice } from "@/lib/hollis/voices";
import type { VoiceProfile } from "@/lib/hollis/types";

type Params = { params: Promise<{ id: string }> };

// PUT /api/admin/clients/[id]/hollis/config
// Updates the client's Hollis line config + replaces its FAQ. A line must
// already exist (provision a number first).
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  const { data: line } = await supabaseAdmin
    .from("hollis_lines")
    .select("id, voice_profile")
    .eq("client_id", id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string; voice_profile: VoiceProfile }>();
  if (!line) return NextResponse.json({ error: "Provision a phone line first." }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { updated_at: new Date().toISOString() };

  let profile = line.voice_profile;
  if (body.voice_profile === "female" || body.voice_profile === "male") {
    profile = body.voice_profile;
    row.voice_profile = profile;
    row.voice_id = resolveVoice(profile).voiceId;
  }
  if ("agent_name" in body) {
    row.agent_name = sanitizeText(body.agent_name) ?? resolveVoice(profile).defaultName;
  }
  if ("greeting_override" in body) row.greeting_override = sanitizeText(body.greeting_override);
  if ("escalation_number" in body) row.escalation_number = sanitizeText(body.escalation_number);
  if ("booking_email" in body) row.booking_email = sanitizeText(body.booking_email);
  if ("recording_enabled" in body) row.recording_enabled = !!body.recording_enabled;
  if (body.booking_mode === "email" || body.booking_mode === "crm" || body.booking_mode === "both") {
    row.booking_mode = body.booking_mode;
  }
  if (isObject(body.persona)) row.persona = body.persona;
  if (isObject(body.hours)) row.hours = body.hours;
  if (isObject(body.crm_config)) row.crm_config = body.crm_config;
  if ("services" in body) row.services = sanitizeArray(body.services);

  const { error } = await supabaseAdmin.from("hollis_lines").update(row).eq("id", line.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Replace FAQ if provided.
  if (Array.isArray(body.faq)) {
    await supabaseAdmin.from("hollis_kb").delete().eq("client_id", id);
    const rows = (body.faq as unknown[])
      .map((f) => f as { question?: unknown; answer?: unknown })
      .filter((f) => sanitizeText(f.question) && sanitizeText(f.answer))
      .map((f) => ({ client_id: id, question: sanitizeText(f.question)!, answer: sanitizeText(f.answer)! }));
    if (rows.length) {
      const { error: kbErr } = await supabaseAdmin.from("hollis_kb").insert(rows);
      if (kbErr) return NextResponse.json({ error: kbErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

function isObject(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function sanitizeArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter((x) => x.length > 0);
  if (typeof v === "string") return v.split(/[,\n]/).map((x) => x.trim()).filter((x) => x.length > 0);
  return [];
}
function sanitizeText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}
