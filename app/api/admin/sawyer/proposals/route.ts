// app/api/admin/sawyer/proposals/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listProposals, createProposal } from "@/lib/sawyer/store";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  return NextResponse.json({ proposals: await listProposals() });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const body = await req.json().catch(() => ({}));
  const proposal = await createProposal({
    client_id: body.clientId ?? null,
    prospect_name: body.prospectName ?? null,
    title: body.title ?? "Untitled proposal",
    sections: [],
    pricing: null,
    created_by: guard.user.email,
  });
  return NextResponse.json({ proposal });
}
