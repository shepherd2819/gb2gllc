import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("client_steward_assignments")
    .select("*, steward_platform_agents(id, display_name, icon, description)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { clientId, platformAgentId, mission, schedule } = await req.json();

  if (!clientId || !platformAgentId || !mission?.trim()) {
    return NextResponse.json({ error: "clientId, platformAgentId, and mission are required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("client_steward_assignments")
    .insert({
      client_id: clientId,
      platform_agent_id: platformAgentId,
      mission: mission.trim(),
      schedule: schedule?.trim() || null,
    })
    .select("*, steward_platform_agents(id, display_name, icon, description)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
