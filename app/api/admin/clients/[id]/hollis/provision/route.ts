import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { getHollisSecrets } from "@/lib/hollis/env";
import { createPhoneNumber } from "@/lib/hollis/retell";
import { resolveVoice } from "@/lib/hollis/voices";
import type { VoiceProfile } from "@/lib/hollis/types";

type Params = { params: Promise<{ id: string }> };

// POST /api/admin/clients/[id]/hollis/provision  body: { area_code?: number, voice_profile?: 'female'|'male' }
// Buys a Retell-managed number bound to the template agent + the inbound webhook,
// and creates (or activates) the client's line.
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (!getHollisSecrets().ok) return NextResponse.json({ error: "RETELL_API_KEY not set" }, { status: 400 });
  const agentId = process.env.HOLLIS_RETELL_AGENT_ID;
  if (!agentId) return NextResponse.json({ error: "HOLLIS_RETELL_AGENT_ID not set" }, { status: 400 });

  const { id } = await params;
  const body = await req.json().catch(() => ({} as { area_code?: number; voice_profile?: string }));
  const profile: VoiceProfile = body.voice_profile === "male" ? "male" : "female";
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";

  let number;
  try {
    number = await createPhoneNumber({
      areaCode: typeof body.area_code === "number" ? body.area_code : undefined,
      inboundAgentId: agentId,
      inboundWebhookUrl: `${adminUrl}/api/hollis/inbound`,
      nickname: `Hollis ${id.slice(0, 8)}`,
    });
  } catch (err) {
    return NextResponse.json({ error: `Retell provisioning failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }

  const { data: existing } = await supabaseAdmin
    .from("hollis_lines")
    .select("id")
    .eq("client_id", id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();

  const fields = {
    phone_number: number.phone_number,
    retell_number_id: number.phone_number,
    retell_agent_id: agentId,
    status: "active" as const,
    updated_at: new Date().toISOString(),
  };

  let lineId: string;
  if (existing) {
    await supabaseAdmin.from("hollis_lines").update(fields).eq("id", existing.id);
    lineId = existing.id;
  } else {
    const { data: inserted, error } = await supabaseAdmin
      .from("hollis_lines")
      .insert({
        client_id: id,
        voice_profile: profile,
        voice_id: resolveVoice(profile).voiceId,
        agent_name: resolveVoice(profile).defaultName,
        ...fields,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !inserted) return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
    lineId = inserted.id;
  }

  return NextResponse.json({ ok: true, line_id: lineId, phone_number: number.phone_number, phone_number_pretty: number.phone_number_pretty });
}
