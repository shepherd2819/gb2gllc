// app/api/admin/sawyer/proposals/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getProposal, updateProposal } from "@/lib/sawyer/store";
import { PROPOSAL_STATUSES } from "@/lib/sawyer/types";

// Shape-guard the PATCH body: malformed sections/pricing must be rejected here,
// not stored — otherwise the public proposal page (which renders these fields)
// could be made to 500 on a bad shape.
function validatePatchBody(body: Record<string, unknown>): string | null {
  if (body.status !== undefined && !(PROPOSAL_STATUSES as readonly string[]).includes(body.status as string)) {
    return "invalid status";
  }
  if (body.title !== undefined && typeof body.title !== "string") {
    return "title must be a string";
  }
  if (body.sections !== undefined) {
    if (
      !Array.isArray(body.sections) ||
      body.sections.some((s) => {
        const sec = s as Record<string, unknown>;
        return !sec || typeof sec.key !== "string" || typeof sec.heading !== "string" || typeof sec.body !== "string";
      })
    ) {
      return "each section needs string key/heading/body";
    }
  }
  if (body.pricing !== undefined && body.pricing !== null) {
    const p = body.pricing as Record<string, unknown>;
    if (typeof p !== "object" || !Array.isArray(p.items)) {
      return "pricing must have an items array";
    }
  }
  return null;
}

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
  const invalid = validatePatchBody(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const proposal = await updateProposal(id, {
    title: body.title,
    status: body.status,
    sections: body.sections,
    pricing: body.pricing,
  });
  return NextResponse.json({ proposal });
}
