// app/api/admin/sawyer/proposals/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getProposal, updateProposal } from "@/lib/sawyer/store";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const proposal = await getProposal(id);
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ proposal });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const proposal = await updateProposal(id, {
    title: body.title,
    status: body.status,
    sections: body.sections,
    pricing: body.pricing,
  });
  return NextResponse.json({ proposal });
}
