// app/api/admin/sawyer/proposals/[id]/pdf/route.ts
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getProposal } from "@/lib/sawyer/store";
import { renderProposalPdf } from "@/lib/sawyer/render";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const proposal = await getProposal(id);
  if (!proposal) return new Response("Not found", { status: 404 });
  const pdf = await renderProposalPdf(proposal);
  const safe = proposal.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safe}.pdf"`,
    },
  });
}
